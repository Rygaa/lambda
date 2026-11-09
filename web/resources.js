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
