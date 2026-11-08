// Startup systems: run once, in this order (see main.js).
import * as THREE from 'three';
import { spawn, getResource, setResource } from '../ecs/world.js';
import { GroundCover, GroundPlane, DustField, CameraRig, OrthoView, CloudLayer, Glade } from '../components.js';
import { Assets, Gpu, Settings, Random, Input, ActiveView } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial, pieceMaterials } from '../render/materials.js';
import { nextRandom } from '../lib/random.js';
import { cellKey } from '../lib/cells.js';
import { spawnProp } from '../lib/parts.js';
import { paletteTables, paletteRows } from '../gen/palettes.js';
import { heightAt, bareAt } from '../gen/terrain.js';
import { groundAt, PAINTS } from '../gen/ground.js';

// ---------------------------------------------------------------- GPU
// Renderer, shared uniforms, materials, shadow map and the render targets.
export function setupGpuSystem(world) {
  const settings = getResource(world, Settings);
  const assets = getResource(world, Assets);
  const { basis, ppu } = settings;
  const renderer = new THREE.WebGLRenderer({ canvas: settings.canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  const floatOK = renderer.extensions.has('EXT_color_buffer_float');

  const shared = {
    uSunL: { value: basis.L },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: 1 / 4096 },
    uCloudOffset: { value: new THREE.Vector2(0, 0) },
    uCloudScale: { value: 0.23 },
    uCloudLo: { value: -0.05 },
    uCloudHi: { value: 0.02 },
    uGlades: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 0)) },
    uCamR: { value: basis.R.clone() },
    uCamU: { value: basis.U.clone() },
    uClipY: { value: -1e4 },
  };

  const SM = Math.min(4096, renderer.capabilities.maxTextureSize);
  const shadowRT = new THREE.WebGLRenderTarget(SM, SM, { depthBuffer: true });
  shadowRT.depthTexture = new THREE.DepthTexture(SM, SM);
  shadowRT.depthTexture.minFilter = shadowRT.depthTexture.magFilter = THREE.NearestFilter;
  const SB = settings.half + 12;
  const shadowCam = new THREE.OrthographicCamera(-SB, SB, SB, -SB, 1, 240);
  shadowCam.position.copy(basis.L).multiplyScalar(120);
  shadowCam.lookAt(0, 0, 0);
  shadowCam.layers.set(1);
  shadowCam.updateMatrixWorld();
  shared.uShadowMatrix.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
  shared.uShadowTexel.value = 1 / SM;
  shared.uShadowMap.value = shadowRT.depthTexture;

  const rtOpts = { type: floatOK ? THREE.FloatType : THREE.HalfFloatType, minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter, depthBuffer: true, count: 2 };   // data, normal + depth
  const quad = new THREE.PlaneGeometry(2, 2);
  const R = assets.meta.render;
  const post = shaderMaterial(shared, S.FS_VERT, S.postFrag(paletteTables()), {
    tData: { value: null }, tNorm: { value: null }, uRes: { value: new THREE.Vector2() },
    uCamPos: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector2() },
    uViewR: { value: basis.R.clone() }, uViewU: { value: basis.U.clone() }, uViewF: { value: basis.F.clone() },
    uVolTop: { value: R.volume_top }, uRayK: { value: 0.06 * (settings.land.rays ?? 1) }, uRayBias: { value: 3.56 }, uRaySteps: { value: 48 },
    tRefl: { value: null }, tReflN: { value: null }, uReflVP: { value: new THREE.Matrix4() }, uTime: { value: 0 },
  }, { depthTest: false, depthWrite: false });
  // 3x3 samples per pixel, resolved to one sample per pixel
  const resolve = shaderMaterial(shared, S.FS_VERT, S.RESOLVE_FRAG, {
    tData: { value: null }, tNorm: { value: null },
  }, { depthTest: false, depthWrite: false });
  const blit = shaderMaterial(shared, S.FS_VERT, S.BLIT_FRAG, {
    tFinal: { value: null }, uOffset: { value: new THREE.Vector2() }, uScale: { value: 1 },
    uMargin: { value: new THREE.Vector2() }, uLow: { value: new THREE.Vector2() },
  }, { depthTest: false, depthWrite: false });

  const mirror = new THREE.OrthographicCamera();
  mirror.matrixAutoUpdate = false;          // the render system sets its matrices by hand
  mirror.matrixWorldAutoUpdate = false;

  setResource(world, Gpu, {
    renderer,
    shared,
    materials: pieceMaterials(shared, assets, ppu),
    scene: new THREE.Scene(),
    dustScene: new THREE.Scene(),
    shadow: { rt: shadowRT, cam: shadowCam, mat: new THREE.MeshBasicMaterial({ side: THREE.BackSide, colorWrite: false }) },
    shadowsDirty: true,
    gbuf: new THREE.WebGLRenderTarget(4, 4, rtOpts),
    gbufSS: new THREE.WebGLRenderTarget(12, 12, rtOpts),
    // water: the scene seen from the camera mirrored in the water plane
    // (systems/render.js); skip: objects left out of it
    reflect: { on: false, rt: new THREE.WebGLRenderTarget(4, 4, rtOpts), skip: new Set(), camera: mirror },
    resolve,
    resolveScene: new THREE.Scene().add(new THREE.Mesh(quad, resolve)),
    finalRT: new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false }),
    fsCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    post,
    postScene: new THREE.Scene().add(new THREE.Mesh(quad, post)),
    blit,
    blitScene: new THREE.Scene().add(new THREE.Mesh(quad, blit)),
  });
}

