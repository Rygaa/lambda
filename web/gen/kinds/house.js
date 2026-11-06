// Houses: boxes of flat faces in a few colours (gen/solids.js). The front
// faces +z (the camera). Each preset is one building of the Dragon Ball Z
// world, given by its sizes:
//   kame:  Kame House: a pink two-floor house on a stone base, a red roof of
//          tile rows, its name on the front gable, a small red roof over the door.
//   goku:  Goku and Chi-Chi's house (as in The Legacy of Goku II): a brown tile
//          roof with white chimneys, a white dome and a wing in front of it.
// Like the stone ruins, they are made of many small blocks (base, trim bands,
// corner posts, frames, tile rows), so outlines and lit edges break them up.
import * as THREE from 'three';
import { defineKind } from '../registry.js';
import { box, prism, plank, tube, partsOf, boxCircles, clean } from '../solids.js';

defineKind({
  name: 'house',
  presets: {
    //      width (x), depth (z), wall height, roof height over the walls, roof overhang
    kame: { form: 'kame', width: 3.2, depth: 3.4, walls: 2.1, roof: 1.45, overhang: 0.28, text: ['KAME', 'HOUSE'] },
    goku: { form: 'goku', width: 3.6, depth: 2.4, walls: 1.3, roof: 1.15, overhang: 0.26, dome: 1.2, rise: 1.4 },
  },
  variants: 1,
  palettes: { stone: 'pink' },
  build(p) {
    const { pieces, circles, height } = FORMS[p.form](p);
    return {
      parts: partsOf(pieces),
      height,
      radius: Math.max(...circles.map(([x, z, r]) => Math.hypot(x, z) + r)),
      circles,
      blocks: true,
    };
  },
});

const FORMS = { kame, goku };

function kame({ width: W, depth: D, walls: H, roof: R, overhang: o, text }) {
  const pink = [], roof = [], white = [], glass = [], wood = [], grey = [];
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
    pieces: { grey, pink, roof: [...roof, ...letterRed], white, glass, wood },
    circles: boxCircles(W + 0.2, D + 0.2, 0.6),
    height: H + R,
  };
}

