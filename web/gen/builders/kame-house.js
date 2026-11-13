// The Kame House (Kame House of Dragon Ball Z): a pink two-floor house on a grey
// stone base, a red roof of tile rows, KAME HOUSE in red letters on the front
// gable, a small red roof over the door on two white posts. Made of many small
// blocks (base, trim bands, corner posts, frames, tile rows), so outlines and
// lit edges break it up. From pixel-scene version-3 (web/gen/kinds/house.js,
// commit 9da4216), with the palettes of the stone family: grey, pink, roof,
// plaster, glass, wood. The front faces +z (the camera), as the building plans.
//   width (x), depth (z), walls: wall height, roof: roof height over the walls,
//   overhang: how far the roof goes past the walls, text: the lines on the gable
import { defineBuilder } from '../registry.js';
import { box, prism, plank, partsOf, boxCircles } from '../solids.js';

defineBuilder({
  name: 'kame-house',
  build(p) {
    const { pieces, circles, height } = kame(p);
    return {
      parts: partsOf(pieces),
      height,
      radius: Math.max(...circles.map(([x, z, r]) => Math.hypot(x, z) + r)),
      circles,
      blocks: true,
      turns: false,      // its front faces the camera, as the building plans
    };
  },
});

function kame({ width: W, depth: D, walls: H, roof: R, overhang: o, text }) {
  const pink = [], roof = [], white = [], glass = [], wood = [], grey = [];   // one list per palette
  const fz = D / 2;                       // the front wall
  // a stone base a little wider than the walls, and a step at the door
  const base = 0.22;
  grey.push(box(W + 0.18, base, D + 0.18, 0, base / 2, 0));
  // the walls, the ground floor a little wider than the one above, a trim band between them
  const H1 = H * 0.5;
  pink.push(box(W, H1 - base, D, 0, (H1 + base) / 2, 0));
  pink.push(box(W - 0.06, H - H1, D - 0.06, 0, H1 + (H - H1) / 2, 0));
  white.push(box(W + 0.08, 0.1, D + 0.08, 0, H1, 0));
  white.push(box(W + 0.06, 0.08, D + 0.06, 0, H - 0.04, 0));
  corners(white, W, D, base, H);
  // the gable: a triangle on top of the walls, front to back
  pink.push(prism([[-W / 2 + 0.03, H], [W / 2 - 0.03, H], [0, H + R]], -fz + 0.03, fz - 0.03));
  roof.push(...gableRoof(W, D, H, R, o, 4));

  // front: the door on the right under a little red roof on two posts, windows
  const door = { x: W * 0.24, w: 0.6, h: 1.04 };
  grey.push(box(door.w + 0.4, 0.12, 0.4, door.x, 0.06, fz + 0.28));
  wood.push(box(door.w, door.h, 0.05, door.x, base + door.h / 2, fz + 0.01));
  frame(white, door.x, base + door.h / 2, door.w, door.h, fz, false);
  roof.push(box(door.w + 0.5, 0.07, 0.62).rotateX(0.3).translate(door.x, base + door.h + 0.22, fz + 0.3));
  for (const sx of [-1, 1]) white.push(box(0.07, door.h + 0.18, 0.07, door.x + sx * (door.w / 2 + 0.18), base + (door.h + 0.18) / 2, fz + 0.52));
  const win = (x, y, w, h) => {
    glass.push(box(w, h, 0.03, x, y, fz + 0.005));
    frame(white, x, y, w, h, fz, true);
  };
  win(-W * 0.24, base + 0.56, 0.6, 0.46);
  win(-W * 0.24, H1 + 0.48, 0.5, 0.4);
  win(W * 0.24, H1 + 0.48, 0.5, 0.4);
  // side windows (on the x faces)
  for (const sx of [-1, 1])
    for (const [z, y] of [[-D * 0.2, base + 0.56], [D * 0.2, H1 + 0.48]]) sideWindow(glass, white, sx * W / 2, sx, z, y, 0.46, 0.4);
  // the name on the front gable, in raised red letters
  const letterRed = [];
  letters(letterRed, text, 0, H + R * 0.34, fz + 0.006);
  return {
    pieces: { grey, pink, roof: [...roof, ...letterRed], plaster: white, glass, wood },
    circles: boxCircles(W + 0.2, D + 0.2, 0.6),
    height: H + R,
  };
}

