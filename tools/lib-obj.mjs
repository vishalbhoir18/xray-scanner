// Reads a BodyParts3D .obj file into plain arrays, with duplicate points merged.
import { readFileSync } from 'node:fs';

export function readObj(path) {
  const text = readFileSync(path, 'latin1');
  const positions = [];
  const remap = [];          // obj vertex number -> merged vertex number
  const seen = new Map();
  const indices = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const c0 = text.charCodeAt(start), c1 = text.charCodeAt(start + 1);
    if (c0 === 118 /* v */ && c1 === 32) {
      const [x, y, z] = text.slice(start + 2, end).trim().split(/\s+/).map(Number);
      const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      let id = seen.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        positions.push(x, y, z);
        seen.set(key, id);
      }
      remap.push(id);
    } else if (c0 === 102 /* f */ && c1 === 32) {
      const corners = text.slice(start + 2, end).trim().split(/\s+/).map((tok) => {
        const n = parseInt(tok, 10);
        return n < 0 ? remap[remap.length + n] : remap[n - 1];
      });
      for (let i = 1; i < corners.length - 1; i++) {
        const a = corners[0], b = corners[i], c = corners[i + 1];
        if (a !== b && b !== c && a !== c) indices.push(a, b, c);
      }
    }
    start = end + 1;
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (positions[i + k] < min[k]) min[k] = positions[i + k];
      if (positions[i + k] > max[k]) max[k] = positions[i + k];
    }
  }
  return { min, max };
}
