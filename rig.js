// Moves the 3D bones to match what the camera sees.
//
// Each model knows where its joints sit in its original standing pose (the "rest"
// positions, in millimetres). Every frame, each bone gets a matrix that carries it
// from its rest position to its place between the tracked joints.
//
// Tracked points are { x, y, z, v }: x and y in canvas pixels (y down, already
// mirrored if the screen is mirrored), z towards the viewer, v = how sure the
// tracker is that the point is visible.
//
// Model axes: +X the person's left, +Y their back, +Z up.
// Scene axes: X right and Y up in canvas pixels, Z towards the viewer.

import * as THREE from 'three';
import { strokeLine, fillPoly, fadeLine } from './overlay.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const arr = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const sub = (a, b) => a.clone().sub(b);
const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
const lerp = (a, b, t) => a.clone().lerp(b, t);
const flipX = (p) => V(-p.x, p.y, p.z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Mirrors the right side of the model to make the left side
export const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

// An upright set of axes: X along `along`, Y as close to `hint` as it can get
function axes(along, hint) {
  const X = along.clone().normalize();
  const Y = hint.clone().addScaledVector(X, -hint.dot(X));
  if (Y.lengthSq() < 1e-6) {
    Y.set(Math.abs(X.y) < 0.9 ? 0 : 1, Math.abs(X.y) < 0.9 ? 1 : 0, 0);
    Y.addScaledVector(X, -Y.dot(X));
  }
  Y.normalize();
  return { X, Y, Z: new THREE.Vector3().crossVectors(X, Y) };
}

// Carries points from rest axes to current axes, stretching along each axis
function carry(restOrigin, rest, origin, cur, sx, sy, sz = sy) {
  const R0 = new THREE.Matrix4().makeBasis(rest.X, rest.Y, rest.Z).transpose();
  const R = new THREE.Matrix4().makeBasis(cur.X, cur.Y, cur.Z);
  const S = new THREE.Matrix4().makeScale(sx, sy, sz);
  const toRest = new THREE.Matrix4().makeTranslation(-restOrigin.x, -restOrigin.y, -restOrigin.z);
  const toCur = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
  return toCur.multiply(R).multiply(S).multiply(R0).multiply(toRest);
}

// Maps a rest segment a0→b0 onto the current segment a→b
function segment(a0, b0, hint0, a, b, hint, sWide) {
  const d0 = sub(b0, a0), d = sub(b, a);
  const sLong = Math.max(d.length() / (d0.length() || 1), 0.05);
  return carry(a0, axes(d0, hint0), a, axes(d, hint), sLong, sWide);
}

// Where a rest point ends up if it stays fixed relative to moving axes
function moved(p0, O0, F0, O, F, s) {
  const d = sub(p0, O0);
  return O.clone()
    .addScaledVector(F.X, d.dot(F0.X) * s)
    .addScaledVector(F.Y, d.dot(F0.Y) * s)
    .addScaledVector(F.Z, d.dot(F0.Z) * s);
}

function blendMatrix(a, b, t) {
  const out = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) out.elements[i] = a.elements[i] * (1 - t) + b.elements[i] * t;
  return out;
}

// ---------------------------------------------------------------------------
// Shared by all three kinds of figure
// ---------------------------------------------------------------------------
class Rig {
  constructor(scene3d, slot) {
    this.scene3d = scene3d;
    this.slot = slot;
    this.meshes = [];
    this.byKey = {};
    this.unit = 1;
    this.height = 1;
  }

  add(part, side = null) {
    const [mesh] = this.scene3d.addMeshes([part]);
    mesh.userData.fig = this.slot;
    mesh.userData.id = part.id;
    mesh.userData.side = side;
    mesh.userData.restMatrix = side === 'L' ? MIRROR_X.clone().multiply(part.rest) : part.rest.clone();
    this.meshes.push(mesh);
    this.byKey[part.key + (side || '')] = mesh;
    return mesh;
  }

  place(key, M) {
    const mesh = this.byKey[key];
    mesh.matrix.multiplyMatrices(M, mesh.userData.restMatrix);
    mesh.matrixWorld.copy(mesh.matrix);
    mesh.visible = true;
  }

  hide() {
    for (const m of this.meshes) m.visible = false;
  }

