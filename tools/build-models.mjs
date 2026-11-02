// Turns the BodyParts3D bone files into the three small 3D models the app loads:
//   models/hand.glb   every hand bone by name, smoothed for close-ups
//   models/skull.glb  every skull bone by name
//   models/body.glb   the whole skeleton, lighter for when it is small on screen
//
// usage:  node build-models.mjs <folder with FJ*.obj files> <isa_element_parts.txt> <output folder>
//
// BodyParts3D coordinates are millimetres on one standing adult:
//   +X = the person's left, +Y = towards their back, +Z = up

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { readObj } from './lib-obj.mjs';
import {
  computeNormals, neighbours, boneEnds, principalAxis, RayTree,
  bakeOpenness, bakeThickness, bakeRidges,
} from './lib-mesh.mjs';

const [objDir, partsFile, outDir] = process.argv.slice(2);
if (!objDir || !partsFile || !outDir) {
  console.error('usage: node build-models.mjs <objDir> <isa_element_parts.txt> <outDir>');
  process.exit(1);
}
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

// ---------------------------------------------------------------------------
// Finding bones by name
// ---------------------------------------------------------------------------
const filesByName = {};
for (const line of readFileSync(partsFile, 'latin1').split(/\r?\n/).slice(1)) {
  const r = line.split('\t');
  if (r.length >= 3) (filesByName[r[1]] = filesByName[r[1]] || []).push(r[2]);
}

const cache = new Map();
function loadBone(name) {
  if (cache.has(name)) return cache.get(name);
  const files = filesByName[name];
  if (!files) throw new Error(`Not in the parts list: ${name}`);
  // A few names list the same shape twice (for example the hyoid); one is enough
  const mesh = readObj(join(objDir, `${files[0]}.obj`));
  cache.set(name, mesh);
  return mesh;
}

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const FINGER = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger'];
const TOE = ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe'];

const CARPALS = {
  scaphoid: 'right scaphoid', lunate: 'right lunate', triquetrum: 'right triquetral', pisiform: 'right pisiform',
  trapezium: 'right trapezium', trapezoid: 'right trapezoid', capitate: 'right capitate', hamate: 'right hamate',
};
const mcName = (f) => `right ${ORD[f]} metacarpal bone`;
const ppName = (f) => `proximal phalanx of right ${FINGER[f]}`;
const mpName = (f) => `middle phalanx of right ${FINGER[f]}`;
const dpName = (f) => `distal phalanx of right ${FINGER[f]}`;

const HAND_NAMES = [
  ...Object.values(CARPALS),
  ...[0, 1, 2, 3, 4].map(mcName), ...[0, 1, 2, 3, 4].map(ppName), ...[1, 2, 3, 4].map(mpName), ...[0, 1, 2, 3, 4].map(dpName),
];
const FOOT_NAMES = [
  'right talus', 'right calcaneus', 'navicular bone of right foot', 'right cuboid bone',
  'right medial cuneiform bone', 'right intermediate cuneiform bone', 'right lateral cuneiform bone',
  ...[0, 1, 2, 3, 4].map((t) => `right ${ORD[t]} metatarsal bone`),
  ...[0, 1, 2, 3, 4].map((t) => `proximal phalanx of right ${TOE[t]}`),
  ...[1, 2, 3, 4].map((t) => `middle phalanx of right ${TOE[t]}`),
  ...[0, 1, 2, 3, 4].map((t) => `distal phalanx of right ${TOE[t]}`),
];
const both = (name) => [`right ${name}`, `left ${name}`];
const TEETH_UPPER = [
  'upper central secondary incisor tooth', 'upper lateral secondary incisor tooth', 'upper secondary canine tooth',
  'upper first secondary premolar tooth', 'upper second secondary premolar tooth', 'upper first secondary molar tooth', 'upper second secondary molar tooth',
].flatMap(both);
const TEETH_LOWER = [
  'lower central secondary incisor tooth', 'lower lateral secondary incisor tooth', 'lower secondary canine tooth',
  'lower first secondary premolar tooth', 'lower second secondary premolar tooth', 'lower first secondary molar tooth', 'lower second secondary molar tooth',
].flatMap(both);
const SKULL_PARTS = {
  frontal: ['frontal bone'],
  parietal: both('parietal bone'),
  temporal: both('temporal bone'),
  occipital: ['occipital bone'],
  sphenoid: ['sphenoid bone'],
  ethmoid: ['ethmoid'],
  zygomatic: both('zygomatic bone'),
  lacrimal: both('lacrimal bone'),
  nasal: both('nasal bone'),
  maxilla: both('maxilla'),
  palatine: both('palatine bone'),
  concha: both('inferior nasal concha'),
  vomer: ['vomer'],
};

