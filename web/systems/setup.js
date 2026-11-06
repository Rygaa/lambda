// Startup systems: run once, in this order (see main.js).
import * as THREE from 'three';
import { spawn, getResource, setResource } from '../ecs/world.js';
import { GroundCover, GroundPlane, DustField, CameraRig, OrthoView, PerspView, CloudLayer, Glade, Transform, Player, ShadowCaster, Character, Animator, Pose } from '../components.js';
import { Assets, Gpu, Settings, Random, Input, Ui, ActiveView } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial, pieceMaterials } from '../render/materials.js';
import { nextRandom } from '../lib/random.js';
import { cellKey } from '../lib/cells.js';
import { spawnProp } from '../lib/parts.js';
import { PLAYER_PALETTE, FPS, FPS_OPTIONS } from '../prefabs/player.js';
import { MONSTER_OPTIONS } from '../prefabs/slime.js';
import { LOOK_OPTIONS, SPRITE } from '../prefabs/character.js';
import { ZOOM_STEP } from './viewport.js';
import { SOLID_PALETTE } from '../prefabs/palette.js';
import { paletteTables, themeBase, paletteRows } from '../gen/palettes.js';
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
    uNearCull: { value: 0 },
    uTexel: { value: 0 },
    uPxAngle: { value: 0 },
    uLineWorld: { value: 0 },
    uLineMax: { value: 1 },
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
    magFilter: THREE.NearestFilter, depthBuffer: true, count: 3 };   // data, normal + depth, surface pixel step
  const quad = new THREE.PlaneGeometry(2, 2);
  const R = assets.meta.render;
  const base = themeBase(assets.meta.palette, PLAYER_PALETTE, settings.theme);
  const post = shaderMaterial(shared, S.FS_VERT, S.postFrag({ ...base, char: SOLID_PALETTE, props: paletteTables(base, settings.theme) }), {
    tData: { value: null }, tNorm: { value: null }, tStep: { value: null }, tRay: { value: null }, uRes: { value: new THREE.Vector2() },
    uCamPos: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector2() },
    uViewR: { value: basis.R.clone() }, uViewU: { value: basis.U.clone() }, uViewF: { value: basis.F.clone() },
    uPersp: { value: 0 }, uTanHalf: { value: new THREE.Vector2(1, 1) }, uFog: { value: new THREE.Vector2(...FPS.fog) },
    uVolTop: { value: R.volume_top }, uRayK: { value: 0.06 * (settings.land.rays ?? 1) }, uRayBias: { value: 3.56 }, uRaySteps: { value: 48 }, uRayDebug: { value: 0 },
    tRefl: { value: null }, tReflN: { value: null }, uReflVP: { value: new THREE.Matrix4() }, uTime: { value: 0 },
  }, { depthTest: false, depthWrite: false });
  // top view: 3x3 samples per pixel, resolved to one sample per pixel
  const resolve = shaderMaterial(shared, S.FS_VERT, S.RESOLVE_FRAG, {
    tData: { value: null }, tNorm: { value: null }, tStep: { value: null },
  }, { depthTest: false, depthWrite: false });
  // first person god rays at a quarter of the resolution (shares the post uniforms)
  const pu = post.uniforms;
  const rays = shaderMaterial(shared, S.FS_VERT, S.RAY_FRAG, {
    tNorm: { value: null }, uRes: pu.uRes, uCamPos: pu.uCamPos, uViewR: pu.uViewR, uViewU: pu.uViewU,
    uViewF: pu.uViewF, uTanHalf: pu.uTanHalf, uVolTop: pu.uVolTop, uRayK: pu.uRayK, uRayBias: pu.uRayBias,
    uRaySteps: pu.uRaySteps, uRayScale: { value: FPS.rayScale },
  }, { depthTest: false, depthWrite: false });
  // the 2D sprite character (systems/meshes.js, drawn by systems/render.js)
  const sheet = new THREE.TextureLoader().load(SPRITE.url);
  sheet.magFilter = sheet.minFilter = THREE.NearestFilter;
  sheet.generateMipmaps = false;
  const charSprite = shaderMaterial(shared, S.CHAR_SPRITE_VERT, S.CHAR_SPRITE_FRAG, {
    uSheet: { value: sheet }, tNorm: { value: null }, uSize: { value: new THREE.Vector2(SPRITE.frame / ppu, SPRITE.frame / ppu) },
    uCell: { value: new THREE.Vector2(SPRITE.idle, 0) }, uSteps: { value: SPRITE.steps },
  }, { depthTest: false, depthWrite: false });
  const blit = shaderMaterial(shared, S.FS_VERT, S.BLIT_FRAG, {
    tFinal: { value: null }, tNorm: { value: null }, uSoftK: { value: 0 }, uOffset: { value: new THREE.Vector2() }, uScale: { value: 1 },
    uMargin: { value: new THREE.Vector2() }, uLow: { value: new THREE.Vector2() },
  }, { depthTest: false, depthWrite: false });
  // the 3d_new character's copies (top view, full resolution): one material per
  // texture (or '#rrggbb' colour); it shares the blit's screen -> low-res mapping
  const screenMats = {};
  const screenCharMaterial = (tex) => {
    if (screenMats[tex]) return screenMats[tex];
    let t;
    if (tex.startsWith('#')) {
      t = new THREE.DataTexture(new Uint8Array([...[1, 3, 5].map((i) => parseInt(tex.slice(i, i + 2), 16)), 255]), 1, 1);
      t.needsUpdate = true;
    } else t = new THREE.TextureLoader().load('assets/chars/' + tex);
    t.colorSpace = THREE.NoColorSpace;
    const b = blit.uniforms;
    return (screenMats[tex] = shaderMaterial(shared, S.SCREEN_CHAR_VERT, S.SCREEN_CHAR_FRAG, {
      uTex: { value: t }, tNorm: b.tNorm, uOffset: b.uOffset, uScale: b.uScale, uMargin: b.uMargin,
    }));
  };

  setResource(world, Gpu, {
    renderer,
    shared,
    materials: pieceMaterials(shared, assets, ppu),
    scene: new THREE.Scene(),
    dustScene: new THREE.Scene(),
    spriteScene: new THREE.Scene(),
    charSprite,
    screenCharMaterial,
    shadow: { rt: shadowRT, cam: shadowCam, mat: new THREE.MeshBasicMaterial({ side: THREE.BackSide, colorWrite: false }) },
    shadowsDirty: true,
    gbuf: new THREE.WebGLRenderTarget(4, 4, rtOpts),
    gbufSS: new THREE.WebGLRenderTarget(12, 12, rtOpts),
    // water: the scene seen from the camera mirrored in the water plane
    // (systems/render.js); skip: objects left out of it
    reflect: { on: false, rt: new THREE.WebGLRenderTarget(4, 4, rtOpts), skip: new Set(),
      ortho: mirrorCam(new THREE.OrthographicCamera()), persp: mirrorCam(new THREE.PerspectiveCamera()) },
    resolve,
    resolveScene: new THREE.Scene().add(new THREE.Mesh(quad, resolve)),
    rays,
    raysScene: new THREE.Scene().add(new THREE.Mesh(quad, rays)),
    rayRT: new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter, depthBuffer: false }),
    finalRT: new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false }),
    fsCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    post,
    postScene: new THREE.Scene().add(new THREE.Mesh(quad, post)),
    blit,
    blitScene: new THREE.Scene().add(new THREE.Mesh(quad, blit)),
  });
}

