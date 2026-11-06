// The player's character: palette, looks, animation clips and the part list of
// its rig. Pure data — lib/character.js builds the meshes, lib/poses.js the poses.
//
// The rig is written in the axes of the Blender rig it comes from (z up, the
// character faces -y); lib/character.js turns them into game axes (y up, +z).
//
// The '3d_new' model is a FlyFF character (blender/export_flyff_char.py): its own
// meshes and joint table, the same poses and the same palette bands.
import F3D from '../assets/chars/3d_new.js';

// [lit, shade, dark (outlines)] per colour; the post pass bands them like
// stone (see charColor in render/shaders.js)
export const CHAR_PALETTE = {
  skin: ['#f8cfa4', '#e39c7a', '#a9645e'],
  eye: ['#2a1f2d', '#2a1f2d', '#2a1f2d'],
  gold: ['#f5d35a', '#cc9c30', '#8a5a2c'],
  metal: ['#eef4f8', '#aab8c6', '#6a7690'],
  leather: ['#8a6a44', '#644a32', '#3d2b2a'],
  leather_dark: ['#5a3d2e', '#3d2a24', '#22171c'],
  red: ['#e8594c', '#b33c46', '#6e2a40'],
  blue: ['#4478c2', '#30528f', '#232f5c'],
  steel: ['#d8dee6', '#9aa6b8', '#5a6478'],
  steel_dark: ['#8a94a6', '#626b80', '#3a3f52'],
  purple: ['#9a68d8', '#6c46a8', '#3c2a6c'],
  purple_dark: ['#5a3c8a', '#3e2a66', '#241a40'],
  gem: ['#7cf0e8', '#3cb8c8', '#2a6a8a'],
  forest: ['#5eae6a', '#3f8050', '#24493a'],
  tan: ['#e6c88a', '#bf9a5e', '#7a5a40'],
  feather: ['#ffffff', '#d8dce8', '#9aa0b8'],
  h_brown: ['#7a4a2e', '#553222', '#331d22'],
  h_blonde: ['#f5d870', '#d0a040', '#8f6a36'],
  h_black: ['#4a4258', '#2e2840', '#17141f'],
  h_ginger: ['#e8823e', '#b0522e', '#6e3028'],
  h_gray: ['#e2e2e8', '#a8a8b8', '#686878'],
  slash: ['#fffbe6', '#fffbe6', '#fffbe6'],
  ...F3D.palette,      // f3d_*: the colours of the 3d_new model
};
// material ids: CHAR_MID + index in CHAR_PALETTE (ids below are the forest's)
export const CHAR_MID = 10;

// world size of one rig unit (the rig is about 1.65 units tall; its eyes are
// then about at the first-person eye height)
export const RIG_SCALE = 0.62;

// clips: length in seconds; loops repeat, the others play once
export const CLIPS = {
  idle: { length: 2.4, loop: true },
  walk: { length: 0.7, loop: true },
  run: { length: 0.45, loop: true },
  jump: { length: 0.75 },
  attack: { length: 0.6 },
};
// the 2D sprite look: a 4 x 4 sheet of frame x frame pixels, drawn one sheet
// pixel per top-view pixel. Rows: facing the camera, left, right, away;
// columns: the walk steps (one walk / run loop plays all four); idle: the column
// shown while standing
export const SPRITE = { url: 'assets/sprites/dbz_player.png', frame: 32, steps: 4, idle: 1 };
export const GUARD_SPEED = 7;     // shield up / down, per second
export const RUN_SPEED = 4.4;     // walking speed is Player.speed

// editor panel choices: [Character field, label, [[name, value], ...]]
// ('color' sets the hair and the beard colour)
export const LOOK_OPTIONS = [
  ['model', 'Model', [['Sprite (DBZ)', 'sprite'], ['3D', 'rig'], ['3D new', '3d_new']]],
  ['hair', 'Hair', [['Short', 'short'], ['Spiky', 'spiky'], ['Long', 'long'], ['Ponytail', 'ponytail'], ['Bald', 'bald']]],
  ['beard', 'Beard', [['None', 'none'], ['Moustache', 'moustache'], ['Full', 'full'], ['Long', 'long']]],
  ['color', 'Colour', [['Brown', 'h_brown'], ['Blonde', 'h_blonde'], ['Black', 'h_black'], ['Ginger', 'h_ginger'], ['Gray', 'h_gray']]],
  ['outfit', 'Outfit', [['Adventurer', 'adventurer'], ['Knight', 'knight'], ['Mage', 'mage'], ['Ranger', 'ranger']]],
];

const OUTFITS = {
  adventurer: { tunic: 'red', pants: 'leather', boots: 'leather_dark', belt: 'leather_dark', buckle: 'gold', cape: 'blue', shield: 'blue' },
  knight: { tunic: 'steel', pants: 'steel_dark', boots: 'steel_dark', belt: 'leather_dark', buckle: 'gold', cape: 'red', shield: 'red' },
  mage: { tunic: 'purple', pants: 'purple_dark', boots: 'purple_dark', belt: 'gold', buckle: 'gem', cape: null, shield: 'blue' },
  ranger: { tunic: 'forest', pants: 'leather', boots: 'leather_dark', belt: 'leather_dark', buckle: 'gold', cape: null, shield: 'blue' },
};

