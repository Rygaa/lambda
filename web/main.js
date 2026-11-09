// Bootstrap: load assets, create the ECS world, add systems, run the loop.
import * as THREE from 'three';
import { createWorld, setResource, getResource, addSystem, runStartup, runFrame } from './ecs/world.js';
import * as Res from './resources.js';
import './gen/builders/index.js';
import { loadTypes } from './gen/assets.js';
import { createShapes } from './gen/shapes.js';
import { buildRecipe, assetsOf } from './gen/recipe.js';
import { setPalettes } from './gen/palettes.js';
import { setupGpuSystem, setupUiSystem, spawnGroundCoverSystem, spawnWorldSystem, spawnDustSystem } from './systems/setup.js';
import { inputSystem } from './systems/input.js';
import { timeSystem } from './systems/time.js';
import { cameraControlSystem, cameraSnapSystem } from './systems/camera.js';
import { viewportSystem } from './systems/viewport.js';
import { cloudSystem } from './systems/clouds.js';
import { meshSystem } from './systems/meshes.js';
import { footprintSystem } from './systems/footprints.js';
import { groundCoverSystem } from './systems/groundCover.js';
import { shadowSystem } from './systems/shadows.js';
import { renderSystem } from './systems/render.js';
import { viewSystem } from './systems/view.js';
import { playerSystem } from './systems/player.js';
import { createTops } from './lib/tops.js';
import { setupAdminSystem, adminSystem } from './systems/admin.js';
import { outfitSystem } from './systems/outfit.js';

// ------------------------------------------------------------------ assets
// the page is web/index.html: the assets and the worlds are next to web/
const NOCACHE = '?v=' + Date.now();
const loadJson = async (path) => (await fetch(path + NOCACHE)).json();
const [meta, palettes, character, items] = await Promise.all(['render', 'palettes', 'character/player/character', 'character/player/items']
  .map((f) => loadJson(`../assets/${f}.json`)));
const texLoader = new THREE.TextureLoader();
const loadAtlas = async (info) => {
  const t = await texLoader.loadAsync('../assets/' + info.file + NOCACHE);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
};
// the settings saved with the Save button of the admin menu (saves/admin.json, web/serve.py); none: the defaults
const saved = await fetch('../saves/admin.json' + NOCACHE).then((r) => (r.ok ? r.json() : {}), () => ({}));
const [tufts, clumps, decor] = await Promise.all(['tufts', 'clumps', 'decor'].map((k) => loadAtlas(meta.sprites[k])));

// ------------------------------------------------------------------ world
async function loadRecipe(name) {
  const res = await fetch(`../worlds/${encodeURIComponent(name)}.json` + NOCACHE);
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
// ?world=<name>: worlds/<name>.json (default meadow), ?seed=<n> changes its seed
const recipe = await loadRecipe(params.get('world') || 'meadow');
if (params.has('seed')) recipe.seed = Number(params.get('seed'));
// ?theme=<name>: a theme of assets/palettes.json (else the recipe "theme")
const theme = params.get('theme') ?? recipe.theme ?? null;
showErrors(() => setPalettes(palettes, theme));
const F = new THREE.Vector3(...meta.render.cam_forward).normalize();
const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
const sunL = new THREE.Vector3(...meta.render.sun_l).normalize();
// the asset types the world uses (assets/<family>/<type>/<family>.json), their shapes and where they stand
const typeNames = showErrors(() => assetsOf(recipe));
await loadTypes(typeNames, '../assets/').catch((err) => showErrors(() => { throw err; }));
const shapes = createShapes({ meta, sunL, mid: meta.mid, seed: recipe.seed ?? 11 });
const land = showErrors(() => buildRecipe(shapes, recipe));

const world = createWorld();
setResource(world, Res.Settings, {
  canvas: document.getElementById('c'),
  fixed: params.has('fixed'),       // exact 480x270 frame
  freeze: params.has('freeze'),     // no motion: for image comparisons
  theme,                            // colour theme (assets/palettes.json "themes"), or null
  land,                             // { props, glades, half, start } (gen/world.js)
  half: land.half,
  grassHalf: land.half + 5,         // grass, flowers and dust cover this square
  walkLimit: land.half - 4,         // the camera stays inside this square
  ppu: meta.render.ppu,
  basis: {
    F, R,
    U: new THREE.Vector3().crossVectors(R, F).normalize(),
    L: sunL,
    groundFwd: new THREE.Vector3(F.x, 0, F.z).normalize(),
    sinElev: -F.y,
  },
});
setResource(world, Res.Assets, { meta, tex: { tufts, clumps, decor }, shapes });
setResource(world, Res.Viewport, { ...Res.createViewport(), zoom: saved.zoom ?? 0 });
setResource(world, Res.Time, Res.createTime());
setResource(world, Res.Input, Res.createInput());
setResource(world, Res.Tuning, { ...Res.createTuning(), ...saved.tuning });
Object.assign(setResource(world, Res.Wardrobe, Res.createWardrobe(character, items)).outfit, saved.outfit);
setResource(world, Res.BlockGrid, Res.createGrid(land.terrain));
setResource(world, Res.Tops, createTops(land.half + 2));
setResource(world, Res.CoverGrid, Res.createGrid());
setResource(world, Res.Random, Res.createRandom(5));

for (const s of [setupGpuSystem, setupUiSystem, setupAdminSystem, spawnGroundCoverSystem, spawnWorldSystem, spawnDustSystem])
  addSystem(world, s, 'startup');
for (const s of [
  inputSystem, timeSystem,
  outfitSystem, playerSystem, cameraControlSystem, viewportSystem, cloudSystem,
  meshSystem, footprintSystem, groundCoverSystem, shadowSystem,
  cameraSnapSystem, viewSystem, renderSystem, adminSystem,
]) addSystem(world, s);

runStartup(world);
// the human (lib/character.js): ?char=x,z puts it there, else at the start; ?nochar: none
if (!params.has('nochar')) {
  const { addCharacter } = await import('./lib/character.js');
  await addCharacter(world, params.get('char')?.split(',').map(Number));
}

function tick(now) {
  getResource(world, Res.Time).now = now;
  runFrame(world);
}
// frames per second, shown at the top right, counted over half a second
const fps = { el: document.getElementById('fps'), frames: 0, since: performance.now() };
requestAnimationFrame(function loop(now) {
  tick(now);
  fps.frames++;
  if (now - fps.since >= 500) {
    fps.el.textContent = `${Math.round((fps.frames * 1000) / (now - fps.since))} fps`;
    fps.frames = 0;
    fps.since = now;
  }
  requestAnimationFrame(loop);
});

// for tests and screenshots (Playwright): the ECS world and one frame on demand
window.__nature = { world, tick };
