// Slime mobs: palette, kinds, animation clips and behaviour. Pure data —
// lib/slimeShapes.js gives the shape of each frame, lib/slime.js builds the meshes.
//
// Shapes are written in the axes of the Blender script they come from
// (pixel-character/slimes.py: z up, the slime faces -y); lib/slime.js turns
// them into game axes (y up, facing +z).

// [lit, top in shade, shade (outlines)] per colour, like CHAR_PALETTE: pastel
// lit colours, shade shifted toward blue
export const SLIME_PALETTE = {
  slime_green: ['#a6ecdc', '#5cb8b8', '#3d6f96'],
  slime_undead: ['#bcc5f4', '#8490d4', '#565d9e'],
  slime_ghost: ['#d2e8ff', '#93b9ee', '#6080c0'],
  slime_rock: ['#71656f', '#4a4256', '#2c2a3e'],
  slime_lava: ['#ffe08a', '#ffb347', '#d9703a'],
  slime_eye: ['#3d4266', '#2a2d4a', '#2a2d4a'],
  slime_eye_pink: ['#ffa6cf', '#ff6fae', '#c2407c'],
  slime_eye_lava: ['#fff0a8', '#ffd36b', '#ffb347'],
  slime_bone: ['#f5edd6', '#cfc2a8', '#8f95a8'],
  slime_ink: ['#2a2d4a', '#2a2d4a', '#1c1e33'],
  slime_tooth: ['#f4f2ea', '#dcd8cc', '#9a98a8'],
  slime_crack_white: ['#eef6ff', '#d8e6f8', '#9fb4d8'],
  slime_crack_dark: ['#2c2a3e', '#2c2a3e', '#1c1a2a'],
  slime_hurt: ['#ec7a7a', '#c84c58', '#7a2a44'],
  slime_gray: ['#bdbdb4', '#8c8c86', '#5c5c62'],
};

// palette colour of each part ('ghost': the undead slime's attack body;
// 'lava': glowing faces of the magma slime)
export const SLIME_KINDS = {
  green: { hp: 3, body: 'slime_green', fx: 'slime_green', eye: 'slime_eye', crack: 'slime_crack_white' },
  undead: { hp: 4, body: 'slime_undead', ghost: 'slime_ghost', fx: 'slime_ghost', eye: 'slime_eye_pink', crack: 'slime_crack_white' },
  magma: { hp: 5, body: 'slime_rock', lava: 'slime_lava', fx: 'slime_lava', eye: 'slime_eye_lava', crack: 'slime_crack_dark' },
};
export const SLIME_KIND_NAMES = Object.keys(SLIME_KINDS);

// admin menu choices: [setting, label, [[name, value], ...]] (off at the start)
export const MONSTER_OPTIONS = [
  ['monsters', 'Slimes', [['Off', false], ['On', true]]],
];

// clips play in steps, like a sprite sheet: frames at fps; loops repeat, the others play once
export const SLIME_CLIPS = {
  idle: { frames: 6, fps: 8, loop: true },
  walk: { frames: 8, fps: 10, loop: true },
  run: { frames: 8, fps: 12, loop: true },
  attack: { frames: 10, fps: 12 },
  hurt: { frames: 4, fps: 10 },
  death: { frames: 8, fps: 10 },
};
export const clipLength = (clip) => SLIME_CLIPS[clip].frames / SLIME_CLIPS[clip].fps;

// world size of one slime unit (a slime is then about 0.45 tall, 0.75 wide)
export const SLIME_SCALE = 0.75;

// behaviour (distances in world units, times in seconds)
export const SLIME_AI = {
  spawnDelay: 0.5,         // first spawn, after the footprints are in the grid
  respawn: 6,              // a new slime of a kind comes this long after the last one died
  spawnRing: [3.5, 7],     // spawns this far from the start
  radius: 0.3,             // body circle against stones and trunks
  wanderRadius: 2.5,
  wait: [0.8, 2.6],        // pause between wander walks
  walkSpeed: 0.7,
  runSpeed: 1.7,
  sight: 5,                // starts to chase the player inside this distance
  giveUp: 8,               // and stops beyond this one
  reach: 1.0,              // attacks inside this distance
  cooldown: 2.2,
  linger: 2.5,             // the puddle stays after the death clip
  hitFrame: { green: 6, undead: 6, magma: 4 },   // the attack frame that hits
  hitRange: { green: 1.1, undead: 1.2, magma: 1.2 },
  knock: 3.2,              // how hard a hit pushes the player back
};

// the player's sword: when its slash hits (seconds into the attack clip),
// how far, how wide (cosine of the half angle) and how hard it pushes
export const SWORD = { at: 0.27, range: 1.2, cosArc: 0.25, knock: 2.6 };