  // Screen position of a bone's middle, y down
  center(sel) {
    const mesh = this.meshes.find((m) => m.visible && m.userData.id === sel.id && (!sel.part || m.userData.side === sel.part));
    if (!mesh) return null;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const c = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrix);
    return { x: c.x, y: this.height - c.y };
  }
}

// ---------------------------------------------------------------------------
// Hand: every bone follows its own pair of joints
// ---------------------------------------------------------------------------
const FINGER_CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const CARPAL_KEYS = ['scaphoid', 'lunate', 'triquetrum', 'pisiform', 'trapezium', 'trapezoid', 'capitate', 'hamate'];

export class HandRig extends Rig {
  constructor(scene3d, model, slot) {
    super(scene3d, slot);
    this.parts = model.parts;
    const { joints, mcBase, forearmEnd } = model.meta.hand;
    const J = joints.map(arr);
    const base = mcBase.map(arr);
    // Both sides of the rest pose: the left is the right, mirrored
    this.rest = {
      R: { J, base },
      L: { J: J.map(flipX), base: base.map(flipX) },
    };
    for (const part of Object.values(model.parts)) this.add(part);
    // Forearm bones dissolve as they run away from the hand
    const wrist = J[0], end = arr(forearmEnd);
    const from = lerp(wrist, end, 0.16), to = lerp(wrist, end, 0.5);
    for (const key of ['radius', 'ulna']) scene3d.setFade(this.byKey[key], from, to);
    this.side = 'R';
    this.pending = 0;
  }

  // side is 'R' or 'L' as it looks on screen; a brief flicker in the tracker's answer is ignored
  chooseSide(side, immediate) {
    if (immediate || side === this.side) {
      this.side = side;
      this.pending = 0;
    } else if (++this.pending > 8) {
      this.side = side;
      this.pending = 0;
    }
  }

  update(pts, height, { side, immediate }) {
    this.chooseSide(side, immediate);
    this.height = height;
    this.points = pts;
    const P = pts.map((p) => V(p.x, height - p.y, p.z));
    const { J, base } = this.rest[this.side];
    // A left hand is the right hand's bones, mirrored
    for (const m of this.meshes) {
      const { rest } = m.userData.part;
      if (this.side === 'L') m.userData.restMatrix.multiplyMatrices(MIRROR_X, rest);
      else m.userData.restMatrix.copy(rest);
    }

    // The palm: one transform that takes the whole rest palm to the tracked palm
    const U0 = sub(J[9], J[0]), A0 = sub(J[5], J[17]);
    let U = sub(P[9], P[0]), A = sub(P[5], P[17]);
    if (U.lengthSq() < 1e-6) U = V(0, 1, 0);
    if (A.lengthSq() < 1e-6) A = V(1, 0, 0);
    // Hand seen exactly edge-on: keep the palm from collapsing to a line
    let N = new THREE.Vector3().crossVectors(U, A);
    if (N.length() < 0.15 * U.length() * A.length()) {
      const inPlane = V(-U.y, U.x, 0).normalize().multiplyScalar((U.length() * A0.length()) / U0.length());
      A = inPlane.dot(A) >= 0 ? inPlane : inPlane.negate();
      N = new THREE.Vector3().crossVectors(U, A);
    }
    N.normalize().multiplyScalar(U.length());
    const N0 = new THREE.Vector3().crossVectors(U0, A0).normalize().multiplyScalar(U0.length());
    const B0 = new THREE.Matrix4().makeBasis(U0, A0, N0).invert();
    const B = new THREE.Matrix4().makeBasis(U, A, N);
    const palm = new THREE.Matrix4().makeTranslation(P[0].x, P[0].y, P[0].z)
      .multiply(B).multiply(B0)
      .multiply(new THREE.Matrix4().makeTranslation(-J[0].x, -J[0].y, -J[0].z));

    // Bone thickness follows the hand's overall size
    const scale = Math.max(U.length() / U0.length(), A.length() / A0.length());
    this.unit = scale * U0.length();

    for (const key of CARPAL_KEYS) this.place(key, palm);

    // Fingers: each bone runs between two tracked joints
    FINGER_CHAINS.forEach((chain, f) => {
      const n = f + 1;
      const hint0 = f === 0 ? N0 : A0, hint = f === 0 ? N : A;
      const baseRest = base[f];
      const palmBase = baseRest.clone().applyMatrix4(palm);
      if (f === 0) {
        // The thumb's base follows the tracker, but stays close to the wrist bones it joins
        const b = lerp(P[1], palmBase, 0.5);
        this.place('mc1', segment(J[1], J[2], hint0, b, P[2], hint, scale));
        this.place('pp1', segment(J[2], J[3], hint0, P[2], P[3], hint, scale));
        this.place('dp1', segment(J[3], J[4], hint0, P[3], P[4], hint, scale));
        return;
      }
      const [k, a, b, c] = chain;
      this.place(`mc${n}`, segment(baseRest, J[k], hint0, palmBase, P[k], hint, scale));
      this.place(`pp${n}`, segment(J[k], J[a], hint0, P[k], P[a], hint, scale));
      this.place(`mp${n}`, segment(J[a], J[b], hint0, P[a], P[b], hint, scale));
      this.place(`dp${n}`, segment(J[b], J[c], hint0, P[b], P[c], hint, scale));
    });

    // Forearm: carries straight on from the palm, because the tracker can't see the elbow
    const forearm = carry(J[0], axes(U0, A0), P[0], axes(U, A), scale, scale);
    this.place('radius', forearm);
    this.place('ulna', forearm);
    this.scene3d.pxPerMm = scale;
    this.scene3d.filmGain = 1;
    return this;
  }