// ---------------------------------------------------------------------------
// Preparing one bone's surface
// ---------------------------------------------------------------------------
function surfaceArea(positions, indices) {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

function simplifyTo(mesh, targetTris) {
  const current = mesh.indices.length / 3;
  if (targetTris >= current) return mesh;
  const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, targetTris * 3, 0.03);
  // Keep only the points still in use
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1);
  const positions = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (remap[v] < 0) {
      remap[v] = positions.length / 3;
      positions.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
    }
    out[i] = remap[v];
  }
  return { positions: new Float32Array(positions), indices: out };
}

// Splits every triangle in four, placing the new points on the smooth curve the
// surface normals describe. Unlike ordinary smoothing, the original points stay
// exactly where they are, so the bone keeps its real shape and size.
function refine(mesh) {
  const { positions, indices } = mesh;
  const normals = computeNormals(positions, indices);
  const newPos = Array.from(positions);
  const edges = new Map();
  const midpoint = (a, b) => {
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    let id = edges.get(key);
    if (id !== undefined) return id;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const an = dx * normals[a * 3] + dy * normals[a * 3 + 1] + dz * normals[a * 3 + 2];
    const bn = dx * normals[b * 3] + dy * normals[b * 3 + 1] + dz * normals[b * 3 + 2];
    id = newPos.length / 3;
    newPos.push(
      (ax + bx) / 2 + (an * normals[a * 3] - bn * normals[b * 3]) / 8,
      (ay + by) / 2 + (an * normals[a * 3 + 1] - bn * normals[b * 3 + 1]) / 8,
      (az + bz) / 2 + (an * normals[a * 3 + 2] - bn * normals[b * 3 + 2]) / 8,
    );
    edges.set(key, id);
    return id;
  };
  const out = new Uint32Array(indices.length * 4);
  let k = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    out[k++] = a; out[k++] = ab; out[k++] = ca;
    out[k++] = b; out[k++] = bc; out[k++] = ab;
    out[k++] = c; out[k++] = ca; out[k++] = bc;
    out[k++] = ab; out[k++] = bc; out[k++] = ca;
  }
  return { positions: new Float32Array(newPos), indices: out };
}

// Prepares one source bone: right detail level, plus its own surface bakes
function prepareBone(name, { density, refineLevels = 0, long = false, maxThick = 20 }) {
  const raw = loadBone(name);
  let mesh = raw;
  if (density) {
    const area = surfaceArea(raw.positions, raw.indices);
    mesh = simplifyTo(raw, Math.max(60, Math.round(area * density)));
  }
  for (let i = 0; i < refineLevels; i++) mesh = refine(mesh);
  const normals = computeNormals(mesh.positions, mesh.indices);
  const count = mesh.positions.length / 3;
  const adj = neighbours(count, mesh.indices);
  const ridges = bakeRidges(mesh.positions, normals, adj, 2.2, 1 + refineLevels * 2);
  const tree = new RayTree(mesh.positions, mesh.indices);
  const thick = bakeThickness(mesh.positions, normals, tree, maxThick);
  // Shaft (0) to joint end (1), for bones that have a clear long axis
  const ends = new Float32Array(count).fill(long ? 0 : 0.5);
  if (long) {
    const e = boneEnds(mesh.positions);
    for (let v = 0; v < count; v++) {
      const t = Math.abs((e.along[v] - e.lo) / (e.length || 1) * 2 - 1);
      const x = Math.max(0, Math.min(1, (t - 0.62) / 0.3));
      ends[v] = x * x * (3 - 2 * x);
    }
  }
  return { name, positions: mesh.positions, indices: mesh.indices, normals, ridges, thick, ends };
}

