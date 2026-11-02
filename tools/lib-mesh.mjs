// Geometry helpers for preparing the bones: smoothing normals, finding the long
// axis of a bone, and baking lighting detail into each corner of the model.

export function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    // Larger triangles count for more (the cross product is not normalised)
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

// Each vertex's neighbours, for smoothing and curvature
export function neighbours(vertexCount, indices) {
  const sets = Array.from({ length: vertexCount }, () => new Set());
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => [...s]);
}

// Direction a bone is longest in, using power iteration on its point spread
export function principalAxis(positions) {
  const count = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < positions.length; i += 3) { cx += positions[i]; cy += positions[i + 1]; cz += positions[i + 2]; }
  cx /= count; cy /= count; cz /= count;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - cx, y = positions[i + 1] - cy, z = positions[i + 2] - cz;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  let v = [1, 0.7, 0.3];
  for (let it = 0; it < 60; it++) {
    const nx = xx * v[0] + xy * v[1] + xz * v[2];
    const ny = xy * v[0] + yy * v[1] + yz * v[2];
    const nz = xz * v[0] + yz * v[1] + zz * v[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    v = [nx / l, ny / l, nz / l];
  }
  return { center: [cx, cy, cz], axis: v };
}

// Average position of the points in the outermost slice at each end of a bone
export function boneEnds(positions, slice = 0.06) {
  const { center, axis } = principalAxis(positions);
  let lo = Infinity, hi = -Infinity;
  const count = positions.length / 3;
  const t = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const d = (positions[i * 3] - center[0]) * axis[0] + (positions[i * 3 + 1] - center[1]) * axis[1] + (positions[i * 3 + 2] - center[2]) * axis[2];
    t[i] = d;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const len = hi - lo;
  const avg = (test) => {
    let x = 0, y = 0, z = 0, m = 0;
    for (let i = 0; i < count; i++) {
      if (test(t[i])) { x += positions[i * 3]; y += positions[i * 3 + 1]; z += positions[i * 3 + 2]; m++; }
    }
    return [x / m, y / m, z / m];
  };
  const add = (p, k) => [p[0] + axis[0] * k, p[1] + axis[1] * k, p[2] + axis[2] * k];
  return {
    center, axis, length: len, lo, hi,
    // Cluster centres, pushed out to the very end of the bone along its axis
    a: avg((d) => d < lo + len * slice),
    b: avg((d) => d > hi - len * slice),
    tipA: add(center, lo),
    tipB: add(center, hi),
    along: t,
  };
}

// ---------------------------------------------------------------------------
// A simple tree of boxes for firing rays at triangles quickly
// ---------------------------------------------------------------------------
export class RayTree {
  constructor(positions, indices) {
    this.p = positions;
    this.tri = indices;
    const count = indices.length / 3;
    this.order = new Uint32Array(count);
    const cx = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.order[i] = i;
      for (let k = 0; k < 3; k++) {
        cx[i * 3 + k] = (positions[indices[i * 3] * 3 + k] + positions[indices[i * 3 + 1] * 3 + k] + positions[indices[i * 3 + 2] * 3 + k]) / 3;
      }
    }
    this.nodes = [];
    this.build(0, count, cx);
  }

  build(start, end, cx) {
    const { p, tri, order } = this;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let c = 0; c < 3; c++) {
        const v = tri[t * 3 + c] * 3;
        for (let k = 0; k < 3; k++) {
          if (p[v + k] < min[k]) min[k] = p[v + k];
          if (p[v + k] > max[k]) max[k] = p[v + k];
        }
      }
    }
    const node = { min, max, start, end, left: -1, right: -1 };
    const id = this.nodes.length;
    this.nodes.push(node);
    if (end - start <= 6) return id;
    let axis = 0;
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    if (size[1] > size[axis]) axis = 1;
    if (size[2] > size[axis]) axis = 2;
    const part = order.subarray(start, end);
    part.sort((a, b) => cx[a * 3 + axis] - cx[b * 3 + axis]);
    const mid = (start + end) >> 1;
    node.left = this.build(start, mid, cx);
    node.right = this.build(mid, end, cx);
    return id;
  }

  // Distance to the nearest triangle along a ray, or Infinity.
  // With anyHit it stops at the first triangle found, which is faster.
  trace(ox, oy, oz, dx, dy, dz, tMax, anyHit = false) {
    const { nodes, p, tri, order } = this;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack = [0];
    let best = tMax;
    let found = false;
    while (stack.length) {
      const n = nodes[stack.pop()];
      let t0 = (n.min[0] - ox) * ix, t1 = (n.max[0] - ox) * ix;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      t0 = (n.min[1] - oy) * iy; t1 = (n.max[1] - oy) * iy;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      t0 = (n.min[2] - oz) * iz; t1 = (n.max[2] - oz) * iz;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax < Math.max(tmin, 0) || tmin > best) continue;
      if (n.left >= 0) { stack.push(n.left, n.right); continue; }
      for (let i = n.start; i < n.end; i++) {
        const t = order[i];
        const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
        const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
        const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const sx = ox - p[a], sy = oy - p[a + 1], sz = oz - p[a + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (d > 1e-4 && d < best) {
          best = d;
          found = true;
          if (anyHit) return best;
        }
      }
    }
    return found ? best : Infinity;
  }
}

