// Resources: one-of-a-kind data, keyed by name. Plain data or Three.js handles.

export const Settings = 'Settings';
// { canvas, land, fixed, freeze, theme, half, grassHalf, walkLimit, ppu, basis, player }
//   player: ?player, a player who starts as a Vagabond (no admin menu)

export const Assets = 'Assets';
// { meta, tex: { tufts, clumps, decor }, shapes (gen/shapes.js) }

export const Gpu = 'Gpu';
// { renderer, shared (uniforms), materials, scene, dustScene, shadow, shadowsDirty, gbuf, gbufSS, reflect,
//   resolve, resolveScene, finalRT, fsCam, post, postScene, blit, blitScene }

export const Viewport = 'Viewport';
// { w, h, scale, ppu, mx, my, zoom, zoomMin, zoomMax, dirty }
//   scale: whole upscale; ppu: frame pixels per world unit at this zoom (0 = not sized yet)
export const createViewport = () => ({ w: 480, h: 270, scale: 1, ppu: 0, mx: 0, my: 0, zoom: 0, zoomMin: 0, zoomMax: 0, dirty: true });

export const Time = 'Time';
export const createTime = () => ({ now: 0, prev: null, dt: 0, sceneTime: 0, paused: false });

// values the admin menu changes while the game runs (systems/admin.js)
export const Tuning = 'Tuning';
export const createTuning = () => ({ walkSpeed: 2.4, runSpeed: 5.2, jumpHeight: 0.7 });

// how things are drawn (the Look part of systems/admin.js): voxel: made of small cubes (lib/voxels.js,
// systems/voxels.js) or as they are; px: the edge of a cube, in pixels of the frame (1 / ppu world units each),
// 0.5 to 6 (the rocks, plants and cliffs stop at 1: lib/voxels.js lookOf); light: 'surface' (lit like the shape it
// comes from) or 'cube' (each cube face by its own normal); playerPx: the edge of a cube of the human the player plays
// only (0.5 to 6, lib/voxels.js lookOf player). By default made of cubes of one pixel (half a pixel: the human alone
// would need 5 GB, the page gets 3.7)
export const Look = 'Look';
export const createLook = () => ({ voxel: true, px: 1, light: 'surface', playerPx: 0.5 });

// the voxel work (systems/voxels.js): palette: the colours of the textured cubes (lib/voxels.js createPalette);
// key: the look the rocks, plants and cliffs are drawn in now (null: as they are); queue: the jobs not sent yet
// [{ entity } | { chunk }]; pool: the voxel workers, shared with the bodies (lib/voxelPool.js); sent: id -> job sent
// to them; next: the
// next id; done: their answers, not used yet; chunks: the cliff pieces of this look, shown all at once when they are
// all made; chunksLeft: the pieces not made yet
export const Voxels = 'Voxels';
export const createVoxels = (palette, pool) => ({
  palette, pool, key: null, queue: [], sent: new Map(), next: 0, done: [], chunks: [], chunksLeft: 0,
});

// the clothes and weapons of the human (systems/admin.js changes them, systems/outfit.js bakes them, lib/character.js):
//   config: assets/character/player/character.json; slots: slot -> [{ name, file, hides, hold, bothHands }] (items.json);
//   outfit: slot -> file (null: none, or the bare body); dirty: the outfit changed; busy: a bake runs;
//   next: its result { clips, meshes }; cache: file -> its loaded parts; look: the look (lib/voxels.js lookOf key,
//   null: as it is) of its last bake; dressed: the last bake on the human ({ clips, meshes, body, outfit }, lib/character.js
//   dress), the transformation changes its hair (lib/form.js)
export const Wardrobe = 'Wardrobe';
export const createWardrobe = (config, items) => ({
  config, slots: items.slots, outfit: { ...config.outfit }, dirty: false, busy: false, next: null, cache: new Map(), look: null, dressed: null,
});