  tissue(t, color, spread) {
    const p = this.points;
    const L = this.unit * spread;
    fillPoly(t, [p[0], p[1], p[2], p[5], p[9], p[13], p[17]], 0.3 * L);
    const widths = [0.25, 0.21, 0.21, 0.2, 0.18];
    FINGER_CHAINS.forEach((c, f) => strokeLine(t, c.map((i) => p[i]), widths[f] * L));
    const dx = p[9].x - p[0].x, dy = p[9].y - p[0].y;
    // Starts inside the palm, so the start of the line never shows
    fadeLine(t, { x: p[0].x + dx * 0.2, y: p[0].y + dy * 0.2 }, { x: p[0].x - dx * 1.1, y: p[0].y - dy * 1.1 }, 0.68 * L, color);
  }

  labels() {
    const p = this.points;
    const U = { x: p[9].x - p[0].x, y: p[9].y - p[0].y };
    const A = { x: p[5].x - p[17].x, y: p[5].y - p[17].y };
    const at = (id) => this.center({ id }) || p[0];
    const off = (q, u, a) => ({ x: q.x + U.x * u + A.x * a, y: q.y + U.y * u + A.y * a });
    const mc5 = at('mc5'), carpal = at('capitate');
    return [
      { text: 'Phalanges · 14', at: at('mp3'), to: off(p[12], 0.22, 0) },
      { text: 'Metacarpals · 5', at: mc5, to: off(mc5, 0, -0.9) },
      { text: 'Carpals · 8', at: carpal, to: off(carpal, -0.05, -1.3) },
      { text: 'Radius', at: off(p[0], -0.45, 0.22), to: off(p[0], -0.55, 0.95) },
      { text: 'Ulna', at: off(p[0], -0.45, -0.2), to: off(p[0], -0.55, -0.95) },
    ];
  }
}

// ---------------------------------------------------------------------------
// Skull: the whole skull moves as one, and the jaw opens with the mouth
// ---------------------------------------------------------------------------
// The outline of the face, in the tracker's numbering
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const JAW_KEYS = ['mandible', 'teethLower'];

export class SkullRig extends Rig {
  constructor(scene3d, model, slot) {
    super(scene3d, slot);
    this.parts = model.parts;
    for (const part of Object.values(model.parts)) this.add(part);
    const h = model.meta.head;
    this.head = h;
    this.eyeA0 = V(h.eye[0], h.eye[1] - 10, h.eye[2]); // the person's right eye, at the skin
    this.eyeB0 = flipX(this.eyeA0);
    this.bridge0 = V(0, h.bridge[1], h.bridge[2]);
    this.subnasale0 = V(0, h.subnasale[1], h.subnasale[2]);
    this.faceWidth0 = h.faceWidth;
    this.faceHeight0 = 190; // from the forehead point the tracker uses, down to the chin
    this.hinge0 = V(0, h.jawHinge[1], h.jawHinge[2]);
  }

