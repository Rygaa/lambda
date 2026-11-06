// Resources: one-of-a-kind data, keyed by name. Plain data or Three.js handles.

export const Settings = 'Settings';
// { layout, land, fixed, freeze, theme, half, grassHalf, edgeLimit, walkLimit }

export const Assets = 'Assets';
// { meta, geo: { name: BufferGeometry }, tex: { tufts, clumps, decor }, shapes (gen/shapes.js) }

export const Gpu = 'Gpu';
// { renderer, shared (uniforms), materials, scene, dustScene, shadow, shadowsDirty, gbuf, gbufSS, reflect,
//   resolve, resolveScene, rays, raysScene, rayRT, finalRT, fsCam, post, postScene, blit, blitScene }

export const Viewport = 'Viewport';
// { w, h, scale, ppu, mx, my, zoom, zoomMin, zoomMax, dirty }
//   scale: whole upscale; ppu: frame pixels per world unit at this zoom (0 = not sized yet)
export const createViewport = () => ({ w: 480, h: 270, scale: 1, ppu: 0, mx: 0, my: 0, zoom: 0, zoomMin: 0, zoomMax: 0, dirty: true, fps: false });

export const Time = 'Time';
export const createTime = () => ({ now: 0, prev: null, dt: 0, sceneTime: 0, paused: false });

export const Input = 'Input';
// DOM listeners only push raw records into `pending`; the input system turns
// them into the per-frame fields below.
export const createInput = () => ({
  pending: [],
  keys: new Set(),
  pointer: null,           // { x, y } in CSS pixels
  drag: null,              // { sx, sy, x, y, button, moved }
  dragDelta: [0, 0],
  lookDelta: [0, 0],       // mouse movement while the pointer is locked (first person)
  clicks: [],              // left clicks without a drag: { x, y }
  rightClicks: [],
  wheel: [],               // { dy, shift }
  pressed: [],             // { key, ctrl }
  ui: [],                  // panel actions: { action, item }
  stream: [],              // all of the above, in the order they happened
  resized: false,
});

export const Editor = 'Editor';
// active: the settings panel is open (the world is paused)
export const createEditor = () => ({ active: false });

// cell key -> Set of circles: Blocker data (BlockGrid), Footprint data (CoverGrid);
// ground: the cliffs (gen/terrain.js) on the BlockGrid, else null
export const BlockGrid = 'BlockGrid';
export const CoverGrid = 'CoverGrid';
export const createGrid = (ground = null) => ({ cells: new Map(), ground });

export const Random = 'Random';
export const createRandom = (seed) => ({ seed });

export const Slimes = 'Slimes';
// due: kind -> scene time when the next slime of that kind spawns (null: one is alive)
export const createSlimes = (kinds, at) => ({ due: Object.fromEntries(kinds.map((k) => [k, at])) });

export const ActiveView = 'ActiveView';
// the camera drawn this frame: { camera, persp }

export const Ui = 'Ui';
// { canvas, cameraButtons, fpsButtons, lookButtons, zoomSlider } DOM handles