// Joins prepared bones into one part
function mergeBones(list) {
  const vertexCount = list.reduce((n, b) => n + b.positions.length / 3, 0);
  const indexCount = list.reduce((n, b) => n + b.indices.length, 0);
  const out = {
    positions: new Float32Array(vertexCount * 3), normals: new Float32Array(vertexCount * 3),
    ridges: new Float32Array(vertexCount), thick: new Float32Array(vertexCount), ends: new Float32Array(vertexCount),
    indices: new Uint32Array(indexCount),
  };
  let vo = 0, io = 0;
  for (const b of list) {
    out.positions.set(b.positions, vo * 3);
    out.normals.set(b.normals, vo * 3);
    out.ridges.set(b.ridges, vo);
    out.thick.set(b.thick, vo);
    out.ends.set(b.ends, vo);
    for (let i = 0; i < b.indices.length; i++) out.indices[io++] = b.indices[i] + vo;
    vo += b.positions.length / 3;
  }
  return out;
}

function mirrored(part) {
  const p = Float32Array.from(part.positions);
  for (let i = 0; i < p.length; i += 3) p[i] = -p[i];
  return { positions: p, indices: part.indices };
}

// How much open space each point sees, counting everything that stays near it
function bakeLight(parts, radius, samples, extraBlockers = []) {
  const all = [...parts, ...extraBlockers];
  const vertexCount = all.reduce((n, b) => n + b.positions.length / 3, 0);
  const indexCount = all.reduce((n, b) => n + b.indices.length, 0);
  const pos = new Float32Array(vertexCount * 3);
  const idx = new Uint32Array(indexCount);
  let vo = 0, io = 0;
  for (const b of all) {
    pos.set(b.positions, vo * 3);
    for (let i = 0; i < b.indices.length; i++) idx[io++] = b.indices[i] + vo;
    vo += b.positions.length / 3;
  }
  const tree = new RayTree(pos, idx);
  for (const part of parts) part.light = bakeOpenness(part.positions, part.normals, tree, radius, samples);
}