// a roof whose ridge runs along z: rows of tiles on each side, every row a
// step over the one below, so each row has its own lit edge; a cap along the
// ridge. W, D: the walls under it; H: the top of the walls; R: the roof height;
// rows 1: one plain board per side
function gableRoof(W, D, H, R, o, rows) {
  const out = [];
  const a = Math.atan2(R, W / 2), t = 0.08, step = 0.035;
  const slope = (W / 2 + o) / Math.cos(a);
  for (const s of [-1, 1]) {
    const down = [s * Math.cos(a), -Math.sin(a)], up = [s * Math.sin(a), Math.cos(a)];
    for (let k = 0; k < rows; k++) {
      const u0 = (k * slope) / rows - (k ? 0.04 : 0.06), u1 = ((k + 1) * slope) / rows;
      const lift = t + (rows - k) * step, uc = (u0 + u1) / 2;
      out.push(plank(u1 - u0, t, D + 2 * o, -s * a, down[0] * uc + up[0] * lift, H + R + down[1] * uc + up[1] * lift, 0));
    }
  }
  out.push(box(0.2, 0.12, D + 2 * o + 0.04, 0, H + R + t + rows * step + 0.02, 0));
  return out;
}

// a white post on each corner of a W x D house, from y0 to y1
function corners(out, W, D, y0, y1) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    out.push(box(0.13, y1 - y0, 0.13, sx * (W / 2 - 0.02), (y0 + y1) / 2, sz * (D / 2 - 0.02)));
}

// a window on the side wall x = x0 (facing sx = -1 or 1): glass, a sill and a frame
function sideWindow(glass, frameOut, x0, sx, z, y, w, h) {
  glass.push(box(0.03, h, w, x0, y, z));
  frameOut.push(box(0.1, 0.06, w + 0.16, x0 + sx * 0.02, y - h / 2 - 0.03, z));
  frameOut.push(box(0.06, 0.06, w + 0.1, x0, y + h / 2 + 0.03, z));
  for (const sz of [-1, 1]) frameOut.push(box(0.06, h + 0.12, 0.06, x0, y, z + sz * (w / 2 + 0.03)));
}

// a frame of four bars around a w x h opening on the front wall; sill: a ledge under it
function frame(out, x, y, w, h, fz, sill) {
  const b = 0.07, z = fz + 0.025;
  out.push(box(w + 2 * b, b, 0.05, x, y + h / 2 + b / 2, z));
  out.push(box(b, h, 0.05, x - w / 2 - b / 2, y, z));
  out.push(box(b, h, 0.05, x + w / 2 + b / 2, y, z));
  if (sill) out.push(box(w + 2 * b + 0.08, 0.07, 0.12, x, y - h / 2 - 0.035, fz + 0.06));
  else out.push(box(w + 2 * b, b, 0.05, x, y - h / 2 - b / 2, z));
}

// 3 x 5 pixel letters, one row per line of `lines`, centred on (x, y) on the
// wall z = z0. A letter pixel is 2 x 2 screen pixels at the top-view zoom.
const FONT = {
  A: ['010', '101', '111', '101', '101'], E: ['111', '100', '110', '100', '111'],
  H: ['101', '101', '111', '101', '101'], K: ['101', '110', '100', '110', '101'],
  M: ['101', '111', '111', '101', '101'], O: ['010', '101', '101', '101', '010'],
  S: ['011', '100', '010', '001', '110'], U: ['101', '101', '101', '101', '111'],
};
const PX = 0.0459, PY = 0.0842;
function letters(out, lines, x, y, z0) {
  const rows = lines.length * 6 - 1;
  lines.forEach((line, l) => {
    const cols = line.length * 4 - 1;
    [...line].forEach((ch, c) => FONT[ch]?.forEach((row, r) => [...row].forEach((bit, b) => {
      if (bit !== '1') return;
      const px = x + (c * 4 + b - (cols - 1) / 2) * PX;
      const py = y + ((rows - 1) / 2 - (l * 6 + r)) * PY;
      out.push(box(PX, PY, 0.012, px, py, z0));
    })));
  });
}
