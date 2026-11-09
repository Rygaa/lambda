// Resources: one-of-a-kind data, keyed by name. Plain data or Three.js handles.

export const Settings = 'Settings';
// { canvas, land, fixed, freeze, theme, half, grassHalf, walkLimit, ppu, basis }

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

// the clothes and weapons of the human (systems/admin.js changes them, systems/outfit.js bakes them, lib/character.js):
//   config: assets/character/player/character.json; slots: slot -> [{ name, file, hides, hold, bothHands }] (items.json);
//   outfit: slot -> file (null: none, or the bare body); dirty: the outfit changed; busy: a bake runs;
//   next: its result { clips, meshes }; cache: file -> its loaded parts
export const Wardrobe = 'Wardrobe';
export const createWardrobe = (config, items) => ({
  config, slots: items.slots, outfit: { ...config.outfit }, dirty: false, busy: false, next: null, cache: new Map(),
});

// the monsters (lib/monsters.js, systems/monsters.js, the Monsters part of systems/admin.js):
//   types: the monster types (assets/monsters/monsters.json with the changes of saves/monsters.json applied);
//   changes: id -> type (edited or new) or null (deleted), what the admin Save writes to saves/monsters.json;
//   models: model -> { clips, hitAt } (assets/monsters/models.json); levels: assets/monsters/levels.json (lib/combat.js);
//   unit: world units per FlyFF unit (lib/character.js unitScale); bakes: model -> { promise, baked, error };
//   requests: spawns waiting for their bake [{ type, x, z }]
export const Bestiary = 'Bestiary';
export const createBestiary = (monsters, models, levels, changes) => {
  const types = monsters.filter((m) => !(m.id in changes)).concat(Object.values(changes).filter(Boolean));
  types.sort((a, b) => a.level - b.level || a.id - b.id);
  return { types, changes, models, levels, unit: 0, bakes: new Map(), requests: [] };
};

// the fight on screen (systems/hud.js): its elements, the bars over the monsters (entity -> element), the damage
// numbers [{ el, x, y, z, t }], and the + buttons pressed (['str' | 'sta'])
export const Hud = 'Hud';

export const Input = 'Input';
// DOM listeners only push raw records into `pending`; the input system turns
// them into the per-frame fields below.
export const createInput = () => ({
  pending: [],
  keys: new Set(),
  wheel: [],               // { dy }
  pressed: [],             // { key }
  resized: false,
});

// cell key -> Set of circles: Blocker data (BlockGrid), Footprint data (CoverGrid);
// ground: the cliffs (gen/terrain.js) on the BlockGrid, else null
export const BlockGrid = 'BlockGrid';
// the tops of the objects that stop a walker by their shape (lib/tops.js)
export const Tops = 'Tops';
export const CoverGrid = 'CoverGrid';
export const createGrid = (ground = null) => ({ cells: new Map(), ground });

export const Random = 'Random';
export const createRandom = (seed) => ({ seed });

export const ActiveView = 'ActiveView';
// the camera drawn this frame: { camera }