// the monsters (lib/monsters.js, systems/monsters.js, the Monsters part of systems/admin.js):
//   types: the monster types (assets/monsters/monsters.json with the changes of saves/monsters.json applied);
//   changes: id -> type (edited or new) or null (deleted), what the admin Save writes to saves/monsters.json;
//   models: model -> { clips, hitAt } (assets/monsters/models.json); levels: assets/monsters/levels.json (lib/combat.js);
//   unit: world units per FlyFF unit (lib/character.js unitScale); bakes: model -> { promise, baked, error };
//   requests: spawns waiting for their bake [{ type, x, z, spot }]; later: monsters of the world recipe that come back
//   after their death [{ spot, left: seconds }]. A bake also keeps its frames made of cubes
//   (baked.looks: look key @ scale -> { clips }, lib/monsters.js monsterLook)
// the FlyFF decor objects (systems/objects.js): names: name -> { model, scale } (assets/objects/objects.json); models: model ->
// a promise of { parts, box } (its meshes, still, and its box); unit: world units per FlyFF unit (lib/character.js
// unitScale), 0 until known
export const Objects = 'Objects';
export const createObjects = (names) => ({ names, models: new Map(), cubes: new Map(), unit: 0, unitAsked: false });

export const Bestiary = 'Bestiary';
export const createBestiary = (monsters, models, levels, changes) => {
  const types = monsters.filter((m) => !(m.id in changes)).concat(Object.values(changes).filter(Boolean));
  types.sort((a, b) => a.level - b.level || a.id - b.id);
  return { types, changes, models, levels, unit: 0, bakes: new Map(), requests: [], later: [] };
};

// the fight on screen (systems/hud.js): its elements, the bars over the monsters (entity -> element), the damage
// numbers [{ el, x, y, z, t }], and the + buttons pressed (['str' | 'sta'])
export const Hud = 'Hud';

// the bag of the human (systems/inventory.js): bag: [{ file } (a weapon or a shield) | { potion, count }];
// potions: assets/items/potions.json; open: its window is shown; actions: the clicks in its window, not done yet;
// version: changes when the bag or the worn items change (its window is drawn again)
export const Inventory = 'Inventory';
export const createInventory = (bag, potions) => ({ bag, potions, open: false, actions: [], version: 0 });

// the skills (assets/character/player/skills.json, lib/skills.js): skills (the steps of the dash chosen), maxLevel,
// perLevel
export const Skillbook = 'Skillbook';

export const Input = 'Input';
// DOM listeners only push raw records into `pending`; the input system turns
// them into the per-frame fields below.
export const createInput = () => ({
  pending: [],
  keys: new Set(),
  wheel: [],               // { dy }
  pressed: [],             // { key }
  mouse: null,             // { x, y }: where the mouse is, in CSS pixels of the canvas (null: not on it yet)
  resized: false,
});

// cell key -> Set of circles: Blocker data (BlockGrid), Footprint data (CoverGrid);
// ground: the cliffs (gen/terrain.js) on the BlockGrid, else null
export const BlockGrid = 'BlockGrid';
// the tops of the objects that stop a walker by their shape (lib/tops.js)
export const Tops = 'Tops';
export const CoverGrid = 'CoverGrid';
// the holes dug in the ground (lib/craters.js createCraters)
export const Craters = 'Craters';
// the ki blasts drawn this frame and the dirt that flies (systems/blasts.js): { mesh (null until the human is there),
// sparks: [{ x, y, z, vx, vy, vz, size, color, life }] }
export const Ki = 'Ki';
export const createKi = () => ({ mesh: null, sparks: [] });
export const createGrid = (ground = null) => ({ cells: new Map(), ground });

export const Random = 'Random';
export const createRandom = (seed) => ({ seed });

export const ActiveView = 'ActiveView';
// the camera drawn this frame: { camera }

// the people who do not fight (assets/character/npc/npcs.json, lib/npc.js): their parts, and the bake of each one
export const Npcs = 'Npcs';
export const createNpcs = (json) => ({ ...json, bakes: new Map(), placed: false });

// the quests (assets/quests/quests.json, systems/quests.js): quest id -> { step, count } while it runs or is done;
// talk: the person the human talks to now (an id of npcs.json), or null
export const Quests = 'Quests';
export const createQuests = (json) => ({ quests: json.quests, state: {}, talk: null, version: 0 });

