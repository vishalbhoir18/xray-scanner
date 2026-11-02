// Draws the 3D bones with three.js, on a see-through layer over the camera.
//   - look 'bone': realistic bone surface with lighting and soft shadows
//   - look 'xray': a simulated X-ray film, where bones glow and overlaps add up
//
// Coordinates: X is canvas pixels to the right, Y is canvas pixels up from the
// bottom, and Z comes towards the viewer. The camera looks straight along Z with
// no perspective, so a point lands exactly where its tracked pixel is.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Each point on a model carries four baked values (see tools/build-models.mjs):
//   r = how much light reaches it, g = hollow (0) to ridge (1),
//   b = shaft (0) to joint end (1), a = how thick the bone is there
//
// Surface detail comes from a 3D noise pattern tied to the bone, so it stays put as
// the bone moves. Each layer is turned to a different angle so no grid shows.
const NOISE_GLSL = /* glsl */`
  uniform highp sampler3D uNoise;
  const mat3 TURN_A = mat3(0.36, 0.48, -0.80, -0.80, 0.60, 0.00, 0.48, 0.64, 0.60);
  const mat3 TURN_B = mat3(0.54, -0.61, 0.58, 0.84, 0.38, -0.39, 0.02, 0.70, 0.72);
  const mat3 TURN_C = mat3(0.28, 0.93, 0.24, -0.71, 0.04, 0.70, 0.64, -0.36, 0.67);
  float nz(vec3 p) { return texture(uNoise, p).r; }
`;

const FADE_GLSL = /* glsl */`
  uniform vec3 uFadeFrom;
  uniform vec3 uFadeTo;
  float boneFade(vec3 p) {
    vec3 line = uFadeTo - uFadeFrom;
    float l = dot(line, line);
    return l > 0.0 ? 1.0 - smoothstep(0.0, 1.0, dot(p - uFadeFrom, line) / l) : 1.0;
  }
`;

function makeNoiseTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * size);
  const layers = [[4, 0.34], [8, 0.27], [16, 0.22], [32, 0.17]];
  // A fixed seed keeps the bones looking the same on every visit
  let seed = 90210;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const grids = layers.map(([n]) => {
    const g = new Float32Array(n * n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return g;
  });
  const fade = (t) => t * t * (3 - 2 * t);
  const mix = (a, b, t) => a + (b - a) * t;
  let k = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        for (let l = 0; l < layers.length; l++) {
          const n = layers[l][0];
          const g = grids[l];
          const fx = (x / size) * n, fy = (y / size) * n, fz = (z / size) * n;
          const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
          const tx = fade(fx - x0), ty = fade(fy - y0), tz = fade(fz - z0);
          const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n, z1 = (z0 + 1) % n;
          const at = (a, b, c) => g[a + n * (b + n * c)];
          v += layers[l][1] * mix(
            mix(mix(at(x0, y0, z0), at(x1, y0, z0), tx), mix(at(x0, y1, z0), at(x1, y1, z0), tx), ty),
            mix(mix(at(x0, y0, z1), at(x1, y0, z1), tx), mix(at(x0, y1, z1), at(x1, y1, z1), tx), ty),
            tz,
          );
        }
        // Stretch the middle range, since averaged noise bunches up around one half
        data[k++] = Math.max(0, Math.min(255, Math.round(((v - 0.5) * 2.1 + 0.5) * 255)));
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Realistic bone: three.js's physical material plus the surface detail above
// ---------------------------------------------------------------------------
function makeBoneMaterial(shared, kind) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  const uniforms = {
    uNoise: shared.noise,
    uBump: shared.bump,
    uRest: { value: new THREE.Matrix4() },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmount: { value: 0 },
    uFadeFrom: { value: new THREE.Vector3() },
    uFadeTo: { value: new THREE.Vector3() },
    uKind: { value: kind === 'tooth' ? 1 : kind === 'cartilage' ? 2 : 0 },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        attribute vec4 color;
        uniform mat4 uRest;
        varying vec4 vBake;
        varying vec3 vBonePos;`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vBake = color;
        vBonePos = (uRest * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        ${NOISE_GLSL}
        ${FADE_GLSL}
        uniform vec3 uTint;
        uniform float uTintAmount;
        uniform float uBump;
        uniform int uKind;
        varying vec4 vBake;
        varying vec3 vBonePos;
        float boneGrain;
        float boneMottle;`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float bLight = vBake.r;
        float bRidge = vBake.g;
        float bEnd = vBake.b;
        float bThick = vBake.a;
        vec3 q = vBonePos / 1000.0;
        // Broad soft staining, medium mottling, and tiny pores
        float stain = nz(TURN_A * q * 5.0);
        boneMottle = nz(TURN_B * q * 22.0);
        boneGrain = nz(TURN_C * q * 75.0) * 0.55 + nz(TURN_A * q * 190.0) * 0.45;
        vec3 ivory = vec3(0.60, 0.47, 0.31);
        vec3 cream = vec3(0.72, 0.60, 0.43);
        vec3 tan   = vec3(0.33, 0.22, 0.11);
        vec3 boneCol = mix(ivory, cream, smoothstep(0.30, 0.70, stain));
        boneCol = mix(boneCol, tan, smoothstep(0.50, 0.78, boneMottle) * 0.20);
        // Worn ridges are paler; hollows collect a darker, warmer tone
        float hollow = clamp((0.5 - bRidge) * 2.0, 0.0, 1.0);
        float ridge = clamp((bRidge - 0.5) * 2.0, 0.0, 1.0);
        boneCol = mix(boneCol, tan * 0.55, smoothstep(0.0, 0.55, hollow) * 0.85);
        boneCol = mix(boneCol, cream * 1.12, smoothstep(0.0, 0.6, ridge) * 0.55);
        // Fine pitting darkens the surface between the grains
        boneCol *= mix(0.76, 1.07, smoothstep(0.28, 0.60, boneGrain));
        // Joint ends are smoother and paler
        boneCol = mix(boneCol, cream * 1.05, bEnd * 0.30);
        // Thin bone lets a little warm light through
        boneCol += vec3(0.10, 0.05, 0.015) * (1.0 - smoothstep(0.0, 0.45, bThick));
        if (uKind == 1) {
          // Teeth: slightly glossy enamel, a touch yellower towards the root
          boneCol = mix(vec3(0.70, 0.65, 0.53), vec3(0.42, 0.34, 0.20), hollow * 0.8);
        } else if (uKind == 2) {
          // Cartilage: smooth, pearly and slightly blue-grey
          boneCol = mix(vec3(0.46, 0.46, 0.42), vec3(0.28, 0.27, 0.24), hollow);
        }
        boneCol *= mix(0.30, 1.0, smoothstep(0.05, 0.8, bLight));
        diffuseColor.rgb = mix(boneCol, uTint, uTintAmount);
        diffuseColor.a *= boneFade(vBonePos);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        roughnessFactor = uKind == 1 ? 0.34 : uKind == 2 ? 0.42 : mix(0.70, 0.50, vBake.b) - (boneGrain - 0.5) * 0.16;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        if (uKind == 0) {
          // Bump the lighting using the grain, so the surface looks pitted rather than plastic.
          // uBump keeps the pits the same real-world depth however big the bone is on screen.
          float h = (boneGrain + boneMottle * 0.4) * uBump * (1.0 - vBake.b * 0.5);
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float hx = dFdx(h), hy = dFdy(h);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
        float bakedLight = mix(0.2, 1.0, smoothstep(0.05, 0.85, vBake.r));
        reflectedLight.indirectDiffuse *= bakedLight;
        reflectedLight.indirectSpecular *= bakedLight;`);
  };
  m.customProgramCacheKey = () => 'bone-v3';
  return m;
}

// ---------------------------------------------------------------------------
// X-ray film: each surface adds light, far more at the edges where a ray passes
// through a long stretch of the bone's dense outer layer.
// ---------------------------------------------------------------------------
function makeXrayMaterial(shared, kind) {
  const uniforms = {
    uNoise: shared.noise,
    uGain: shared.gain,
    uRest: { value: new THREE.Matrix4() },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmount: { value: 0 },
    uDensity: { value: kind === 'tooth' ? 1.8 : kind === 'cartilage' ? 0.22 : 1 },
    uFadeFrom: { value: new THREE.Vector3() },
    uFadeTo: { value: new THREE.Vector3() },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */`
      attribute vec4 color;
      uniform mat4 uRest;
      varying vec3 vN;
      varying vec4 vBake;
      varying vec3 vBonePos;
      void main() {
        vN = normalize(normalMatrix * normal);
        vBake = color;
        vBonePos = (uRest * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${NOISE_GLSL}
      ${FADE_GLSL}
      uniform vec3 uTint;
      uniform float uTintAmount;
      uniform float uDensity;
      uniform float uGain;
      varying vec3 vN;
      varying vec4 vBake;
      varying vec3 vBonePos;
      void main() {
        float facing = abs(normalize(vN).z);
        float rim = pow(1.0 - facing, 2.6);
        float thick = vBake.a;
        vec3 q = vBonePos / 1000.0;
        // The spongy lattice inside bone shows mainly towards the joints
        float lattice = nz(TURN_C * q * 120.0) * 0.6 + nz(TURN_A * q * 260.0) * 0.4;
        lattice = smoothstep(0.32, 0.68, lattice);
        float fill = mix(0.045, 0.125, thick) * mix(0.72, 1.28, lattice * (0.35 + vBake.b * 0.65));
        // Shaft centres look hollow next to their bright edges
        fill *= mix(0.72, 1.0, vBake.b);
        float edge = rim * mix(0.16, 0.38, thick);
        float I = (fill + edge) * uDensity * uGain * boneFade(vBonePos);
        vec3 film = vec3(0.92, 0.97, 1.0);
        // Light builds up where bones overlap; alpha rises with it so the film shows over the picture
        gl_FragColor = vec4(mix(film, uTint, uTintAmount) * I, I);
      }`,
  });
}

// Solid colour per bone, used only to find which bone is under a tap
function makePickMaterial(index, fade) {
  const r = (index & 255) / 255, g = ((index >> 8) & 255) / 255;
  return new THREE.ShaderMaterial({
    uniforms: { uId: { value: new THREE.Vector2(r, g) }, uRest: fade.uRest, uFadeFrom: fade.uFadeFrom, uFadeTo: fade.uFadeTo },
    vertexShader: /* glsl */`
      uniform mat4 uRest;
      varying vec3 vBonePos;
      void main() {
        vBonePos = (uRest * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${FADE_GLSL}
      uniform vec2 uId;
      varying vec3 vBonePos;
      void main() {
        if (boneFade(vBonePos) < 0.35) discard;
        gl_FragColor = vec4(uId, 0.0, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------
export class BoneScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1e5, 1e5);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.34;
    pmrem.dispose();

    this.key = new THREE.DirectionalLight(0xfff1dd, 3.0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1536, 1536);
    this.scene.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0xc8dcff, 0.5);
    this.scene.add(this.fill, this.fill.target);

    this.shared = { noise: { value: makeNoiseTexture() }, bump: { value: 1 }, gain: { value: 1 } };
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.look = 'bone';
    this.width = 1;
    this.height = 1;
    this.models = {};
    this.meshes = [];
    this.pxPerMm = 1;
    this.filmGain = 1;   // how bright the X-ray look is; lower where many bones overlap
    this.quality = 1;
    this.shadows = true;
    this.pickDirty = true;
    this.pickTarget = null;
    this.pickPixels = null;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.applySize();
    const c = this.camera;
    c.left = 0; c.right = w; c.top = h; c.bottom = 0;
    c.updateProjectionMatrix();
  }

  applySize() {
    // Keep the drawing surface at a size phones can fill quickly
    const scale = Math.min(1, 1600 / Math.max(this.width, this.height)) * this.quality;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(this.width * scale), Math.round(this.height * scale), false);
  }

  // Called when the device is struggling: first drop shadows, then sharpness
  reduceQuality() {
    if (this.shadows) { this.shadows = false; return true; }
    if (this.quality > 0.6) { this.quality = 0.6; this.applySize(); return true; }
    return false;
  }

  // Loads a model file once and returns its parts: one entry per bone mesh
  loadModel(name, url) {
    if (!this.models[name]) {
      this.models[name] = this.loader.loadAsync(url).then((gltf) => {
        const parts = {};
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((node) => {
          if (!node.isMesh) return;
          const key = node.userData.key || node.name;
          parts[key] = {
            key,
            geometry: node.geometry,
            rest: node.matrixWorld.clone(),
            id: node.userData.id,
            kind: node.userData.kind || 'bone',
          };
        });
        return { parts, meta: gltf.scene.userData.meta || {} };
      });
    }
    return this.models[name];
  }

  addMeshes(partList) {
    return partList.map((p) => {
      const boneMat = makeBoneMaterial(this.shared, p.kind);
      const xrayMat = makeXrayMaterial(this.shared, p.kind);
      boneMat.userData.uniforms.uRest.value.copy(p.rest);
      xrayMat.uniforms.uRest.value.copy(p.rest);
      const mesh = new THREE.Mesh(p.geometry, this.look === 'xray' ? xrayMat : boneMat);
      const index = this.meshes.length + 1;
      const pickMat = makePickMaterial(index, boneMat.userData.uniforms);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.userData = { boneMat, xrayMat, pickMat, part: p, index };
      this.scene.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    });
  }

  removeMeshes(list) {
    for (const mesh of list) {
      this.scene.remove(mesh);
      mesh.userData.boneMat.dispose();
      mesh.userData.xrayMat.dispose();
      mesh.userData.pickMat.dispose();
      this.meshes = this.meshes.filter((m) => m !== mesh);
    }
  }

  setLook(look) {
    this.look = look;
    for (const m of this.meshes) m.material = look === 'xray' ? m.userData.xrayMat : m.userData.boneMat;
  }

  // Makes a bone dissolve along the line between two rest-pose points
  setFade(mesh, from, to) {
    const { boneMat, xrayMat } = mesh.userData;
    boneMat.userData.uniforms.uFadeFrom.value.copy(from);
    boneMat.userData.uniforms.uFadeTo.value.copy(to);
    xrayMat.uniforms.uFadeFrom.value.copy(from);
    xrayMat.uniforms.uFadeTo.value.copy(to);
    boneMat.transparent = true;
  }

  setTint(mesh, color, amount) {
    const { boneMat, xrayMat } = mesh.userData;
    boneMat.userData.uniforms.uTint.value.set(color);
    boneMat.userData.uniforms.uTintAmount.value = amount;
    xrayMat.uniforms.uTint.value.set(color);
    xrayMat.uniforms.uTintAmount.value = amount;
  }

  render() {
    const cx = this.width / 2, cy = this.height / 2;
    const span = Math.max(this.width, this.height);
    // Light from above and slightly to one side, like a studio photograph
    this.key.position.set(cx - span * 0.45, cy + span * 0.8, span * 1.2);
    this.key.target.position.set(cx, cy, 0);
    this.fill.position.set(cx + span, cy - span * 0.4, span);
    this.fill.target.position.set(cx, cy, 0);
    this.key.target.updateMatrixWorld();
    this.fill.target.updateMatrixWorld();
    const sc = this.key.shadow.camera;
    const r = span * 0.8;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r;
    sc.near = 1; sc.far = span * 5;
    sc.updateProjectionMatrix();
    // Offsets that stop bones shadowing themselves are measured in real-world size
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = this.pxPerMm * 1.2;
    this.key.shadow.radius = 3;
    this.renderer.shadowMap.enabled = this.look === 'bone' && this.shadows;
    // Pits about a quarter of a millimetre deep
    this.shared.bump.value = 0.25 * this.pxPerMm;
    this.shared.gain.value = this.filmGain;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, this.camera);
    this.pickDirty = true;
  }

  // Draws every bone in its own flat colour off screen, to see what is where
  refreshPick() {
    if (!this.pickDirty && this.pickPixels) return;
    const scale = Math.min(1, 1024 / Math.max(this.width, this.height));
    const w = Math.max(1, Math.round(this.width * scale)), h = Math.max(1, Math.round(this.height * scale));
    if (!this.pickTarget) this.pickTarget = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    if (this.pickTarget.width !== w || this.pickTarget.height !== h) this.pickTarget.setSize(w, h);
    if (!this.pickPixels || this.pickPixels.length !== w * h * 4) this.pickPixels = new Uint8Array(w * h * 4);

    const before = this.meshes.map((m) => m.material);
    for (const m of this.meshes) m.material = m.userData.pickMat;
    const shadowsOn = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, w, h, this.pickPixels);
    this.renderer.setRenderTarget(null);
    this.renderer.shadowMap.enabled = shadowsOn;
    this.meshes.forEach((m, i) => { m.material = before[i]; });
    this.pickW = w;
    this.pickH = h;
    this.pickDirty = false;
  }

  meshAtPick(bx, by) {
    if (bx < 0 || by < 0 || bx >= this.pickW || by >= this.pickH) return null;
    const i = (by * this.pickW + bx) * 4;
    if (this.pickPixels[i + 3] === 0) return null;
    const index = this.pickPixels[i] + this.pickPixels[i + 1] * 256;
    return this.meshes.find((m) => m.userData.index === index) || null;
  }

  // Which bone is at this canvas point (y down)? Forgives taps that just miss,
  // up to `tolerance` canvas pixels away.
  pick(x, y, tolerance = 0) {
    this.refreshPick();
    const k = this.pickW / this.width;
    const bx = Math.round(x * k), by = Math.round((this.height - y) * k);
    const direct = this.meshAtPick(bx, by);
    if (direct) return direct;
    const reach = Math.ceil(tolerance * k);
    let best = null, bestD = Infinity;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = dx * dx + dy * dy;
        if (d >= bestD || d > reach * reach) continue;
        const m = this.meshAtPick(bx + dx, by + dy);
        if (m) { best = m; bestD = d; }
      }
    }
    return best;
  }

  // How many canvas pixels of each bone can actually be seen and tapped
  visibleAreas() {
    this.refreshPick();
    const counts = new Map();
    const px = this.pickPixels;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const index = px[i] + px[i + 1] * 256;
      counts.set(index, (counts.get(index) || 0) + 1);
    }
    const perPixel = (this.width / this.pickW) * (this.height / this.pickH);
    const out = new Map();
    for (const m of this.meshes) {
      const c = counts.get(m.userData.index);
      if (c) out.set(m, c * perPixel);
    }
    return out;
  }
}
