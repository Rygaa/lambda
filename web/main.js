// Bootstrap: load assets, create the ECS world, add systems, run the loop.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWorld, setResource, getResource, addSystem, runStartup, runFrame } from './ecs/world.js';
import * as Res from './resources.js';
import './gen/kinds/index.js';
import { createShapes } from './gen/shapes.js';
import { buildLayout } from './gen/layouts.js';
import { buildRecipe } from './gen/recipe.js';
import { THEMES } from './gen/palettes.js';
import { FPS } from './prefabs/player.js';
import { setupGpuSystem, setupUiSystem, spawnGroundCoverSystem, spawnWorldSystem, spawnDustSystem } from './systems/setup.js';
import { inputSystem } from './systems/input.js';
import { timeSystem } from './systems/time.js';
import { editorActionSystem, editorUiSystem } from './systems/editor.js';
import { playerMoveSystem } from './systems/player.js';
import { characterLookSystem, characterActionSystem, animationSystem, rigPoseSystem, spriteFrameSystem } from './systems/character.js';
import { slimeSpawnSystem, slimeBrainSystem, swordHitSystem, slimeAttackHitSystem, slimeAnimationSystem, slimeDeathSystem, slimeRigSystem } from './systems/slimes.js';
import { knockbackSystem } from './systems/knockback.js';
import { SLIME_KIND_NAMES, SLIME_AI } from './prefabs/slime.js';
import { cameraControlSystem, cameraSnapSystem } from './systems/camera.js';
import { viewportSystem } from './systems/viewport.js';
import { cloudSystem } from './systems/clouds.js';
import { meshSystem } from './systems/meshes.js';
import { footprintSystem } from './systems/footprints.js';
import { groundCoverSystem } from './systems/groundCover.js';
import { shadowSystem } from './systems/shadows.js';
import { renderSystem } from './systems/render.js';
import { viewSystem } from './systems/view.js';

// ------------------------------------------------------------------ assets
const NOCACHE = '?v=' + Date.now();   // assets change when export_assets.py runs again
const meta = await (await fetch('assets/assets.json' + NOCACHE)).json();
const gltf = await new GLTFLoader().loadAsync('assets/assets.glb' + NOCACHE);
gltf.scene.updateMatrixWorld(true);
const geo = {};
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry.clone();
  g.applyMatrix4(o.matrixWorld);
  g.computeBoundingSphere();
  geo[o.name] = g;
});
const texLoader = new THREE.TextureLoader();
const loadAtlas = async (info) => {
  const t = await texLoader.loadAsync('assets/' + info.file + NOCACHE);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
};
const [tufts, clumps, decor] = await Promise.all(['tufts', 'clumps', 'decor'].map((k) => loadAtlas(meta.sprites[k])));

// ------------------------------------------------------------------ world
async function loadRecipe(name) {
  const res = await fetch(`worlds/${encodeURIComponent(name)}.json` + NOCACHE);
  if (!res.ok) showErrors(() => { throw new Error(`no world recipe worlds/${name}.json`); });
  const text = await res.text();
  return showErrors(() => {
    try { return JSON.parse(text); } catch (err) { throw new Error(`worlds/${name}.json is not valid JSON: ${err.message}`); }
  });
}
// a broken recipe shows its message on the page, not only in the console
function showErrors(fn) {
  try { return fn(); } catch (err) {
    document.getElementById('hint').textContent = String(err.message || err);
    document.getElementById('hint').style.color = '#ffb4a0';
    throw err;
  }
}
const params = new URLSearchParams(location.search);
// ?world=<name>: worlds/<name>.json (default meadow), ?seed=<n> changes its seed;
// ?layout=blender | pillars | forest: a fixed layout of the Blender pieces instead
const layout = ['blender', 'pillars', 'forest'].includes(params.get('layout')) ? params.get('layout') : 'world';
const recipe = layout === 'world' ? await loadRecipe(params.get('world') || 'meadow') : null;
if (recipe && params.has('seed')) recipe.seed = Number(params.get('seed'));
// ?theme=<name>: the colours of gen/palettes.js THEMES (else the recipe "theme")
const theme = params.get('theme') ?? recipe?.theme ?? null;
if (theme && !THEMES[theme]) showErrors(() => { throw new Error(`unknown theme "${theme}" (known: ${Object.keys(THEMES).join(', ')})`); });
const F = new THREE.Vector3(...meta.render.cam_forward).normalize();
const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
const sunL = new THREE.Vector3(...meta.render.sun_l).normalize();
// the shapes of generated objects (gen/kinds) and where they stand
const shapes = createShapes({ meta, geo, sunL, mid: meta.mid, seed: recipe?.seed ?? 11 });
const land = showErrors(() => (recipe ? buildRecipe(shapes, recipe) : buildLayout(shapes, layout)));