// As in The Legacy of Goku II: a long cream brick house under a brown tile
// roof with three white chimneys; in front of its left half a big white dome
// (a pipe on top, a red sign, a blue window, an arched wooden door); in front
// of its right half a wing whose gable faces the front, with stone steps.
function goku({ width: W, depth: D, walls: H, roof: R, overhang: o, dome: r, rise: k }) {
  const cream = [], tile = [], white = [], glass = [], wood = [], grey = [], red = [];
  const base = 0.16, fz = D / 2;
  // the height of the main roof over z (its ridge runs along x)
  const roofAt = (z) => H + R * (1 - Math.abs(z) / (D / 2));

  // the main house: cream brick walls on a stone base, the roof slopes to the front and the back
  grey.push(box(W + 0.14, base, D + 0.14, 0, base / 2, 0));
  cream.push(box(W, H - base, D, 0, (H + base) / 2, 0));
  bricks(cream, -W / 2, 'x', -D / 2 + 0.06, D / 2 - 0.06, base, H - 0.08);
  cream.push(prism([[-D / 2 + 0.03, H], [D / 2 - 0.03, H], [0, H + R]], -W / 2 + 0.03, W / 2 - 0.03).rotateY(Math.PI / 2));
  tile.push(...gableRoof(D, W, H, R, o, 1).map((g) => g.rotateY(Math.PI / 2)));
  wood.push(box(W + 2 * o + 0.06, 0.1, 0.18, 0, H + R + 0.165, 0));
  // white chimneys, two grey pipes on each
  for (const [x, z] of [[-W * 0.3, -D * 0.2], [-W * 0.02, D * 0.2], [W * 0.42, -D * 0.04]]) {
    const y = roofAt(z);
    white.push(box(0.4, 0.75, 0.32, x, y + 0.2, z));
    white.push(box(0.46, 0.06, 0.38, x, y + 0.6, z));
    for (const dx of [-0.08, 0.08]) grey.push(tube([x + dx, y + 0.62, z], [x + dx, y + 0.76, z], 0.06, 0.06, 6));
  }
  // a window on the lit left side
  sideWindow(glass, white, -W / 2, -1, -D * 0.15, base + 0.6, 0.46, 0.36);

  // the dome on a low ring, a grey pipe on its top: k times as tall as it is
  // round, so it still looks like a half circle from the camera up above; it
  // stands whole in front of the house (clear of the wall and the eaves)
  const [cx, cz] = [-W * 0.27, fz + r + 0.2];
  grey.push(tube([cx, 0, cz], [cx, base, cz], r + 0.08, r + 0.08, 14));
  white.push(clean(new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, k, 1).translate(cx, base, cz)));
  white.push(tube([cx, base, cz], [cx, base + 0.1, cz], r + 0.03, r + 0.03, 14));
  grey.push(tube([cx, base + k * r - 0.1, cz], [cx, base + k * r + 0.42, cz], 0.1, 0.1, 6));
  grey.push(tube([cx, base + k * r + 0.36, cz], [cx, base + k * r + 0.46, cz], 0.15, 0.15, 6));
  // the arched door: a white arch out of the dome, a plank door in it, a step
  const arch = 0.42, dh = 0.8, dz = cz + r;
  white.push(box(2 * arch, dh, 0.42, cx, base + dh / 2, dz - 0.12));
  white.push(prism(halfDisc(arch), dz - 0.33, dz + 0.09).translate(cx, base + dh, 0));
  wood.push(box(2 * arch - 0.16, dh, 0.04, cx, base + dh / 2, dz + 0.1));
  wood.push(prism(halfDisc(arch - 0.08), dz + 0.08, dz + 0.12).translate(cx, base + dh, 0));
  for (const dx of [-0.11, 0.11]) wood.push(box(0.03, dh + 0.2, 0.02, cx + dx, base + (dh + 0.2) / 2, dz + 0.125));
  grey.push(box(1.0, 0.1, 0.36, cx, 0.05, dz + 0.28));
  // on the dome (az: turn from the front to the right, el: up from the ground)
  // (the tilt is the slope of the tall dome there)
  const onDome = (az, el) => (g) => g.rotateX(-Math.atan2(Math.sin(el) / k, Math.cos(el))).rotateY(az)
    .translate(cx + Math.sin(az) * Math.cos(el) * (r + 0.01), base + k * Math.sin(el) * (r + 0.01), cz + Math.cos(az) * Math.cos(el) * (r + 0.01));
  // the red diamond sign with a white mark, high on its front
  const mark = [];
  glyph(mark, MARK, 0.07, 0.03);
  red.push(onDome(0.38, 0.98)(box(0.52, 0.52, 0.04).rotateZ(Math.PI / 4)));
  white.push(...mark.map(onDome(0.38, 0.98)));
  // a blue window on its lit left, white bars over and under it
  glass.push(onDome(-1.15, 0.38)(box(0.62, 0.36, 0.04)));
  white.push(...[box(0.74, 0.08, 0.05, 0, 0.21, 0), box(0.74, 0.08, 0.05, 0, -0.21, 0)].map(onDome(-1.15, 0.38)));

  // the wing on the right: its gable faces the front; brick walls, wooden gable boards, a round vent
  // (as long as the dome, so their fronts line up)
  const [ww, wd, wh, wr] = [W * 0.4, cz + r - fz + 0.6, H - 0.08, 0.9];
  const [wx, wz] = [W / 2 - ww / 2, fz - 0.8 + wd / 2];
  const wf = wz + wd / 2;
  grey.push(box(ww + 0.14, base, wd + 0.14, wx, base / 2, wz));
  cream.push(box(ww, wh - base, wd, wx, (wh + base) / 2, wz));
  bricks(cream, wf, 'z', wx - ww / 2 + 0.06, wx + ww / 2 - 0.06, base, wh - 0.08);
  bricks(cream, wx - ww / 2, 'x', wz - wd / 2 + 0.3, wf - 0.06, base, wh - 0.08);
  wood.push(prism([[-ww / 2 + 0.03, wh], [ww / 2 - 0.03, wh], [0, wh + wr]], wz - wd / 2, wf - 0.02).translate(wx, 0, 0));
  for (let k = 1; k < 4; k++) wood.push(box(ww * (1 - k / 4), 0.04, 0.03, wx, wh + (k * wr) / 4, wf - 0.01));
  const vent = Array.from({ length: 8 }, (_, k) => [Math.cos((k / 8) * Math.PI * 2) * 0.11, Math.sin((k / 8) * Math.PI * 2) * 0.11]);
  glass.push(prism(vent, wf - 0.03, wf + 0.01).translate(wx, wh + wr * 0.42, 0));
  tile.push(...gableRoof(ww, wd, wh, wr, 0.2, 1).map((g) => g.translate(wx, 0, wz)));
  wood.push(box(0.5, 0.86, 0.04, wx, base + 0.43, wf + 0.01));
  frame(wood, wx, base + 0.43, 0.5, 0.86, wf, false);
  grey.push(box(0.9, 0.1, 0.5, wx, 0.05, wf + 0.3), box(0.74, 0.1, 0.3, wx, 0.15, wf + 0.2));

  // the mailbox on a post, on the left of the dome door
  const [mx, mz] = [cx - r - 0.2, dz + 0.5];
  wood.push(box(0.08, 0.6, 0.08, mx, 0.3, mz));
  red.push(box(0.24, 0.2, 0.3, mx, 0.7, mz));
  return {
    pieces: { grey, cream, tile, white, glass, wood, roof: red },
    circles: [...boxCircles(W + 0.2, D + 0.2, 0.6), [cx, cz + 0.15, r + 0.08],
      ...boxCircles(ww, wd, 0.5).map(([x, z, rr]) => [x + wx, z + wz, rr]), [mx, mz, 0.2]],
    height: H + R,
  };
}