// ---------------------------------------------------------------------------
// Writing a model file
// ---------------------------------------------------------------------------
async function writeModel(fileName, parts, meta) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('bones');
  scene.setExtras({ meta });
  let tris = 0, verts = 0;
  for (const part of parts) {
    const count = part.positions.length / 3;
    tris += part.indices.length / 3;
    verts += count;
    const bake = new Uint8Array(count * 4);
    const u8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
    for (let v = 0; v < count; v++) {
      bake[v * 4] = u8(part.light ? part.light[v] : 1);
      bake[v * 4 + 1] = u8(part.ridges[v]);
      bake[v * 4 + 2] = u8(part.ends[v]);
      bake[v * 4 + 3] = u8(part.thick[v]);
    }
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(part.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(part.normals)).setBuffer(buffer))
      .setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(bake).setNormalized(true).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(count < 65535 ? Uint16Array.from(part.indices) : Uint32Array.from(part.indices)).setBuffer(buffer));
    const mesh = doc.createMesh(part.key).addPrimitive(prim);
    const node = doc.createNode(part.key).setMesh(mesh);
    node.setExtras({ key: part.key, id: part.id, kind: part.kind || 'bone', mirror: part.mirror || false });
    scene.addChild(node);
  }
  doc.createExtension(KHRMeshQuantization);
  await doc.transform(meshopt({
    encoder: MeshoptEncoder,
    level: 'medium',
    quantizePosition: 14,
    quantizeNormal: 10,
    quantizeColor: 8,
    quantizationVolume: 'mesh',
  }));
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const bytes = await io.writeBinary(doc);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, fileName), bytes);
  console.log(`${fileName}: ${parts.length} parts, ${tris} triangles, ${verts} points, ${(bytes.length / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------------------
// Where the joints are on the model
// ---------------------------------------------------------------------------
const mid = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const along = (a, d, k) => [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];
const unitv = (a, b) => { const l = dist(a, b) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; };
const roundp = (p) => p.map((v) => Math.round(v * 100) / 100);

// A long bone's two ends, with `near` being the end closest to the given point
function endsToward(name, point) {
  const e = boneEnds(loadBone(name).positions);
  return dist(e.a, point) < dist(e.b, point) ? { near: e.a, far: e.b, axis: unitv(e.b, e.a) } : { near: e.b, far: e.a, axis: unitv(e.a, e.b) };
}
const centre = (name) => principalAxis(loadBone(name).positions).center;

function handJoints() {
  const J = new Array(21);
  const carpus = centre('right capitate');
  const FINGER_TIP_SKIN = 2.5; // mm from the bone tip to where the tracker sees the fingertip
  const mcBase = [];
  // Thumb: 1 CMC, 2 MCP, 3 IP, 4 tip. Fingers: knuckle, two joints, tip.
  for (let f = 0; f < 5; f++) {
    const chain = f === 0
      ? [mcName(0), ppName(0), dpName(0)]
      : [mcName(f), ppName(f), mpName(f), dpName(f)];
    const pts = [];
    let prevHead = null;
    chain.forEach((name, i) => {
      const toNext = i < chain.length - 1 ? centre(chain[i + 1]) : null;
      const toPrev = i > 0 ? centre(chain[i - 1]) : carpus;
      const base = endsToward(name, toPrev).near;
      const head = toNext ? endsToward(name, toNext).near : endsToward(name, toPrev).far;
      if (i === 0) mcBase[f] = base;
      if (prevHead) pts.push(mid(prevHead, base));
      prevHead = head;
    });
    const last = chain[chain.length - 1];
    const lastEnds = endsToward(last, centre(chain[chain.length - 2]));
    const tip = along(lastEnds.far, unitv(lastEnds.near, lastEnds.far), FINGER_TIP_SKIN);
    if (f === 0) {
      J[1] = mcBase[0]; J[2] = pts[0]; J[3] = pts[1]; J[4] = tip;
    } else {
      const k = f * 4 + 1;
      J[k] = pts[0]; J[k + 1] = pts[1]; J[k + 2] = pts[2]; J[k + 3] = tip;
    }
  }
  // The tracker's wrist point sits at the wrist crease, over the first row of wrist bones
  const lunate = centre('right lunate');
  const scaphoid = centre('right scaphoid');
  const triquetrum = centre('right triquetral');
  J[0] = mid(mid(scaphoid, triquetrum), lunate);
  const forearmEnd = mid(endsToward('right radius', scaphoid).far, endsToward('right ulna', scaphoid).far);
  return { joints: J.map(roundp), mcBase: mcBase.map(roundp), forearmEnd: roundp(forearmEnd) };
}

// Centre of the ball at the top of the thigh bone
function femoralHead() {
  const { positions } = loadBone('right femur');
  let zMax = -Infinity;
  for (let i = 2; i < positions.length; i += 3) zMax = Math.max(zMax, positions[i]);
  // The ball is on the inner side, higher than anything else on the bone
  let x = 0, y = 0, z = 0, m = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 2] > zMax - 45) {
      const inner = positions[i] > -105;
      if (inner) { x += positions[i]; y += positions[i + 1]; z += positions[i + 2]; m++; }
    }
  }
  return [x / m, y / m, z / m];
}

function humeralHead() {
  const { positions } = loadBone('right humerus');
  let zMax = -Infinity;
  for (let i = 2; i < positions.length; i += 3) zMax = Math.max(zMax, positions[i]);
  let x = 0, y = 0, z = 0, m = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 2] > zMax - 40) { x += positions[i]; y += positions[i + 1]; z += positions[i + 2]; m++; }
  }
  return [x / m, y / m, z / m];
}

// The face's main landmarks, measured on the model's skin surface
function faceSkinPoints() {
  const skin = readObj(join(objDir, `${filesByName.skin[0]}.obj`)).positions;
  const find = (test, score) => {
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < skin.length; i += 3) {
      const x = skin[i], y = skin[i + 1], z = skin[i + 2];
      if (test(x, y, z)) {
        const s = score(x, y, z);
        if (s > bestScore) { bestScore = s; best = [x, y, z]; }
      }
    }
    return best;
  };
  const midline = (x, y) => Math.abs(x) < 5 && y < -100;
  const noseTip = find((x, y, z) => midline(x, y) && z > 1470 && z < 1530, (x, y) => -y);
  // Subnasale: the deepest point on the midline just under the nose
  const subnasale = find((x, y, z) => midline(x, y) && z > noseTip[2] - 25 && z < noseTip[2] - 14, (x, y) => y);
  // Nasion: the deepest point on the midline at eye level
  const nasion = find((x, y, z) => midline(x, y) && z > noseTip[2] + 30 && z < noseTip[2] + 50, (x, y) => y);
  const chin = find((x, y, z) => midline(x, y) && z > 1380 && z < noseTip[2], (x, y, z) => -z + (y < -150 ? 0 : -1000));
  // The bridge of the nose level with the eyes, which is where the tracker marks "between the eyes"
  const eyeLevel = centre('right lens')[2];
  const bridge = find((x, y, z) => midline(x, y) && z > eyeLevel && z < eyeLevel + 5, (x, y) => -y);
  // The width of the face at the cheeks, just in front of the ears
  const cheek = find((x, y, z) => x < 0 && z > noseTip[2] - 10 && z < noseTip[2] + 15 && y < -85 && y > -125, (x) => -x);
  return { noseTip: roundp(noseTip), subnasale: roundp(subnasale), nasion: roundp(nasion), chin: roundp(chin), bridge: roundp(bridge), faceWidth: Math.round(Math.abs(cheek[0]) * 200) / 100 };
}

function headMeta() {
  const lensR = centre('right lens');
  const eye = roundp([lensR[0], lensR[1] + 9, lensR[2]]); // eyeball centre, a little behind the lens
  const ear = readObj(join(objDir, `${filesByName['external ear'][0]}.obj`)).positions;
  // The ear canal: middle of the outer ear on the right side
  let ex = 0, ey = 0, ez = 0, m = 0;
  for (let i = 0; i < ear.length; i += 3) {
    if (ear[i] < 0) { ex += ear[i]; ey += ear[i + 1]; ez += ear[i + 2]; m++; }
  }
  // The jaw hinge: the top of the mandible on the right side
  const jaw = loadBone('mandible').positions;
  let hx = 0, hy = 0, hz = 0, hm = 0;
  let zTop = -Infinity;
  for (let i = 0; i < jaw.length; i += 3) if (jaw[i] < 0 && jaw[i + 1] > -125) zTop = Math.max(zTop, jaw[i + 2]);
  for (let i = 0; i < jaw.length; i += 3) {
    if (jaw[i] < 0 && jaw[i + 1] > -125 && jaw[i + 2] > zTop - 7) { hx += jaw[i]; hy += jaw[i + 1]; hz += jaw[i + 2]; hm++; }
  }
  // Teeth: the line where the top and bottom incisors meet
  const upper = loadBone('right upper central secondary incisor tooth').positions;
  const lower = loadBone('right lower central secondary incisor tooth').positions;
  let upperZ = Infinity, lowerZ = -Infinity, frontY = Infinity;
  for (let i = 0; i < upper.length; i += 3) { upperZ = Math.min(upperZ, upper[i + 2]); frontY = Math.min(frontY, upper[i + 1]); }
  for (let i = 0; i < lower.length; i += 3) lowerZ = Math.max(lowerZ, lower[i + 2]);
  return {
    eye,
    ear: roundp([ex / m, ey / m, ez / m]),
    jawHinge: roundp([hx / hm, hy / hm, hz / hm]),
    biteZ: Math.round(((upperZ + lowerZ) / 2) * 100) / 100,
    teethFrontY: Math.round(frontY * 100) / 100,
    ...faceSkinPoints(),
  };
}

function limbMeta(hand) {
  const shoulder = humeralHead();
  const elbowProbe = centre('right ulna');
  const humerus = endsToward('right humerus', elbowProbe);
  const radius = endsToward('right radius', humerus.near);
  const ulna = endsToward('right ulna', humerus.near);
  const elbow = mid(humerus.near, mid(radius.near, ulna.near));
  const wrist = mid(radius.far, ulna.far);
  const hip = femoralHead();
  const femur = endsToward('right femur', centre('right tibia'));
  const tibia = endsToward('right tibia', femur.near);
  const fibula = endsToward('right fibula', femur.near);
  const knee = mid(femur.near, tibia.near);
  // The ankle sits where the shin meets the top of the talus
  const talus = loadBone('right talus').positions;
  let tz = -Infinity;
  for (let i = 2; i < talus.length; i += 3) tz = Math.max(tz, talus[i]);
  let ax = 0, ay = 0, az = 0, am = 0;
  for (let i = 0; i < talus.length; i += 3) {
    if (talus[i + 2] > tz - 8) { ax += talus[i]; ay += talus[i + 1]; az += talus[i + 2]; am++; }
  }
  const ankle = [ax / am, ay / am, az / am];
  // Back of the heel and tip of the second toe
  const heelBone = loadBone('right calcaneus').positions;
  let heel = null, hy = -Infinity;
  for (let i = 0; i < heelBone.length; i += 3) if (heelBone[i + 1] > hy) { hy = heelBone[i + 1]; heel = [heelBone[i], heelBone[i + 1], heelBone[i + 2]]; }
  const toeBone = loadBone('distal phalanx of right second toe').positions;
  let toe = null, ty = Infinity;
  for (let i = 0; i < toeBone.length; i += 3) if (toeBone[i + 1] < ty) { ty = toeBone[i + 1]; toe = [toeBone[i], toeBone[i + 1], toeBone[i + 2]]; }
  const clavicle = boneEnds(loadBone('right clavicle').positions);
  const clavicleInner = clavicle.a[0] > clavicle.b[0] ? clavicle.a : clavicle.b;
  const clavicleOuter = clavicle.a[0] > clavicle.b[0] ? clavicle.b : clavicle.a;
  return {
    shoulder, elbow, wrist, hip, knee, ankle, heel, toe,
    radiusNear: radius.near, radiusFar: radius.far, ulnaNear: ulna.near, ulnaFar: ulna.far,
    fibulaNear: fibula.near, fibulaFar: fibula.far, tibiaNear: tibia.near, tibiaFar: tibia.far,
    humerusFar: humerus.near, clavicleInner, clavicleOuter,
    indexKnuckle: hand.joints[5], littleKnuckle: hand.joints[17], thumbKnuckle: hand.joints[3],
  };
}

function roundAll(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Array.isArray(v) ? roundp(v) : v;
  return out;
}

// ---------------------------------------------------------------------------
// The three models
// ---------------------------------------------------------------------------
function part(key, id, names, opts) {
  const list = names.map((n) => prepareBone(n, opts));
  return { key, id, kind: opts.kind, mirror: opts.mirror, sourceNames: names, ...mergeBones(list) };
}

async function buildHand(handMeta) {
  const closeUp = { refineLevels: 1, long: true, maxThick: 14 };
  const carpal = { refineLevels: 1, long: false, maxThick: 14 };
  const parts = [];
  for (const [key, name] of Object.entries(CARPALS)) parts.push(part(key, key, [name], carpal));
  for (let f = 0; f < 5; f++) {
    const n = f + 1;
    parts.push(part(`mc${n}`, `mc${n}`, [mcName(f)], closeUp));
    parts.push(part(`pp${n}`, `pp${n}`, [ppName(f)], closeUp));
    if (f > 0) parts.push(part(`mp${n}`, `mp${n}`, [mpName(f)], closeUp));
    parts.push(part(`dp${n}`, `dp${n}`, [dpName(f)], closeUp));
  }
  // The forearm bones have few triangles in the source and run the full length of the screen
  const forearm = { refineLevels: 2, long: true, maxThick: 22 };
  parts.push(part('radius', 'radius', ['right radius'], forearm));
  parts.push(part('ulna', 'ulna', ['right ulna'], forearm));
  bakeLight(parts, 9, 48);
  await writeModel('hand.glb', parts, { hand: handMeta });
}

async function buildSkull(head) {
  const opts = { density: 0.42, long: false, maxThick: 12 };
  const parts = [];
  for (const [id, names] of Object.entries(SKULL_PARTS)) parts.push(part(id, id, names, opts));
  parts.push(part('mandible', 'mandible', ['mandible'], { ...opts, maxThick: 16 }));
  parts.push(part('teethUpper', 'teeth', TEETH_UPPER, { density: 1.2, long: false, maxThick: 10, kind: 'tooth' }));
  parts.push(part('teethLower', 'teeth', TEETH_LOWER, { density: 1.2, long: false, maxThick: 10, kind: 'tooth' }));
  parts.push(part('hyoid', 'hyoid', ['hyoid bone'], { ...opts, maxThick: 6 }));
  bakeLight(parts, 34, 64);
  await writeModel('skull.glb', parts, { head });
}

async function buildBody(handMeta, head, limbs) {
  const axial = { density: 0.1, long: false, maxThick: 30 };
  const longBone = { density: 0.1, long: true, maxThick: 34 };
  const small = { density: 0.28, long: false, maxThick: 14 };
  const parts = [];

  // Ribs, breastbone and upper spine stay together as one rigid chest
  const chest = [];
  const ribList = (from, to) => ORD.slice(from, to).flatMap((o) => [`right ${o} rib`, `left ${o} rib`]);
  const ribOpts = { density: 0.12, long: true, maxThick: 10 };
  chest.push(part('ribsTrue', 'ribsTrue', ribList(0, 7), ribOpts));
  chest.push(part('ribsFalse', 'ribsFalse', ribList(7, 10), ribOpts));
  chest.push(part('ribsFloating', 'ribsFloating', ribList(10, 12), ribOpts));
  const cartilageNames = ORD.slice(0, 7).flatMap((o) => [`right ${o} costal cartilage`, `left ${o} costal cartilage`]);
  chest.push(part('costalCartilage', 'costalCartilage', cartilageNames, { density: 0.1, long: false, maxThick: 10, kind: 'cartilage' }));
  chest.push(part('sternum', 'sternum', ['manubrium', 'body of sternum', 'xiphoid process'], { ...axial, maxThick: 14 }));
  chest.push(part('thoracic', 'thoracic', ORD.slice(0, 12).map((o) => `${o} thoracic vertebra`), axial));
  chest.push(part('scapula', 'scapula', ['right scapula'], { density: 0.1, long: false, maxThick: 16, mirror: true }));
  chest.push(part('clavicle', 'clavicle', ['right clavicle'], { ...longBone, density: 0.2, maxThick: 16, mirror: true }));
  const scapulaBlock = chest.find((p) => p.key === 'scapula');
  const clavicleBlock = chest.find((p) => p.key === 'clavicle');
  bakeLight(chest, 40, 40, [mirrored(scapulaBlock), mirrored(clavicleBlock)]);
  parts.push(...chest);

  // Pelvis and lower spine
  const pelvis = [];
  pelvis.push(part('hip', 'hipBone', ['right hip bone'], { density: 0.16, long: false, maxThick: 24, mirror: true }));
  pelvis.push(part('sacrum', 'sacrum', ['sacrum'], axial));
  const lumbarNames = ORD.slice(0, 5).map((o) => `${o} lumbar vertebra`);
  lumbarNames.forEach((name, i) => pelvis.push(part(`lumbar${i + 1}`, 'lumbar', [name], axial)));
  bakeLight(pelvis, 40, 40, [mirrored(pelvis[0])]);
  parts.push(...pelvis);

  // Neck: seven bones that each follow the head a little more than the last
  const neckNames = ['atlas', 'axis', ...['third', 'fourth', 'fifth', 'sixth', 'seventh'].map((o) => `${o} cervical vertebra`)];
  const neck = neckNames.map((name, i) => part(`cervical${i + 1}`, 'cervical', [name], { density: 0.2, long: false, maxThick: 18 }));
  bakeLight(neck, 26, 32);
  parts.push(...neck);

  // Arm
  const arm = [
    part('humerus', 'humerus', ['right humerus'], { ...longBone, maxThick: 28 }),
    part('radius', 'radius', ['right radius'], { refineLevels: 1, long: true, maxThick: 20 }),
    part('ulna', 'ulna', ['right ulna'], { refineLevels: 1, long: true, maxThick: 20 }),
  ];
  bakeLight(arm, 30, 32);
  parts.push(...arm);

  // A whole hand moves as one piece, because at this distance the tracker can't follow each finger
  const handPart = part('hand', 'handBones', HAND_NAMES, { density: 0.3, long: true, maxThick: 14 });
  bakeLight([handPart], 10, 32);
  parts.push(handPart);

  // Leg
  const leg = [
    part('femur', 'femur', ['right femur'], { ...longBone, maxThick: 34 }),
    part('tibia', 'tibia', ['right tibia'], { ...longBone, density: 0.14, maxThick: 34 }),
    part('fibula', 'fibula', ['right fibula'], { ...longBone, density: 0.16, maxThick: 16 }),
    part('patella', 'patella', ['right patella'], { long: false, maxThick: 22 }),
  ];
  bakeLight(leg, 30, 32);
  parts.push(...leg);

  const footPart = part('foot', 'footBones', FOOT_NAMES, { density: 0.22, long: false, maxThick: 18 });
  bakeLight([footPart], 12, 32);
  parts.push(footPart);

  // Whole skull, with the upper teeth built in
  const skullOpts = { density: 0.08, long: false, maxThick: 12 };
  const skullNames = Object.values(SKULL_PARTS).flat();
  const skullBones = part('skull', 'skull', skullNames, skullOpts);
  const upperTeeth = part('teethU', 'skull', TEETH_UPPER, { density: 0.25, long: false, maxThick: 10 });
  const jaw = part('mandible', 'mandible', ['mandible'], { density: 0.14, long: false, maxThick: 16 });
  const lowerTeeth = part('teethL', 'mandible', TEETH_LOWER, { density: 0.25, long: false, maxThick: 10 });
  const hyoid = part('hyoid', 'hyoid', ['hyoid bone'], { density: 0.3, long: false, maxThick: 6 });
  const skullAll = { key: 'skull', id: 'skull', ...mergeBones([skullBones, upperTeeth]) };
  const jawAll = { key: 'mandible', id: 'mandible', ...mergeBones([jaw, lowerTeeth]) };
  bakeLight([skullAll, jawAll, hyoid], 34, 32);
  parts.push(skullAll, jawAll, hyoid);

  await writeModel('body.glb', parts, { hand: handMeta, head, limbs: roundAll(limbs) });
}

const handMeta = handJoints();
const head = headMeta();
const limbs = limbMeta(handMeta);
console.log(JSON.stringify({ wrist: handMeta.joints[0], knuckle3: handMeta.joints[9], tip3: handMeta.joints[12], thumbBase: handMeta.joints[1], head, shoulder: roundp(limbs.shoulder), hip: roundp(limbs.hip), knee: roundp(limbs.knee), ankle: roundp(limbs.ankle), heel: limbs.heel, toe: limbs.toe }, null, 1));

const only = (process.argv[5] || 'hand,skull,body').split(',');
if (only.includes('hand')) await buildHand(handMeta);
if (only.includes('skull')) await buildSkull(head);
if (only.includes('body')) await buildBody(handMeta, head, limbs);