// joints: name -> [parent, position, rest rotation (degrees)]
export const JOINTS = {
  hips: ['root', [0, 0, 0.36]],
  chest: ['hips', [0, 0, 0]],
  neck: ['chest', [0, 0, 0.5]],
  shS: ['chest', [0.37, 0, 0.46]],     // S: sword side (+x)
  shH: ['chest', [-0.37, 0, 0.46]],    // H: shield side
  handS: ['shS', [0, 0, -0.44]],
  handH: ['shH', [0, 0, -0.44]],
  sword: ['handS', [0, 0, 0]],
  shield: ['handH', [0, 0, 0]],
  legS: ['hips', [0.13, 0, 0]],
  legH: ['hips', [-0.13, 0, 0]],
  quiver: ['chest', [0.1, 0.27, 0.28], [0, 28, 0]],
  slash: ['chest', [0.47, 0, 0.46]],
};

// the joint table of a look's model
export const jointsOf = (look) => (look.model === '3d_new' ? F3D.joints : JOINTS);

// the sword trail: a ribbon around the sword shoulder, shown between two arm angles
export const SLASH = { from: -205, to: -35, segments: 34, inner: 1.0, outer: 1.24 };

// small fixed jitter for the spikes (same spikes every time)
const jitter = (i) => Math.sin(i * 12.9898) * 8;

function hairParts(style, c) {
  const p = [];
  const box = (size, pos, color = c, rot) => p.push({ joint: 'neck', shape: 'box', size, pos, rot, color });
  if (style === 'bald') {
    for (const s of [-1, 1]) box([0.13, 0.03, 0.04], [s * 0.15, -0.33, 0.42]);
    return p;
  }
  if (style === 'spiky') {
    box([0.8, 0.74, 0.12], [0, 0.02, 0.66]);
    box([0.78, 0.22, 0.46], [0, 0.24, 0.45]);
    box([0.76, 0.12, 0.1], [0, -0.29, 0.56]);
    for (const s of [-1, 1]) box([0.06, 0.5, 0.3], [s * 0.37, 0.05, 0.47]);
    let i = 0;
    for (const x of [-0.24, 0, 0.24]) for (const y of [-0.18, 0.16]) {
      i++;
      p.push({ joint: 'neck', shape: 'cone', size: [0.15, 0.3, 4], pos: [x, y, 0.84],
        rot: [18 + jitter(i), x * 60, 45 + jitter(i + 7)], color: c });
    }
    return p;
  }
  // short (also the base of long and ponytail)
  box([0.82, 0.76, 0.2], [0, 0.02, 0.64]);
  box([0.78, 0.22, 0.52], [0, 0.24, 0.42]);
  box([0.76, 0.12, 0.12], [0, -0.29, 0.55]);
  box([0.36, 0.12, 0.08], [-0.12, -0.3, 0.47]);
  for (const s of [-1, 1]) box([0.06, 0.5, 0.36], [s * 0.37, 0.05, 0.44]);
  if (style === 'long') {
    box([0.8, 0.2, 0.74], [0, 0.27, 0.27]);
    for (const s of [-1, 1]) box([0.07, 0.36, 0.62], [s * 0.385, 0.1, 0.32]);
  } else if (style === 'ponytail') {
    box([0.16, 0.1, 0.14], [0, 0.39, 0.52], 'gold');
    box([0.15, 0.13, 0.46], [0, 0.45, 0.27], c, [14, 0, 0]);
  }
  return p;
}

function beardParts(style, c) {
  const p = [];
  if (style === 'none') return p;
  const box = (size, pos) => p.push({ joint: 'neck', shape: 'box', size, pos, color: c });
  box([0.3, 0.06, 0.06], [0, -0.335, 0.15]);                       // moustache
  for (const s of [-1, 1]) box([0.06, 0.06, 0.1], [s * 0.15, -0.335, 0.11]);
  if (style === 'moustache') return p;
  box([0.66, 0.08, 0.15], [0, -0.33, 0.065]);                      // full beard
  box([0.58, 0.38, 0.14], [0, -0.15, -0.01]);
  for (const s of [-1, 1]) box([0.06, 0.3, 0.26], [s * 0.375, -0.17, 0.15]);
  if (style === 'long') {
    box([0.46, 0.1, 0.36], [0, -0.33, -0.18]);
    p.push({ joint: 'neck', shape: 'cone', size: [0.2, 0.22, 4], pos: [0, -0.33, -0.46], rot: [180, 0, 45], color: c });
  }
  return p;
}

