import {
  HandLandmarker, PoseLandmarker, FaceLandmarker, FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs';
import { BoneScene } from './render3d.js';
import { HandRig, BodyRig, SkullRig } from './rig.js';
import { drawTissue, drawLabels, drawTag } from './overlay.js';
import { BONE_INFO, GROUPS } from './facts.js';
import { quiz, startQuiz, endQuiz, quizTap, onPlayAgain } from './quiz.js';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

// Pairs of tracked points used to work out how far away from the camera each point is
const HAND_PAIRS = [[0, 5], [0, 9], [0, 13], [0, 17], [5, 17], [5, 6], [6, 7], [9, 10], [10, 11], [13, 14], [17, 18], [1, 2], [2, 3]];
const BODY_PAIRS = [[11, 12], [23, 24], [11, 23], [12, 24], [11, 13], [12, 14], [13, 15], [14, 16], [23, 25], [24, 26], [25, 27], [26, 28]];

// The three things the app can scan. Each uses its own tracking model and bone
// model, loaded the first time it's needed.
const VIEWS = {
  hand: {
    Task: HandLandmarker,
    model: `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
    options: { numHands: 2 },
    bones: 'models/hand.glb',
    Rig: HandRig,
    slots: 2,
    read: (r) => r.landmarks,
    world: (r) => r.worldLandmarks,
    pairs: HAND_PAIRS,
    what: 'hand',
    timer: 3,
    counter: (n) => (n === 2 ? '2 hands · 54 bones' : '27 bones in a hand'),
    hint: 'Show your hand to the camera, with your fingers spread',
  },
  body: {
    Task: PoseLandmarker,
    model: `${MODELS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
    options: { numPoses: 1 },
    bones: 'models/body.glb',
    Rig: BodyRig,
    slots: 1,
    read: (r) => r.landmarks,
    world: (r) => r.worldLandmarks,
    pairs: BODY_PAIRS,
    what: 'body',
    timer: 5,
    counter: () => '206 bones in an adult',
    hint: 'Stand back so your whole body fits, or ask a friend to hold the phone',
  },
  skull: {
    Task: FaceLandmarker,
    model: `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    options: { numFaces: 1 },
    bones: 'models/skull.glb',
    Rig: SkullRig,
    slots: 1,
    read: (r) => r.faceLandmarks,
    world: () => null,
    pairs: null,
    what: 'face',
    timer: 3,
    counter: () => '22 bones in a skull',
    hint: 'Point the camera at a face. Switch to the selfie camera to see your own skull',
  },
};

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const video = $('video');
const photo = $('photo');
const canvas = $('overlay');
const tissueCanvas = $('tissue');
const ctx = canvas.getContext('2d');

const state = {
  view: 'hand',
  mode: 'none',        // 'camera' | 'photo'
  facing: 'environment',
  mirror: false,
  frozen: false,
  figures: [],         // the rigs showing a tracked hand, body or head
  smooth: [],          // smoothed tracked points for each one
  selected: null,      // { fig, id, part } of the tapped bone
  lastSeen: 0,
  toastUntil: 0,
  countdown: null,
  frame: 0,
  opts: { xray: false, labels: false, colors: false },
};

let vision = null;
let scene3d = null;
let stream = null;
let lastVideoTime = -1;
let tracker = null;    // the tracking model the live loop may use; null while one is loading
let loadToken = 0;
let lastRender = '';
let slowFrames = 0;
let lastFrameAt = 0;
const trackers = {};   // view name → promise of { lm, running }
const rigs = {};       // view name → promise of the view's rigs

// ---------------------------------------------------------------------------
// Load tracking models and bones
// ---------------------------------------------------------------------------
function createTracker(view, runningMode) {
  const v = VIEWS[view];
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: v.model, delegate },
    runningMode,
    ...v.options,
  });
  return v.Task.createFromOptions(vision, options('GPU')).catch((err) => {
    console.warn('GPU not available, using CPU', err);
    return v.Task.createFromOptions(vision, options('CPU'));
  });
}

// Returns the tracking model for a view, set to VIDEO (camera) or IMAGE (photo) mode
async function getTracker(view, running) {
  if (!trackers[view]) {
    trackers[view] = createTracker(view, running).then((lm) => ({ lm, running })).catch((err) => {
      delete trackers[view];
      throw err;
    });
  }
  const t = await trackers[view];
  if (t.running !== running) {
    await t.lm.setOptions({ runningMode: running });
    t.running = running;
  }
  return t;
}

function getRigs(view) {
  if (!rigs[view]) {
    const v = VIEWS[view];
    rigs[view] = scene3d.loadModel(view, v.bones).then((model) => {
      const list = [];
      for (let i = 0; i < v.slots; i++) list.push(new v.Rig(scene3d, model, i));
      return list;
    }).catch((err) => {
      delete rigs[view];
      delete scene3d.models[view];
      throw err;
    });
  }
  return rigs[view];
}

function isLoaded(view) {
  return Boolean(trackers[view] && rigs[view]);
}

// Gets both parts of a view ready, and returns its tracking model
async function prepareView(view, running) {
  const [t] = await Promise.all([getTracker(view, running), getRigs(view)]);
  state.rigs = await rigs[view];
  return t;
}

async function init() {
  try {
    scene3d = new BoneScene($('bones3d'));
  } catch (err) {
    console.error(err);
    $('btnStart').textContent = 'Not available';
    $('status').textContent = 'This browser cannot show 3D graphics (WebGL), which the bones need.';
    return;
  }
  try {
    $('status').textContent = 'Downloading tracker and bones (first time only)…';
    vision = await FilesetResolver.forVisionTasks(WASM_URL);
    await prepareView(state.view, 'VIDEO');
    $('status').textContent = '';
    $('btnStart').textContent = 'Start camera';
    $('btnStart').disabled = false;
    $('btnStartPhoto').disabled = false;
  } catch (err) {
    console.error(err);
    $('status').textContent = 'Could not load the tracker or bones. Check your internet connection and reload.';
  }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
async function startCamera() {
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: state.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    console.error(err);
    const insecure = !window.isSecureContext ? ' The camera only works on https:// pages or localhost.' : '';
    $('status').textContent = 'Camera not available or permission denied.' + insecure + ' You can still use a photo.';
    showStart();
    return;
  }
  video.srcObject = stream;
  await video.play();

  // Selfie cameras (and most laptop webcams) feel natural when mirrored
  const facing = stream.getVideoTracks()[0].getSettings().facingMode;
  state.mirror = facing !== 'environment';
  video.classList.toggle('mirror', state.mirror);

  setMode('camera');
  setFrozen(false);
  state.lastSeen = performance.now();
  clearFigures();
  await activateTracker();

  // Hide the switch button if there is only one camera
  const devices = await navigator.mediaDevices.enumerateDevices();
  $('btnFlip').hidden = devices.filter((d) => d.kind === 'videoinput').length < 2;
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

// Gets the current view ready for the camera (and runs it once if the picture is frozen)
async function activateTracker() {
  const token = ++loadToken;
  tracker = null;
  const view = state.view;
  if (!isLoaded(view)) toast(`Loading ${VIEWS[view].what} tracker and bones…`, 30000);
  let t;
  try {
    t = await prepareView(view, 'VIDEO');
  } catch (err) {
    console.error(err);
    if (token === loadToken) toast('Could not load that view. Check your internet connection.', 6000);
    return;
  }
  if (token !== loadToken) return;
  tracker = t;
  clearToast();
  lastVideoTime = -1;
  if (state.frozen) {
    detectFrame();
    if (!state.figures.length) toast(`No ${VIEWS[view].what} found in this picture. Tap the big button to go back to live view.`, 6000);
  }
}

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------
async function usePhoto(file) {
  await new Promise((resolve, reject) => {
    photo.onload = resolve;
    photo.onerror = () => reject(new Error('Could not open that image'));
    photo.src = URL.createObjectURL(file);
  });
  stopCamera();
  setMode('photo');
  setFrozen(false);
  state.mirror = false;
  sizeLayers(photo.naturalWidth, photo.naturalHeight);
  await detectPhoto();
}

async function detectPhoto() {
  const token = ++loadToken;
  const view = state.view;
  tracker = null;
  clearFigures();
  if (!isLoaded(view)) toast(`Loading ${VIEWS[view].what} tracker and bones…`, 30000);
  const t = await prepareView(view, 'IMAGE');
  if (token !== loadToken) return;
  clearToast();
  setFigures(t.lm.detect(photo), canvas.width, canvas.height, false);
  if (!state.figures.length) toast(`No ${VIEWS[view].what} found in this photo. Try one with a clearer view.`, 6000);
}

function setMode(mode) {
  state.mode = mode;
  closeInfo();
  $('start').hidden = true;
  $('controls').hidden = false;
  video.hidden = mode !== 'camera';
  photo.hidden = mode !== 'photo';
  stage.classList.toggle('fit-cover', mode === 'camera');
  stage.classList.toggle('fit-contain', mode === 'photo');
  $('btnFreeze').setAttribute('aria-label', mode === 'photo' ? 'Back to camera' : 'Freeze frame');
  $('btnFlip').hidden = mode !== 'camera';
  $('btnTimer').hidden = mode !== 'camera';
}

function showStart() {
  $('start').hidden = false;
  $('controls').hidden = true;
}

// All the drawing layers match the size of the picture
function sizeLayers(w, h) {
  if (canvas.width === w && canvas.height === h && scene3d.width === w) return;
  canvas.width = w;
  canvas.height = h;
  tissueCanvas.width = Math.max(1, Math.round(w / 4));
  tissueCanvas.height = Math.max(1, Math.round(h / 4));
  scene3d.setSize(w, h);
  lastRender = '';
}

// ---------------------------------------------------------------------------
// Switch between Hand, Body and Skull
// ---------------------------------------------------------------------------
async function setView(view) {
  if (view === state.view) return;
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === view));
  cancelCountdown();
  endQuiz();
  closeInfo();
  clearFigures();
  state.lastSeen = performance.now();
  try {
    if (state.mode === 'photo') await detectPhoto();
    else if (state.mode === 'camera') await activateTracker();
    else if (vision) await prepareView(view, 'VIDEO');
  } catch (err) {
    console.error(err);
    toast('Could not load that view. Check your internet connection.', 6000);
  }
}

// ---------------------------------------------------------------------------
// Detection → bones
// ---------------------------------------------------------------------------
function clearFigures() {
  for (const rig of state.figures) rig.hide();
  state.figures = [];
  state.smooth = [];
  state.frame++;
}

// Tracked points in canvas pixels, with z (towards the viewer) in the same units.
// The tracker's real-world points hold the best depth, so they are scaled to match.
function toPoints(v, lms, world, w, h) {
  let k = 0;
  if (world && v.pairs) {
    let pixels = 0, metres = 0;
    for (const [a, b] of v.pairs) {
      if ((lms[a].visibility ?? 1) < 0.5 || (lms[b].visibility ?? 1) < 0.5) continue;
      pixels += Math.hypot((lms[a].x - lms[b].x) * w, (lms[a].y - lms[b].y) * h);
      metres += Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
    }
    if (metres > 1e-6) k = pixels / metres;
  }
  return lms.map((l, i) => ({
    x: (state.mirror ? 1 - l.x : l.x) * w,
    y: l.y * h,
    z: k ? -world[i].z * k : -l.z * w,
    v: l.visibility,
  }));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function setFigures(result, w, h, smooth) {
  const v = VIEWS[state.view];
  const worlds = v.world(result);
  let tracks = (v.read(result) || []).map((lms, i) => ({
    points: toPoints(v, lms, worlds && worlds[i], w, h),
    // The tracker's left/right assumes a mirrored picture, so it is flipped for an unmirrored one
    side: result.handedness && result.handedness[i] && result.handedness[i][0]
      ? ((result.handedness[i][0].categoryName === 'Left') === state.mirror ? 'L' : 'R')
      : 'R',
  }));

  // Two hands can swap places in the tracker's list; keep each one with its own history
  if (smooth && tracks.length === 2 && state.smooth.length === 2) {
    const same = distance(tracks[0].points[0], state.smooth[0][0]) + distance(tracks[1].points[0], state.smooth[1][0]);
    const swapped = distance(tracks[0].points[0], state.smooth[1][0]) + distance(tracks[1].points[0], state.smooth[0][0]);
    if (swapped < same) tracks = [tracks[1], tracks[0]];
  }

  // Light smoothing removes jitter without making the bones lag behind.
  // Depth is the tracker's least steady measurement, so it gets more smoothing.
  const canSmooth = smooth && state.smooth.length === tracks.length;
  state.smooth = tracks.map((t, i) => (canSmooth
    ? t.points.map((q, j) => {
      const old = state.smooth[i][j];
      return {
        x: old.x + (q.x - old.x) * 0.6,
        y: old.y + (q.y - old.y) * 0.6,
        z: old.z + (q.z - old.z) * 0.35,
        v: q.v,
      };
    })
    : t.points));

  const rigList = state.rigs || [];
  const figures = [];
  state.smooth.forEach((pts, i) => {
    if (!rigList[i]) return;
    figures.push(rigList[i].update(pts, h, { side: tracks[i].side, immediate: !canSmooth, mirrored: state.mirror }));
  });
  rigList.forEach((rig, i) => { if (i >= figures.length) rig.hide(); });
  state.figures = figures;
  state.frame++;
}

function detectFrame() {
  if (!tracker || !video.videoWidth) return;
  const res = tracker.lm.detectForVideo(video, performance.now());
  setFigures(res, canvas.width, canvas.height, !state.frozen);
  if (state.figures.length) state.lastSeen = performance.now();
}

function loop() {
  const now = performance.now();
  if (state.mode === 'camera' && video.readyState >= 2 && video.videoWidth) {
    sizeLayers(video.videoWidth, video.videoHeight);
    if (!state.frozen && tracker && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      detectFrame();
      watchSpeed(now);
    }
    if (now > state.toastUntil && !state.frozen) {
      const missing = tracker && now - state.lastSeen > 1200;
      $('hint').textContent = VIEWS[state.view].hint;
      $('hint').hidden = !missing;
    }
  } else if (now > state.toastUntil) {
    $('hint').hidden = true;
  }
  tickCountdown();
  render();
  requestAnimationFrame(loop);
}

// If the device can't keep up for a couple of seconds, simplify the drawing
function watchSpeed(now) {
  if (lastFrameAt) {
    const took = now - lastFrameAt;
    slowFrames = took > 70 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 25) {
      slowFrames = 0;
      if (scene3d.reduceQuality()) lastRender = '';
    }
  }
  lastFrameAt = now;
}

function toast(text, ms = 3000) {
  $('hint').textContent = text;
  $('hint').hidden = false;
  state.toastUntil = performance.now() + ms;
}

function clearToast() {
  state.toastUntil = 0;
  $('hint').hidden = true;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
// Screen pixels per canvas pixel (the canvas is stretched to fill the screen)
function displayScale() {
  const r = canvas.getBoundingClientRect();
  const fit = state.mode === 'photo' ? Math.min : Math.max;
  return fit(r.width / canvas.width, r.height / canvas.height) || 1;
}

function currentMarks() {
  // In a quiz the quiz decides what lights up
  if (quiz.active) return quiz.marks;
  return state.selected ? [{ ...state.selected, color: '#ffe066' }] : [];
}

function applyTints(marks) {
  const colors = state.opts.colors && !quiz.active;
  for (const figure of state.figures) {
    for (const m of figure.meshes) {
      const { id, side, fig } = m.userData;
      const mark = marks.find((x) => x.id === id && (x.fig === undefined || x.fig === fig) && (!x.part || x.part === side));
      if (mark) scene3d.setTint(m, mark.color, 0.8);
      else if (colors) scene3d.setTint(m, GROUPS[BONE_INFO[id].group].color, 0.5);
      else scene3d.setTint(m, '#ffffff', 0);
    }
  }
}

function render() {
  if (!scene3d) return;
  const { width: w, height: h } = canvas;
  const marks = currentMarks();
  const rect = canvas.getBoundingClientRect();
  // Nothing has changed since the last drawing? Then save the battery.
  const signature = JSON.stringify([state.frame, marks, quiz.tag, state.opts, w, h, rect.width, rect.height, scene3d.shadows, scene3d.quality]);
  if (signature === lastRender) return;
  lastRender = signature;

  const figs = state.figures;
  drawTissue(tissueCanvas, figs, w, state.opts.xray ? '#9cc8f0' : '#1c0f0a', state.opts.xray ? 1 : 0.5);
  applyTints(marks);
  scene3d.render();

  ctx.clearRect(0, 0, w, h);
  const s = displayScale();
  const fontPx = 13 / s;
  // Labels would give away the quiz answers
  if (state.opts.labels && !quiz.active && figs.length) {
    // Visible part of the canvas (on a phone the camera picture is cropped to fill the screen)
    const offX = (rect.width - w * s) / 2, offY = (rect.height - h * s) / 2;
    const view = {
      x0: Math.max(0, -offX / s), y0: Math.max(0, -offY / s),
      x1: Math.min(w, (rect.width - offX) / s), y1: Math.min(h, (rect.height - offY) / s),
    };
    drawLabels(ctx, figs, fontPx, view);
  }
  const sel = state.selected;
  if (quiz.active && quiz.tag) {
    figs.forEach((figure) => drawTag(ctx, figure, quiz.tag, fontPx * 1.1, quiz.tag.color));
  } else if (!quiz.active && sel && figs[sel.fig]) {
    drawTag(ctx, figs[sel.fig], sel, fontPx * 1.1);
  }

  $('counter').hidden = figs.length === 0 || quiz.active;
  $('counter').textContent = VIEWS[state.view].counter(figs.length);
}

// ---------------------------------------------------------------------------
// Tap a bone to learn about it (or to answer the quiz)
// ---------------------------------------------------------------------------
canvas.addEventListener('click', (e) => {
  if (!scene3d || !state.figures.length) { if (quiz.active) quizTap(null); else closeInfo(); return; }
  const r = canvas.getBoundingClientRect();
  const s = displayScale();
  const offX = (r.width - canvas.width * s) / 2;
  const offY = (r.height - canvas.height * s) / 2;
  const x = (e.clientX - r.left - offX) / s, y = (e.clientY - r.top - offY) / s;
  const mesh = scene3d.pick(x, y, 12 / s);
  const hit = mesh ? { fig: mesh.userData.fig, id: mesh.userData.id, part: mesh.userData.side || undefined } : null;
  if (quiz.active) { quizTap(hit); return; }
  if (!hit) { closeInfo(); return; }
  state.selected = hit;
  const info = BONE_INFO[hit.id];
  const group = GROUPS[info.group];
  $('infoGroup').textContent = group.label;
  $('infoGroup').style.background = group.color;
  $('infoName').textContent = info.name;
  $('infoMeaning').textContent = info.meaning;
  $('infoText').textContent = info.text;
  // Keep the card out of the way of the bone that was tapped
  $('info').classList.toggle('top', e.clientY > window.innerHeight * 0.5);
  $('info').hidden = false;
});

function closeInfo() {
  state.selected = null;
  $('info').hidden = true;
}

// ---------------------------------------------------------------------------
// Freeze, self-timer & save
// ---------------------------------------------------------------------------
function setFrozen(frozen) {
  state.frozen = frozen;
  $('btnFreeze').classList.toggle('frozen', frozen);
  $('btnFreeze').setAttribute('aria-label', state.mode === 'photo' ? 'Back to camera' : frozen ? 'Resume live view' : 'Freeze frame');
  if (state.mode !== 'camera') return;
  if (frozen) { video.pause(); clearToast(); } else video.play();
}

// Counts down, waits until a figure is in view, freezes the picture, then calls done()
function startCountdown(seconds, done) {
  closeInfo();
  if (state.frozen) setFrozen(false);
  state.countdown = { until: performance.now() + seconds * 1000, done };
  $('countdown').hidden = false;
  $('controls').hidden = true;
}

function tickCountdown() {
  const c = state.countdown;
  if (!c) return;
  const left = Math.ceil((c.until - performance.now()) / 1000);
  if (left > 0) {
    $('countNumber').textContent = left;
    $('countText').textContent = `Get your ${VIEWS[state.view].what} in view and hold still`;
    return;
  }
  if (!state.figures.length) {
    $('countNumber').textContent = '…';
    $('countText').textContent = `Looking for your ${VIEWS[state.view].what}`;
    return;
  }
  cancelCountdown();
  setFrozen(true);
  c.done();
}

function cancelCountdown() {
  state.countdown = null;
  $('countdown').hidden = true;
  if (state.mode !== 'none') $('controls').hidden = quiz.active;
}

// Only bones you can see and comfortably tap are worth asking about
function tappableBones() {
  const s = displayScale();
  const smallestTap = 170 / (s * s); // about 13 by 13 screen pixels, in canvas pixels
  const areas = new Map();
  for (const [mesh, area] of scene3d.visibleAreas()) {
    const { id } = mesh.userData;
    areas.set(id, (areas.get(id) || 0) + area);
  }
  return [...areas.entries()].filter(([, area]) => area >= smallestTap).map(([id]) => id);
}

function beginQuiz() {
  const pool = tappableBones();
  if (pool.length < 3) {
    toast(`Not enough bones in view for a quiz. Get more of your ${VIEWS[state.view].what} in the picture.`, 5000);
    return;
  }
  closeInfo();
  $('controls').hidden = true;
  startQuiz(state.view, pool, () => {
    $('controls').hidden = false;
    if (state.mode === 'camera') setFrozen(false);
  });
}

function quizClicked() {
  if (state.mode === 'photo' || state.frozen) {
    if (state.figures.length) beginQuiz();
    else toast(`The quiz needs a ${VIEWS[state.view].what} in the picture.`, 4000);
    return;
  }
  // Live camera: give people time to get back into position, then freeze so tapping is easy
  startCountdown(VIEWS[state.view].timer, beginQuiz);
}

function savePicture() {
  const src = state.mode === 'photo' ? photo : video;
  const w = canvas.width, h = canvas.height;
  if (!w || !h || state.mode === 'none') return;
  const xray = state.opts.xray;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const o = out.getContext('2d');
  o.save();
  if (state.mirror) { o.translate(w, 0); o.scale(-1, 1); }
  o.drawImage(src, 0, 0, w, h);
  o.restore();
  if (xray) {
    // Same dark blue look as the on-screen filter
    const img = o.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const v = Math.max(0, Math.min(1, (lum - 0.5) * 1.4 + 0.5)) * 0.3 * 255;
      d[i] = v * 0.55; d[i + 1] = v * 0.85; d[i + 2] = v * 1.15;
    }
    o.putImageData(img, 0, 0);
  }
  o.globalAlpha = xray ? 0.2 : 0.42;
  o.imageSmoothingEnabled = true;
  o.drawImage(tissueCanvas, 0, 0, w, h);
  o.globalAlpha = 1;
  // The 3D layer has to be drawn again right now to be copied
  scene3d.render();
  o.drawImage($('bones3d'), 0, 0, w, h);
  o.drawImage(canvas, 0, 0);
  lastRender = '';
  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `xray-${state.view}-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
$('btnStart').addEventListener('click', startCamera);
$('btnStartPhoto').addEventListener('click', () => $('file').click());
$('btnPhoto').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) usePhoto(f).catch((err) => toast(err.message, 5000));
  e.target.value = '';
});
// In photo mode the big button takes you back to the live camera
$('btnFreeze').addEventListener('click', () => (state.mode === 'photo' ? startCamera() : setFrozen(!state.frozen)));
$('btnTimer').addEventListener('click', () => startCountdown(5, () => {}));
$('countCancel').addEventListener('click', cancelCountdown);
$('btnQuiz').addEventListener('click', quizClicked);
onPlayAgain(tappableBones);
$('btnFlip').addEventListener('click', () => {
  state.facing = state.facing === 'environment' ? 'user' : 'environment';
  startCamera();
});
$('btnSave').addEventListener('click', savePicture);
$('infoClose').addEventListener('click', closeInfo);

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

document.querySelectorAll('.toggle[data-opt]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.opt;
    state.opts[key] = !state.opts[key];
    btn.classList.toggle('on', state.opts[key]);
    btn.setAttribute('aria-pressed', state.opts[key]);
    stage.classList.toggle('xray', state.opts.xray);
    if (scene3d) scene3d.setLook(state.opts.xray ? 'xray' : 'bone');
  });
});

init();
requestAnimationFrame(loop);

// Handy for testing in the browser console: window.xray.usePhotoUrl('https://…')
window.xray = {
  state,
  quiz,
  setView,
  loop,
  tappableBones,
  get scene3d() { return scene3d; },
  async usePhotoUrl(url) {
    const blob = await (await fetch(url)).blob();
    return usePhoto(blob);
  },
};