// a camera whose matrices the render system sets by hand
function mirrorCam(camera) {
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  return camera;
}

// ---------------------------------------------------------------- DOM input + settings panel
// Listeners only push raw records into the Input resource.
export function setupUiSystem(world) {
  const { canvas } = getResource(world, Settings);
  const input = getResource(world, Input);
  const push = (r) => input.pending.push(r);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    // first or third person while playing: a click locks the mouse for looking around
    push({ t: 'down', x: e.clientX, y: e.clientY, button: e.button });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or finished pointer */ }
    if (document.body.dataset.look === 'on' && document.pointerLockElement !== canvas) {
      try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* drag-to-look still works */ }
    }
  });
  canvas.addEventListener('pointerup', (e) => push({ t: 'up', x: e.clientX, y: e.clientY, button: e.button }));
  canvas.addEventListener('pointermove', (e) => {
    if (document.pointerLockElement === canvas) push({ t: 'look', dx: e.movementX, dy: e.movementY });
    else push({ t: 'move', x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    push({ t: 'wheel', dy: e.deltaY || e.deltaX, shift: e.shiftKey || e.altKey });
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.key === '#') e.preventDefault();
    push({ t: 'key', key: e.key, ctrl: e.ctrlKey || e.metaKey });
  });
  addEventListener('keyup', (e) => push({ t: 'keyup', key: e.key }));
  addEventListener('blur', () => push({ t: 'blur' }));
  addEventListener('resize', () => push({ t: 'resize' }));

  // a button that sends a panel action: { t: 'ui', action, ... }
  const button = (label, action) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => push({ t: 'ui', ...action }));
    return b;
  };
  const toggle = button('#', { action: 'toggle' });
  toggle.id = 'edit-toggle';
  toggle.title = 'Settings (#)';
  document.body.appendChild(toggle);

  const panel = document.createElement('div');
  panel.id = 'editor';
  panel.innerHTML = `<div class="ed-title">SETTINGS <span>paused</span></div>
    <div class="ed-section">Camera</div><div class="ed-cams"></div>
    <div class="ed-section">Zoom</div><input class="ed-zoom" type="range" step="${ZOOM_STEP}">
    <div class="ed-help">top view: WASD move the character,<br>arrows move the camera<br>
    third / first person: WASD or arrows,<br>click to look with the mouse<br>
    shift: run · space: jump · F: attack<br>G (hold): shield · #: close</div>`;
  document.body.appendChild(panel);
  const cams = panel.querySelector('.ed-cams');
  const cameraButtons = [['top', 'Top view'], ['third', 'Third person'], ['fps', 'First person']]
    .map(([mode, label]) => ({ mode, el: cams.appendChild(button(label, { action: 'camera', mode })) }));
  // a titled box with one row per setting: a label, then a button per choice
  const optionBox = (title, rowClass, action, options, buttons) => {
    const box = document.createElement('div');
    box.innerHTML = `<div class="ed-section">${title}</div>`;
    for (const [key, label, choices] of options) {
      const row = box.appendChild(document.createElement('div'));
      row.className = rowClass;
      row.innerHTML = `<span>${label}</span>`;
      for (const [name, value] of choices) buttons.push({ key, value, el: row.appendChild(button(name, { action, key, value })) });
    }
    return box;
  };
  // first-person view settings, monsters, then the character's look
  const fpsButtons = [], lookButtons = [];
  // the top-view zoom: upscale steps (the editor UI system sets its range)
  const zoomSlider = panel.querySelector('.ed-zoom');
  zoomSlider.addEventListener('input', () => push({ t: 'ui', action: 'zoom', value: Number(zoomSlider.value) }));
  const fpsBox = optionBox('First person', 'ed-row', 'set', FPS_OPTIONS, fpsButtons);
  zoomSlider.after(fpsBox);
  const monsterBox = optionBox('Monsters', 'ed-row', 'set', MONSTER_OPTIONS, fpsButtons);
  fpsBox.after(monsterBox);
  monsterBox.after(optionBox('Character', 'ed-chips', 'look', LOOK_OPTIONS, lookButtons));

  setResource(world, Ui, { canvas, cameraButtons, fpsButtons, lookButtons, zoomSlider });
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
  spawn(world, [CloudLayer, { moving: settings.layout !== 'blender', ...(land.clouds && { lo, hi }) }]);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 200);
  const { R, U, F } = settings.basis;
  camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, U, F.clone().negate()));
  camera.layers.set(0);
  const persp = new THREE.PerspectiveCamera(FPS.fov, 16 / 9, FPS.near, FPS.far);
  persp.rotation.order = 'YXZ';
  persp.layers.set(0);
  spawn(world, [CameraRig, { target: [...land.start] }], [OrthoView, { camera }], [PerspView, { camera: persp }]);
  setResource(world, ActiveView, { camera, persp: false });

  // the player's character, on the first free spot near the start (not in the
  // ?layout=blender comparison view)
  if (settings.layout !== 'blender') {
    const free = (x, z) => land.props.every((p) => p.discs.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + 0.6));
    let [x, , z] = land.start;
    for (let i = 0; i < 400 && !free(x, z); i++) {
      const a = i * 2.4, r = 0.3 + i * 0.05;
      x = land.start[0] + Math.cos(a) * r;
      z = land.start[2] + Math.sin(a) * r;
    }
    spawn(world, [Transform, { x, z, rotY: 0 }], [Player], [Character], [Animator], [Pose], [ShadowCaster]);
  }
}

export function spawnDustSystem(world) {
  const settings = getResource(world, Settings);
  const rng = getResource(world, Random);
  const GR = settings.grassHalf;
  const n = settings.layout === 'blender' ? 1200 : 7000;
  const boxMin = [-GR, 0.15, -GR], boxSize = [GR * 2, 4.5, GR * 2];
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = boxMin[0] + nextRandom(rng) * boxSize[0];
    positions[i * 3 + 1] = boxMin[1] + nextRandom(rng) * boxSize[1];
    positions[i * 3 + 2] = boxMin[2] + nextRandom(rng) * boxSize[2];
  }
  spawn(world, [DustField, { positions, boxMin, boxSize }]);
}