  // `mirrored` is true when the picture on screen is a mirror image
  update(pts, height, { mirrored }) {
    this.height = height;
    this.points = pts;
    const P = (i) => V(pts[i].x, height - pts[i].y, pts[i].z);
    const eyeA = mid(P(33), P(133)), eyeB = mid(P(362), P(263));
    const O = mid(eyeA, eyeB), O0 = mid(this.eyeA0, this.eyeB0);
    const X0 = sub(this.eyeB0, this.eyeA0);
    const Y0 = sub(this.bridge0, this.subnasale0);
    // On a mirrored screen the person's left is on the left of the picture
    let X = sub(eyeB, eyeA);
    const spanX = X.length();
    if (mirrored) X.negate();
    const Y = sub(P(168), P(2));
    const spanY = Y.length();
    // Size: eyes and nose give the proportions of the middle of the face, and the
    // face's full width and height stop the skull ending up too small for the head
    const eyes = spanX / X0.length(), nose = spanY / Y0.length();
    const wide = sub(P(234), P(454)).length() / this.faceWidth0;
    const tall = sub(P(10), P(152)).length() / this.faceHeight0;
    const s = (eyes + nose + wide + tall) / 4;
    const M = carry(O0, axes(X0, Y0), O, axes(X, Y), (s + (eyes + wide) / 2) / 2, (s + (nose + tall) / 2) / 2, s);
    this.unit = s * 150;
    this.scene3d.pxPerMm = s;
    this.scene3d.filmGain = 0.6;

    // Jaw: opens by the gap between the lips, about a hinge across the skull.
    // A smile parts the lips a little without opening the jaw, hence the allowance.
    const gapMm = sub(P(13), P(14)).length() / (s || 1);
    const angle = clamp((gapMm - 6) / 92, 0, 0.6);
    const jaw = new THREE.Matrix4()
      .makeTranslation(this.hinge0.x, this.hinge0.y, this.hinge0.z)
      .multiply(new THREE.Matrix4().makeRotationX(angle))
      .multiply(new THREE.Matrix4().makeTranslation(-this.hinge0.x, -this.hinge0.y, -this.hinge0.z));
    const jawM = M.clone().multiply(jaw);
    const jawHalf = blendMatrix(M, jawM, 0.5);

    for (const m of this.meshes) {
      const { key } = m.userData.part;
      const use = JAW_KEYS.includes(key) ? jawM : key === 'hyoid' ? jawHalf : M;
      this.place(key, use);
    }
    return this;
  }

  tissue(t, color, spread) {
    const p = this.points;
    fillPoly(t, FACE_OVAL.map((i) => p[i]), this.unit * 0.1 * spread);
  }