// Evenly spread directions over a hemisphere, weighted the way light arrives
function hemisphereSamples(count) {
  const out = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * golden;
    out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
}

// How open each point is to the surroundings, from 0 (buried) to 1 (fully open)
export function bakeOpenness(positions, normals, tree, radius, samples = 48) {
  const count = positions.length / 3;
  const out = new Float32Array(count);
  const dirs = hemisphereSamples(samples);
  const eps = radius * 0.004 + 0.02;
  for (let v = 0; v < count; v++) {
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    // Two directions along the surface
    let tx = Math.abs(nx) < 0.8 ? 1 : 0, ty = Math.abs(nx) < 0.8 ? 0 : 1, tz = 0;
    const ax = ny * tz - nz * ty, ay = nz * tx - nx * tz, az = nx * ty - ny * tx;
    const al = Math.hypot(ax, ay, az) || 1;
    const ux = ax / al, uy = ay / al, uz = az / al;
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    const ox = positions[v * 3] + nx * eps, oy = positions[v * 3 + 1] + ny * eps, oz = positions[v * 3 + 2] + nz * eps;
    let open = 0;
    for (const d of dirs) {
      const dx = ux * d[0] + wx * d[1] + nx * d[2] || 1e-6;
      const dy = uy * d[0] + wy * d[1] + ny * d[2] || 1e-6;
      const dz = uz * d[0] + wz * d[1] + nz * d[2] || 1e-6;
      const hit = tree.trace(ox, oy, oz, dx, dy, dz, radius);
      // Nearby blockers matter more than distant ones
      open += hit === Infinity ? 1 : (hit / radius) ** 2;
    }
    out[v] = open / samples;
  }
  return out;
}

// Wall thickness behind each point: distance straight through the bone
export function bakeThickness(positions, normals, tree, maxThick) {
  const count = positions.length / 3;
  const out = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    const eps = 0.03;
    const hit = tree.trace(
      positions[v * 3] - nx * eps, positions[v * 3 + 1] - ny * eps, positions[v * 3 + 2] - nz * eps,
      -nx || 1e-6, -ny || 1e-6, -nz || 1e-6, maxThick,
    );
    out[v] = hit === Infinity ? 1 : hit / maxThick;
  }
  return out;
}

// Hollows and ridges: 0 = deep hollow, 0.5 = flat, 1 = sharp ridge
export function bakeRidges(positions, normals, adj, gain = 2.2, smoothing = 1) {
  const count = positions.length / 3;
  let out = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    let sum = 0, m = 0;
    for (const w of adj[v]) {
      const dx = positions[w * 3] - positions[v * 3], dy = positions[w * 3 + 1] - positions[v * 3 + 1], dz = positions[w * 3 + 2] - positions[v * 3 + 2];
      const l = Math.hypot(dx, dy, dz) || 1;
      sum += (dx * normals[v * 3] + dy * normals[v * 3 + 1] + dz * normals[v * 3 + 2]) / l;
      m++;
    }
    // Neighbours above the surface mean this point sits in a hollow
    out[v] = 0.5 - (m ? sum / m : 0) * gain;
  }
  for (let s = 0; s < smoothing; s++) {
    const next = new Float32Array(count);
    for (let v = 0; v < count; v++) {
      let sum = out[v], m = 1;
      for (const w of adj[v]) { sum += out[w]; m++; }
      next[v] = sum / m;
    }
    out = next;
  }
  for (let v = 0; v < count; v++) out[v] = Math.max(0, Math.min(1, out[v]));
  return out;
}