// ---------------------------------------------------------------- DOM input
// Listeners only push raw records into the Input resource.
export function setupUiSystem(world) {
  const { canvas } = getResource(world, Settings);
  const input = getResource(world, Input);
  const push = (r) => input.pending.push(r);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    push({ t: 'wheel', dy: e.deltaY || e.deltaX });
  }, { passive: false });
  // keys typed in a field of the admin menu are not game keys
  addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') push({ t: 'key', key: e.key }); });
  addEventListener('keyup', (e) => push({ t: 'keyup', key: e.key }));
  addEventListener('blur', () => push({ t: 'blur' }));
  addEventListener('resize', () => push({ t: 'resize' }));
  setTimeout(() => (document.getElementById('hint').style.opacity = 0), 7000);
}

// ---------------------------------------------------------------- grass + flowers
export function spawnGroundCoverSystem(world) {
  const settings = getResource(world, Settings);
  const meta = getResource(world, Assets).meta;
  const rng = getResource(world, Random);
  const rand = () => nextRandom(rng);
  const MID = meta.mid, GR = settings.grassHalf;
  const toward = settings.basis.F.clone().multiplyScalar(-0.25);   // decor sits a little in front
  // on the level of the ground (cliffs); none on stairs or on the lip of a cliff
  // (far below, like under a footprint). Grass tufts take the colour of the
  // ground paint under them (gen/ground.js), so the edges of sand and paths are
  // tufts too; none on pavement. Flowers and sprouts grow on grass only.
  const { terrain, ground } = settings.land;
  const groundY = (x, z) => (bareAt(terrain, x, z) ? -1000 : heightAt(terrain, x, z));
  const paintAt = (x, z) => groundAt(ground, x, z);
  const ROW = Object.fromEntries(['grass', ...PAINTS].map((name) => [name, paletteRows({ ground: name }).ground]));

  const grass = [];
  for (let x = -GR; x < GR; x += 0.125)
    for (let z = -GR; z < GR; z += 0.125) {
      const px = x + rand() * 0.125, pz = z + rand() * 0.125;
      const paint = paintAt(px, pz);
      const y = paint === 'pavement' ? -1000 : groundY(px, pz);
      grass.push({ pos: [px, y, pz], light: [px, y, pz], param: [Math.floor(rand() * 4), MID.grass, ROW[paint], 0] });
    }
  const decor = [];
  const sp = meta.sprites.decor.sprouts, fl = meta.sprites.decor.flowers;
  for (let x = -GR; x < GR; x += 0.75)
    for (let z = -GR; z < GR; z += 0.75) {
      if (rand() > 0.8) continue;
      const px = x + rand() * 0.75, pz = z + rand() * 0.75;
      const roll = rand();
      let cell, mid;
      if (roll < 0.32) { cell = sp[Math.floor(rand() * 4)]; mid = MID.sprout; }
      else if (roll < 0.58) { cell = fl[Math.floor(rand() * 4)]; mid = MID.flower_w; }
      else if (roll < 0.68) { cell = fl[Math.floor(rand() * 4)]; mid = MID.flower_l; }
      else { cell = sp[Math.floor(rand() * 4)]; mid = MID.leafdeco; }
      const lift = mid === MID.leafdeco ? 0.02 : 0.1;
      const y = paintAt(px, pz) === 'grass' ? groundY(px, pz) : -1000;
      decor.push({ pos: [px + toward.x, y + lift + toward.y, pz + toward.z], light: [px, y, pz], param: [cell, mid, 0, 0] });
    }

  for (const [kind, items] of [['grass', grass], ['decor', decor]]) {
    const n = items.length;
    const pos = new Float32Array(n * 3), light = new Float32Array(n * 3), params = new Float32Array(n * 4);
    const grid = new Map();
    items.forEach((it, i) => {
      pos.set(it.pos, i * 3);
      light.set(it.light, i * 3);
      params.set(it.param, i * 4);
      const k = cellKey(it.light[0], it.light[2]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    spawn(world, [GroundCover, { kind, pos, home: pos.slice(), light, params, grid }]);
  }
}

// ---------------------------------------------------------------- the world
// Ground, generated objects, clearings, clouds and the camera.
export function spawnWorldSystem(world) {
  const settings = getResource(world, Settings);
  const land = settings.land;
  spawn(world, [GroundPlane]);
  for (const p of land.props) spawnProp(world, p);
  for (const g of land.glades) spawn(world, [Glade, { x: g.x, z: g.z, r: g.r, k: g.k }]);
  const [lo, hi] = land.clouds ?? [];
  spawn(world, [CloudLayer, land.clouds ? { lo, hi } : {}]);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 200);
  const { R, U, F } = settings.basis;
  camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, U, F.clone().negate()));
  camera.layers.set(0);
  spawn(world, [CameraRig, { target: [...land.start] }], [OrthoView, { camera }]);
  setResource(world, ActiveView, { camera });
}

export function spawnDustSystem(world) {
  const settings = getResource(world, Settings);
  const rng = getResource(world, Random);
  const GR = settings.grassHalf;
  const n = 7000;
  const boxMin = [-GR, 0.15, -GR], boxSize = [GR * 2, 4.5, GR * 2];
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = boxMin[0] + nextRandom(rng) * boxSize[0];
    positions[i * 3 + 1] = boxMin[1] + nextRandom(rng) * boxSize[1];
    positions[i * 3 + 2] = boxMin[2] + nextRandom(rng) * boxSize[2];
  }
  spawn(world, [DustField, { positions, boxMin, boxSize }]);
}