const world = createWorld();
setResource(world, Res.Settings, {
  canvas: document.getElementById('c'),
  layout,
  fixed: layout === 'blender' || params.has('fixed'),   // exact 480x270 frame
  freeze: params.has('freeze'),                          // no motion: for image comparisons
  theme,                                                 // colour theme (gen/palettes.js THEMES), or null
  land,                             // { props, glades, half, start } (gen/world.js)
  half: land.half,
  grassHalf: land.half + 5,         // grass, flowers and dust cover this square
  edgeLimit: land.half + 3,         // nothing walks past this
  walkLimit: land.half - 4,
  ppu: meta.render.ppu,
  fpsLines: FPS.lines,              // thickest first-person outline (changed in the admin menu)
  fpsFog: [...FPS.fog],             // fog start, end (changed in the admin menu)
  monsters: false,                  // slimes spawn only once this is turned on in the admin menu
  basis: {
    F, R,
    U: new THREE.Vector3().crossVectors(R, F).normalize(),
    L: sunL,
    groundFwd: new THREE.Vector3(F.x, 0, F.z).normalize(),
    sinElev: -F.y,
  },
});
setResource(world, Res.Assets, { meta, geo, tex: { tufts, clumps, decor }, shapes });
setResource(world, Res.Viewport, Res.createViewport());
setResource(world, Res.Time, Res.createTime());
setResource(world, Res.Input, Res.createInput());
setResource(world, Res.Editor, Res.createEditor());
setResource(world, Res.BlockGrid, Res.createGrid(land.terrain));
setResource(world, Res.CoverGrid, Res.createGrid());
setResource(world, Res.Random, Res.createRandom(5));
setResource(world, Res.Slimes, Res.createSlimes(SLIME_KIND_NAMES, SLIME_AI.spawnDelay));

for (const s of [setupGpuSystem, setupUiSystem, spawnGroundCoverSystem, spawnWorldSystem, spawnDustSystem])
  addSystem(world, s, 'startup');
for (const s of [
  inputSystem, editorActionSystem, timeSystem,
  characterLookSystem, characterActionSystem, playerMoveSystem, animationSystem,
  slimeSpawnSystem, slimeBrainSystem, swordHitSystem, slimeAttackHitSystem, knockbackSystem,
  slimeAnimationSystem, slimeDeathSystem,
  cameraControlSystem, viewportSystem, cloudSystem,
  meshSystem, rigPoseSystem, slimeRigSystem, footprintSystem, groundCoverSystem, shadowSystem,
  cameraSnapSystem, viewSystem, spriteFrameSystem, editorUiSystem, renderSystem,
]) addSystem(world, s);

runStartup(world);

function tick(now) {
  getResource(world, Res.Time).now = now;
  runFrame(world);
}
requestAnimationFrame(function loop(now) {
  tick(now);
  requestAnimationFrame(loop);
});

// ------------------------------------------------------------------ dev helpers
// save the current low-res frame to captures/<name>.png (see serve.py)
async function capture(name = 'web_capture') {
  tick(performance.now());             // works even when the tab is hidden
  const { renderer, finalRT } = getResource(world, Res.Gpu);
  const vp = getResource(world, Res.Viewport);
  const W = vp.w + 2, H = vp.h + 2;
  const buf = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(finalRT, 0, 0, W, H, buf);
  const c = new OffscreenCanvas(vp.w, vp.h);
  const img = c.getContext('2d').createImageData(vp.w, vp.h);
  for (let y = 0; y < vp.h; y++)
    for (let x = 0; x < vp.w; x++) {
      const s = ((y + 1) * W + x + 1) * 4, d = ((vp.h - 1 - y) * vp.w + x) * 4;
      img.data.set(buf.subarray(s, s + 4), d);
      img.data[d + 3] = 255;
    }
  c.getContext('2d').putImageData(img, 0, 0);
  await fetch(`/capture/${name}.png`, { method: 'PUT', body: await c.convertToBlob({ type: 'image/png' }) });
  return name;
}
window.__pixelForest = { world, capture, tick };