// every part of a character with this look (a Character component):
// [{ joint, shape: box | cyl | cone, size, pos, rot?, color, noShadow? }]
//   box size: [x, y, z]; cyl / cone size: [radius, depth, sides];
//   mesh: { pos, nrm, idx } instead of a size (the 3d_new model)
export function characterParts(look) {
  const of = OUTFITS[look.outfit] || OUTFITS.adventurer;
  if (look.model === '3d_new') return flyffParts().concat(weaponParts(of));
  const p = [];
  const add = (joint, shape, size, pos, color, rot, extra) => p.push({ joint, shape, size, pos, color, rot, ...extra });
  for (const side of ['S', 'H']) {
    add('leg' + side, 'box', [0.2, 0.22, 0.34], [0, 0, -0.16], of.pants);
    add('leg' + side, 'box', [0.23, 0.3, 0.14], [0, -0.03, -0.29], of.boots);
  }
  // torso
  add('chest', 'box', [0.56, 0.38, 0.48], [0, 0, 0.26], of.tunic);
  add('chest', 'box', [0.62, 0.44, 0.14], [0, 0, 0.02], of.tunic);
  add('chest', 'box', [0.6, 0.42, 0.07], [0, 0, 0.11], of.belt);
  add('chest', 'box', [0.1, 0.03, 0.09], [0, -0.22, 0.11], of.buckle);
  if (of.cape) add('chest', 'box', [0.62, 0.06, 0.62], [0, 0.24, 0.19], of.cape, [-6, 0, 0]);
  if (look.outfit === 'knight') {
    add('chest', 'box', [0.3, 0.03, 0.4], [0, -0.2, 0.22], 'blue');
    add('chest', 'box', [0.1, 0.035, 0.1], [0, -0.215, 0.3], 'gold');
  } else if (look.outfit === 'mage') {
    add('chest', 'box', [0.64, 0.46, 0.38], [0, 0, -0.14], 'purple');
    add('chest', 'box', [0.66, 0.48, 0.05], [0, 0, -0.31], 'gold');
    add('chest', 'box', [0.5, 0.42, 0.07], [0, 0, 0.5], 'gold');
  } else if (look.outfit === 'ranger') {
    add('chest', 'box', [0.6, 0.44, 0.12], [0, 0, 0.47], 'tan');
    add('chest', 'box', [0.24, 0.05, 0.3], [0.12, -0.2, 0.38], 'tan');
    add('quiver', 'cyl', [0.08, 0.55, 6], [0, 0, 0], 'leather');
    for (const dx of [-0.03, 0.03]) add('quiver', 'cone', [0.04, 0.12, 3], [dx, 0, 0.33], 'feather');
  }
  // head
  add('neck', 'box', [0.74, 0.64, 0.62], [0, 0, 0.32], 'skin');
  for (const s of [-1, 1]) add('neck', 'box', [0.08, 0.03, 0.14], [s * 0.15, -0.325, 0.31], 'eye');
  p.push(...hairParts(look.hair, look.hairColor), ...beardParts(look.beard, look.beardColor));
  // arms
  const wide = look.outfit === 'mage';
  for (const [side, s] of [['S', 1], ['H', -1]]) {
    add('sh' + side, 'box', [wide ? 0.2 : 0.16, wide ? 0.21 : 0.17, 0.4], [0, 0, -0.2], of.tunic);
    add('sh' + side, 'box', [0.15, 0.15, 0.15], [0, 0, -0.44], 'skin');
    if (look.outfit === 'knight') add('sh' + side, 'box', [0.24, 0.27, 0.12], [s * 0.02, 0, 0], 'steel');
  }
  return p.concat(weaponParts(of));
}

// sword (along +z from the grip) and shield (faces -y; casts no shadow,
// or it darkens the whole body when raised)
function weaponParts(of) {
  const p = [];
  const add = (joint, shape, size, pos, color, rot, extra) => p.push({ joint, shape, size, pos, color, rot, ...extra });
  add('sword', 'box', [0.07, 0.07, 0.2], [0, 0, 0], 'leather_dark');
  add('sword', 'box', [0.08, 0.32, 0.06], [0, 0, 0.11], 'gold');
  add('sword', 'box', [0.05, 0.13, 0.72], [0, 0, 0.5], 'metal');
  add('sword', 'cone', [0.09, 0.14, 4], [0, 0, 0.93], 'metal', [0, 0, 45]);
  const flat = { noShadow: true };
  add('shield', 'cyl', [0.27, 0.035, 8], [0, -0.05, 0.05], 'metal', [90, 0, 22.5], flat);
  add('shield', 'cyl', [0.24, 0.05, 8], [0, -0.08, 0.05], of.shield, [90, 0, 22.5], flat);
  add('shield', 'cyl', [0.07, 0.05, 6], [0, -0.12, 0.05], 'gold', [90, 0, 0], flat);
  return p;
}

// the textured copies of the 3d_new model, drawn at full resolution in the top
// view: [{ joint, tex, pos, nrm, uv, idx }] (tex: a path under assets/chars/)
export const screenParts = (look) => (look.model === '3d_new' ? F3D.screen : []);

// the 3d_new model: one mesh per joint and palette colour (shape 'mesh':
// { pos, nrm, idx } in rig axes, relative to the joint)
function flyffParts() {
  return F3D.parts.map(({ joint, color, pos, nrm, idx }) => ({ joint, shape: 'mesh', mesh: { pos, nrm, idx }, color }));
}