// a half disc of radius a over the x axis (9 points), for arches
const halfDisc = (a) => Array.from({ length: 9 }, (_, k) => [Math.cos((k / 8) * Math.PI) * a, Math.sin((k / 8) * Math.PI) * a]);

// raised rows of bricks, each row shifted half a brick, on the wall x = at
// (along 'x': the bricks run along z from u0 to u1) or z = at ('z': along x),
// from height y0 to y1
function bricks(out, at, along, u0, u1, y0, y1) {
  const bw = 0.34, bh = 0.12, gap = 0.035, lift = along === 'x' ? -0.012 : 0.012;
  for (let row = 0, y = y0 + 0.04; y + bh < y1; row++, y += bh + gap) {
    for (let u = u0 - (row % 2) * bw / 2; u < u1; u += bw + gap) {
      const a = Math.max(u, u0), b = Math.min(u + bw, u1);
      if (b - a < 0.06) continue;
      out.push(along === 'x'
        ? box(0.03, bh, b - a, at + lift, y + bh / 2, (a + b) / 2)
        : box(b - a, bh, 0.03, (a + b) / 2, y + bh / 2, at + lift));
    }
  }
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

// the mark on Goku's sign (like the kanji 福 on the dome), 5 x 5
const MARK = ['10111', '11000', '10111', '11101', '10111'];
// pixel boxes `px` wide for each 1 in `rows`, centred on the origin, at z
function glyph(out, rows, px, z) {
  rows.forEach((row, r) => [...row].forEach((bit, c) => {
    if (bit === '1') out.push(box(px, px, 0.012, (c - (row.length - 1) / 2) * px, ((rows.length - 1) / 2 - r) * px, z));
  }));
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