  labels() {
    const p = this.points;
    const c = { x: (p[234].x + p[454].x) / 2, y: (p[10].y + p[152].y) / 2 };
    const R = { x: p[454].x - p[234].x, y: p[454].y - p[234].y };
    const D = { x: p[152].x - p[10].x, y: p[152].y - p[10].y };
    const off = (q, a, b) => ({ x: q.x + R.x * a + D.x * b, y: q.y + R.y * a + D.y * b });
    const list = [
      ['frontal', 'Frontal', -0.55, -0.62],
      ['parietal', 'Parietal', 0.55, -0.72],
      ['temporal', 'Temporal', -1.0, -0.12],
      ['sphenoid', 'Sphenoid', 1.0, -0.2],
      ['zygomatic', 'Zygomatic', -1.0, 0.1],
      ['nasal', 'Nasal', 1.0, 0.02],
      ['maxilla', 'Maxilla', 1.0, 0.24],
      ['teeth', 'Teeth', -1.0, 0.34],
      ['mandible', 'Mandible', 0.9, 0.62],
    ];
    const out = [];
    for (const [id, text, a, b] of list) {
      const at = this.center({ id });
      if (at) out.push({ text, at, to: off(c, a, b) });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Whole body: limbs follow their joints, the chest and pelvis follow the
// shoulders and hips, and the spine bends smoothly between them.
// ---------------------------------------------------------------------------
const VISIBLE = 0.5;
const SWAP = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32, 31];
const LEFT = { side: 'L', shoulder: 11, elbow: 13, wrist: 15, little: 17, index: 19, thumb: 21, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
const RIGHT = { side: 'R', shoulder: 12, elbow: 14, wrist: 16, little: 18, index: 20, thumb: 22, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 };
const CHEST_KEYS = ['ribsTrue', 'ribsFalse', 'ribsFloating', 'costalCartilage', 'sternum', 'thoracic'];
const LIMB_KEYS = ['scapula', 'clavicle', 'hip', 'humerus', 'radius', 'ulna', 'hand', 'femur', 'tibia', 'fibula', 'patella', 'foot'];

export class BodyRig extends Rig {
  constructor(scene3d, model, slot) {
    super(scene3d, slot);
    this.parts = model.parts;
    for (const part of Object.values(model.parts)) {
      if (LIMB_KEYS.includes(part.key)) {
        this.add(part, 'R');
        this.add(part, 'L');
      } else {
        this.add(part);
      }
    }
    const l = model.meta.limbs;
    const rest = (side) => {
      const f = side === 'L' ? flipX : (p) => p;
      const out = {};
      for (const [k, v] of Object.entries(l)) out[k] = f(arr(v));
      return out;
    };
    this.rest = { R: rest('R'), L: rest('L') };
    this.head = model.meta.head;
  }

  update(raw, height, { mirrored }) {
    this.height = height;
    // On a mirrored screen, what looks like the person's left is drawn as their left
    const pts = mirrored ? SWAP.map((i) => raw[i]) : raw;
    this.points = pts;
    this.hide();
    const P = pts.map((p) => V(p.x, height - p.y, p.z));
    const seen = (...ids) => ids.every((i) => pts[i].v === undefined || pts[i].v >= VISIBLE);
    this.seen = seen;

    const R0 = this.rest.R, L0 = this.rest.L;
    const hasShoulders = seen(11, 12), hasHips = seen(23, 24);
    const midS0 = mid(R0.shoulder, L0.shoulder), midH0 = mid(R0.hip, L0.hip);
    const up0 = sub(midS0, midH0);
    const acrossS0 = sub(L0.shoulder, R0.shoulder), acrossH0 = sub(L0.hip, R0.hip);
    const midS = mid(P[11], P[12]), midH = mid(P[23], P[24]);

    // ---- Overall size, in pixels per millimetre ----
    let s;
    let up;
    if (hasShoulders && hasHips) {
      up = sub(midS, midH);
      s = up.length() / up0.length();
    } else if (hasShoulders) {
      s = sub(P[11], P[12]).length() / acrossS0.length();
      // No hips in view: "down" is away from the head
      const across = sub(P[11], P[12]);
      const headwards = seen(0) ? sub(P[0], midS) : V(0, 1, 0);
      up = headwards.clone().addScaledVector(across.clone().normalize(), -headwards.dot(across.clone().normalize()));
      if (up.lengthSq() < 1e-6) up = V(0, 1, 0);
      up.normalize().multiplyScalar(up0.length() * s);
    } else if (hasHips) {
      s = sub(P[23], P[24]).length() / acrossH0.length();
      up = V(0, 1, 0).multiplyScalar(up0.length() * s);
    } else {
      const measure = [
        [12, 14, R0.shoulder, R0.elbow], [11, 13, L0.shoulder, L0.elbow], [14, 16, R0.elbow, R0.wrist], [13, 15, L0.elbow, L0.wrist],
        [24, 26, R0.hip, R0.knee], [23, 25, L0.hip, L0.knee], [26, 28, R0.knee, R0.ankle], [25, 27, L0.knee, L0.ankle],
      ].find(([a, b]) => seen(a, b));
      if (!measure) return this;
      s = sub(P[measure[0]], P[measure[1]]).length() / sub(measure[2], measure[3]).length();
      up = V(0, 1, 0).multiplyScalar(up0.length() * s);
    }
    s = Math.max(s, 1e-3);
    this.unit = s * up0.length();
    this.scene3d.pxPerMm = s;
    this.scene3d.filmGain = 0.9;

    // ---- Chest and pelvis ----
    const trunk = (O0, across0, O, across) => {
      const F0 = axes(across0, up0), F = axes(across, up);
      const sy = Math.max(up.dot(F.Y) / up0.dot(F0.Y), s * 0.5);
      const sx = clamp(across.length() / across0.length(), sy * 0.72, sy * 1.35);
      return { M: carry(O0, F0, O, F, sx, sy, (sx + sy) / 2), F };
    };
    let chest = null, pelvis = null;
    if (hasShoulders) chest = trunk(midS0, acrossS0, midS, sub(P[11], P[12]));
    if (hasHips) pelvis = trunk(midH0, acrossH0, midH, sub(P[23], P[24]));
    this.chest = chest;
    this.pelvis = pelvis;

    if (chest) for (const key of CHEST_KEYS) this.place(key, chest.M);
    if (pelvis) {
      this.place('sacrum', pelvis.M);
      this.place('hipR', pelvis.M);
      this.place('hipL', pelvis.M);
      for (let i = 1; i <= 5; i++) {
        // Top of the lower back follows the chest, the bottom follows the pelvis
        const w = chest ? (5 - i + 0.5) / 5.5 * 0.8 + 0.1 : 0;
        this.place(`lumbar${i}`, chest ? blendMatrix(pelvis.M, chest.M, w) : pelvis.M);
      }
    }

    // ---- Head and neck ----
    let headM = null;
    if (seen(0) && (seen(7) || seen(8))) {
      const h = this.head;
      const ear0 = V(Math.abs(h.ear[0]), h.ear[1], h.ear[2]);
      const earMid0 = V(0, h.ear[1], h.ear[2]);
      const faceHeight0 = h.eye[2] - h.biteZ;
      const X0 = ear0.clone().multiplyScalar(2).setY(0).setZ(0);
      const X = sub(P[7], P[8]);
      // The tracker's depth for the face is too unsteady to judge nodding, so the head stays
      // upright and only leans the way it leans on screen.
      const Y = sub(mid(P[2], P[5]), mid(P[9], P[10])).setZ(0);
      const hs = clamp(Math.max(X.length() / X0.length(), Y.length() / faceHeight0), s * 0.8, s * 1.25);
      headM = carry(earMid0, axes(X0, V(0, 0, 1)), mid(P[7], P[8]), axes(X, Y), hs, hs);
      this.place('skull', headM);
      this.place('mandible', headM);
      this.place('hyoid', headM);
      if (chest) {
        for (let i = 1; i <= 7; i++) {
          // The bone under the skull turns with the head; the lowest stays with the chest
          this.place(`cervical${i}`, blendMatrix(chest.M, headM, (7 - i + 0.5) / 7));
        }
      }
    }

    // ---- Arms and legs ----
    const chestX = chest ? chest.F.X : V(1, 0, 0);
    const pelvisX = pelvis ? pelvis.F.X : chestX;
    for (const limb of [LEFT, RIGHT]) this.arm(limb, P, seen, s, chest, chestX);
    for (const limb of [LEFT, RIGHT]) this.leg(limb, P, seen, s, pelvisX);
    return this;
  }

  arm(limb, P, seen, s, chest, chestX) {
    const { side, shoulder, elbow, wrist, little, index, thumb } = limb;
    const r = this.rest[side];
    const forward0 = V(0, -1, 0);
    const a0 = sub(r.elbow, r.shoulder);
    const f0 = sub(r.wrist, r.elbow);
    const n0 = new THREE.Vector3().crossVectors(a0, forward0).normalize();

    // Shoulder blade and collarbone travel with the shoulder
    if (chest && seen(shoulder)) {
      const delta = sub(P[shoulder], r.shoulder.clone().applyMatrix4(chest.M));
      const shift = new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z);
      this.place(`scapula${side}`, shift.multiply(chest.M));
      const inner = r.clavicleInner.clone().applyMatrix4(chest.M);
      const outer = r.clavicleOuter.clone().applyMatrix4(chest.M).add(delta);
      this.place(`clavicle${side}`, segment(r.clavicleInner, r.clavicleOuter, forward0, inner, outer, chest.F.Z, s));
    }

    // Elbow hinge direction, known from the bend when there is one
    let hinge = chestX.clone().negate();
    if (seen(shoulder, elbow, wrist)) {
      const a = sub(P[elbow], P[shoulder]), f = sub(P[wrist], P[elbow]);
      const n = new THREE.Vector3().crossVectors(a, f);
      const bend = n.length() / ((a.length() * f.length()) || 1);
      hinge = hinge.multiplyScalar(1 - smooth(0.15, 0.5, bend)).add(n.normalize().multiplyScalar(smooth(0.15, 0.5, bend)));
    }
    if (seen(shoulder, elbow)) {
      this.place(`humerus${side}`, segment(r.shoulder, r.elbow, n0, P[shoulder], P[elbow], hinge, s));
    }
    if (!seen(elbow, wrist)) return;

    // Forearm: the two bones keep their place at the elbow, and follow the thumb at the wrist.
    // That is why they cross over when you turn your palm backwards.
    const f = sub(P[wrist], P[elbow]);
    const hasHand = seen(little, index);
    const t = hasHand ? sub(P[index], P[little]) : hinge;
    const t0 = sub(r.indexKnuckle, r.littleKnuckle);
    const Fe0 = axes(f0, n0), Fe = axes(f, hinge);
    const Fw0 = axes(f0, t0), Fw = axes(f, t);
    const atElbow = (p0) => moved(p0, r.elbow, Fe0, P[elbow], Fe, s);
    const atWrist = (p0) => moved(p0, r.wrist, Fw0, P[wrist], Fw, s);
    this.place(`radius${side}`, segment(r.radiusNear, r.radiusFar, t0, atElbow(r.radiusNear), atWrist(r.radiusFar), t, s));
    this.place(`ulna${side}`, segment(r.ulnaNear, r.ulnaFar, n0, atElbow(r.ulnaNear), atWrist(r.ulnaFar), hinge, s));

    // Whole hand, as one piece, pointing at the knuckles
    if (hasHand) {
      const k0 = mid(r.indexKnuckle, r.littleKnuckle), k = mid(P[index], P[little]);
      const along0 = sub(k0, r.wrist), along = sub(k, P[wrist]);
      const sLong = clamp(along.length() / along0.length(), s * 0.5, s * 1.4);
      const wide = clamp(t.length() / t0.length(), s * 0.6, s * 1.4);
      this.place(`hand${side}`, carry(r.wrist, axes(along0, t0), P[wrist], axes(along, t), sLong, wide, s));
    }
  }

  leg(limb, P, seen, s, pelvisX) {
    const { side, hip, knee, ankle, heel, toe } = limb;
    const r = this.rest[side];
    const a0 = sub(r.knee, r.hip);
    const fwd0 = sub(r.toe, r.heel);
    const shin0 = sub(r.ankle, r.knee);
    const n0 = new THREE.Vector3().crossVectors(a0, fwd0.clone().negate()).normalize();
    const hasFoot = seen(ankle, heel, toe);
    const fwd = hasFoot ? sub(P[toe], P[heel]) : null;

    // Knee hinge direction: from the bend if the knee is bent, otherwise from where the foot points
    const a = seen(hip, knee) ? sub(P[knee], P[hip]) : null;
    const shin = seen(knee, ankle) ? sub(P[ankle], P[knee]) : null;
    let hinge = pelvisX.clone();
    if (fwd && (a || shin)) {
      hinge = new THREE.Vector3().crossVectors(a || shin, fwd.clone().negate()).normalize();
    }
    if (a && shin) {
      const n = new THREE.Vector3().crossVectors(a, shin);
      const bend = n.length() / ((a.length() * shin.length()) || 1);
      const k = smooth(0.2, 0.55, bend);
      hinge = hinge.multiplyScalar(1 - k).add(n.normalize().multiplyScalar(k));
    }

    if (a) {
      this.place(`femur${side}`, segment(r.hip, r.knee, n0, P[hip], P[knee], hinge, s));
      this.place(`patella${side}`, carry(r.knee, axes(a0, n0), P[knee], axes(a, hinge), s, s));
    }
    if (!shin) return;
    const ankleHinge = fwd ? new THREE.Vector3().crossVectors(shin, fwd.clone().negate()) : hinge;
    const Fk0 = axes(shin0, n0), Fk = axes(shin, hinge);
    const Fa0 = axes(shin0, n0), Fa = axes(shin, ankleHinge);
    const atKnee = (p0) => moved(p0, r.knee, Fk0, P[knee], Fk, s);
    const atAnkle = (p0) => moved(p0, r.ankle, Fa0, P[ankle], Fa, s);
    this.place(`tibia${side}`, segment(r.tibiaNear, r.tibiaFar, n0, atKnee(r.tibiaNear), atAnkle(r.tibiaFar), hinge, s));
    this.place(`fibula${side}`, segment(r.fibulaNear, r.fibulaFar, n0, atKnee(r.fibulaNear), atAnkle(r.fibulaFar), hinge, s));

    if (hasFoot) {
      const sLong = clamp(fwd.length() / fwd0.length(), s * 0.4, s * 1.4);
      const y0 = new THREE.Vector3().crossVectors(shin0, fwd0.clone().negate());
      this.place(`foot${side}`, carry(r.ankle, axes(fwd0, y0), P[ankle], axes(fwd, ankleHinge), sLong, s));
    }
  }

  tissue(t, color, spread) {
    const pts = this.points;
    const seen = this.seen;
    if (!seen) return;
    const T = this.unit * spread;
    const mids = (a, b) => ({ x: (pts[a].x + pts[b].x) / 2, y: (pts[a].y + pts[b].y) / 2 });
    if (seen(11, 12) && seen(23, 24)) fillPoly(t, [pts[11], pts[12], pts[24], pts[23]], 0.2 * T);
    else if (seen(11, 12)) {
      const dx = (pts[11].x - pts[12].x), dy = (pts[11].y - pts[12].y);
      const dn = { x: -dy, y: dx };
      const sign = seen(0) && (dn.x * (pts[0].x - pts[11].x) + dn.y * (pts[0].y - pts[11].y)) > 0 ? -1 : 1;
      fillPoly(t, [pts[11], pts[12],
        { x: pts[12].x + dn.x * sign * 1.3, y: pts[12].y + dn.y * sign * 1.3 },
        { x: pts[11].x + dn.x * sign * 1.3, y: pts[11].y + dn.y * sign * 1.3 }], 0.2 * T);
    }
    for (const { shoulder, elbow, wrist, index, hip, knee, ankle, toe } of [LEFT, RIGHT]) {
      if (seen(shoulder, elbow)) strokeLine(t, [pts[shoulder], pts[elbow]], 0.17 * T);
      if (seen(elbow, wrist)) strokeLine(t, [pts[elbow], pts[wrist]], 0.13 * T);
      if (seen(wrist, index)) strokeLine(t, [pts[wrist], pts[index]], 0.12 * T);
      if (seen(hip, knee)) strokeLine(t, [pts[hip], pts[knee]], 0.27 * T);
      if (seen(knee, ankle)) strokeLine(t, [pts[knee], pts[ankle]], 0.18 * T);
      if (seen(ankle, toe)) strokeLine(t, [pts[ankle], pts[toe]], 0.1 * T);
    }
    if (seen(0)) {
      if (seen(11, 12)) strokeLine(t, [mids(11, 12), pts[0]], 0.16 * T);
      const earSpan = seen(7, 8) ? Math.hypot(pts[7].x - pts[8].x, pts[7].y - pts[8].y) : 0;
      strokeLine(t, [pts[0], { x: pts[0].x + 0.1, y: pts[0].y }], Math.max(earSpan * 1.25, 0.32 * T));
    }
  }

  labels() {
    const pts = this.points;
    const mx = pts ? (pts[11].x + pts[12].x + pts[23].x + pts[24].x) / 4 : 0;
    const wanted = [
      ['skull', 'Skull'], ['clavicle', 'Clavicle'], ['ribsTrue', 'Ribs'], ['thoracic', 'Spine'], ['humerus', 'Humerus'],
      ['radius', 'Radius & ulna'], ['hipBone', 'Pelvis'], ['femur', 'Femur'], ['tibia', 'Tibia & fibula'], ['footBones', 'Foot'],
    ];
    const out = [];
    for (const [id, text] of wanted) {
      const at = this.center({ id });
      if (!at) continue;
      const dir = at.x >= mx ? 1 : -1;
      out.push({ text, at, to: { x: at.x + dir * 0.6 * this.unit, y: at.y } });
    }
    return out;
  }
}
