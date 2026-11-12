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
import { voxelSystem } from './systems/voxels.js';
import { objectSystem } from './systems/objects.js';
import { createPalette } from './lib/voxels.js';
import { createPool } from './lib/voxelPool.js';
import { fromFile } from './lib/voxelSaved.js';
import { footprintSystem } from './systems/footprints.js';
import { groundCoverSystem } from './systems/groundCover.js';
import { coverChunkSystem } from './systems/coverChunks.js';
import { shadowSystem } from './systems/shadows.js';
import { renderSystem } from './systems/render.js';
import { viewSystem } from './systems/view.js';
import { playerSystem } from './systems/player.js';
import { createTops } from './lib/tops.js';
import { createCraters } from './lib/craters.js';
import { blastSystem } from './systems/blasts.js';
import { craterSystem } from './systems/craters.js';
import { setupAdminSystem, adminSystem } from './systems/admin.js';
import { outfitSystem } from './systems/outfit.js';
import { monsterSystem } from './systems/monsters.js';
import { combatSystem } from './systems/combat.js';
import { setupHudSystem, hudSystem } from './systems/hud.js';
import { loadingSystem } from './systems/loading.js';
import { setupSkillsSystem, skillSystem } from './systems/skills.js';
import { setupInventorySystem, inventorySystem } from './systems/inventory.js';
import { dropSystem } from './systems/drops.js';
import { START } from './lib/combat.js';

// ------------------------------------------------------------------ assets
// the page is web/index.html: the assets and the worlds are next to web/
const NOCACHE = '?v=' + Date.now();
const loadJson = async (path) => (await fetch(path + NOCACHE)).json();
const [meta, palettes, character, items, monsters, models, levels, objects, skills, potions] = await Promise.all(['render', 'palettes', 'character/player/character',
  'character/player/items', 'monsters/monsters', 'monsters/models', 'monsters/levels', 'objects/objects', 'character/player/skills', 'items/potions']
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
const loadSave = (name) => fetch(`../saves/${name}.json` + NOCACHE).then((r) => (r.ok ? r.json() : {}), () => ({}));
const saved = await loadSave('admin');
// the monster types the admin menu changed (id -> type, or null: deleted)
const monsterChanges = (await loadSave('monsters')).changes ?? {};
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
// ?player: a player who starts as a Vagabond (level 1, its clothes, a wooden sword and shield in its bag, no admin
// menu, nothing saved); else the admin, with what saves/admin.json has
const player = params.has('player');
// ?world=<name>: worlds/<name>.json (default meadow), ?seed=<n> changes its seed
const recipe = await loadRecipe(params.get('world') || 'meadow');
// "map": a part of a FlyFF map, worlds/maps/<name>.json (gen/map.js)
const map = recipe.map ? await loadJson(`../worlds/maps/${encodeURIComponent(recipe.map)}.json`).catch(() => showErrors(() => { throw new Error(`no map worlds/maps/${recipe.map}.json`); })) : null;
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
const land = showErrors(() => buildRecipe(shapes, recipe, map));
const BIG = 60;       // a world wider than this (half + 5 > BIG: a FlyFF map) has grass only COVER around the camera
const COVER = 32;

const world = createWorld();
setResource(world, Res.Settings, {
  canvas: document.getElementById('c'),
  player,                           // ?player: a Vagabond, no admin menu
  fixed: params.has('fixed'),       // exact 480x270 frame
  freeze: params.has('freeze'),     // no motion: for image comparisons
  theme,                            // colour theme (assets/palettes.json "themes"), or null
  land,                             // { props, glades, half, start } (gen/world.js)
  half: land.half,
  grassHalf: land.half + 5 > BIG ? COVER : land.half + 5,   // grass, flowers and dust cover this square (around the camera in a big world)
  coverChunks: land.half + 5 > BIG,                          // a big world: its grass in squares around the camera (systems/coverChunks.js)
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
// ?look=normal or voxel wins over the saved look
setResource(world, Res.Look, { ...Res.createLook(), ...saved.look, ...(params.has('look') ? { voxel: params.get('look') === 'voxel' } : {}) });
// the cubes of this world made beforehand (worlds/baked/<world>.bin, lib/voxelSaved.js), if there are; ?bake makes them
const pool = createPool(), palette = createPalette();
if (params.has('bake')) pool.keepAll();
else {
  const res = await fetch(`../worlds/baked/${encodeURIComponent(params.get('world') || 'meadow')}.bin` + NOCACHE).catch(() => null);
  if (res?.ok) pool.useBaked(fromFile(await res.arrayBuffer()), palette.index);
}
setResource(world, Res.Voxels, Res.createVoxels(palette, pool));
Object.assign(setResource(world, Res.Wardrobe, Res.createWardrobe(character, items)).outfit, player ? character.vagrant.outfit : saved.outfit);
setResource(world, Res.Inventory, Res.createInventory(player ? character.vagrant.bag.map((file) => ({ file })) : [], potions.potions));
const book = setResource(world, Res.Skillbook, skills);
setResource(world, Res.Objects, Res.createObjects(objects.objects));
const bestiary = setResource(world, Res.Bestiary, Res.createBestiary(monsters.monsters, models.models, levels, monsterChanges));
// the monsters of the world recipe: they spawn once the human is there, and come back after their death
for (const [i, { id, at }] of (recipe.monsters ?? []).entries()) {
  const type = bestiary.types.find((t) => t.id === id);
  if (!type) showErrors(() => { throw new Error(`world recipe, monsters[${i}]: no monster ${id} in assets/monsters/monsters.json`); });
  for (const [x, z] of at) { const spot = { type, x, z }; bestiary.requests.push({ ...spot, spot }); }
}
setResource(world, Res.BlockGrid, Res.createGrid(land.terrain));
setResource(world, Res.Tops, createTops(land.half + 2));
setResource(world, Res.CoverGrid, Res.createGrid());
setResource(world, Res.Craters, createCraters(land.half + 2));
setResource(world, Res.Ki, Res.createKi());
setResource(world, Res.Random, Res.createRandom(5));

for (const s of [setupGpuSystem, setupUiSystem, setupHudSystem, setupAdminSystem, setupSkillsSystem, setupInventorySystem, spawnGroundCoverSystem, spawnWorldSystem, spawnDustSystem])
  addSystem(world, s, 'startup');
for (const s of [
  inputSystem, timeSystem,
  outfitSystem, skillSystem, blastSystem, craterSystem, playerSystem, monsterSystem, combatSystem, dropSystem, inventorySystem, cameraControlSystem, viewportSystem, cloudSystem,
  coverChunkSystem, meshSystem, voxelSystem, objectSystem, footprintSystem, groundCoverSystem, shadowSystem,
  cameraSnapSystem, viewSystem, renderSystem, hudSystem, adminSystem, loadingSystem,
]) addSystem(world, s);

runStartup(world);
// the human (lib/character.js): ?char=x,z puts it there, else at the start; ?nochar: none. Its stats: the saved ones
if (!params.has('nochar')) {
  const { addCharacter } = await import('./lib/character.js');
  // the admin knows every skill at level 1; a Vagabond learns them with skill points
  const levels = Object.fromEntries(book.skills.map((s) => [s.id, player ? 0 : 1]));
  await addCharacter(world, params.get('char')?.split(',').map(Number), player ? { ...START } : { ...START, ...saved.stats }, levels);
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
