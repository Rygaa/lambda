// The ground under everything: grass, or a paint laid by the recipe "ground":
// sand (also along the shores: "beach"), dirt (paths), pavement (cities) and
// fields. A grid keeps, per cell and per paint, how far in from the paint's
// edge the cell is (0.5 on the edge, 1 at SOFT inside, 0 at SOFT outside).
// Sand, dirt and field edges wave with noise (pavement stays straight). The
// ground shader reads the grid with linear filtering; the grass tufts take the
// paint under them (systems/setup.js), so their jagged rows make the edges.

export const PAINTS = ['sand', 'dirt', 'pavement', 'field'];   // the texture channels R, G, B, A
export const GROUND_CELL = 0.25;
const SOFT = 0.5;
const PAD = 6;     // the grid goes on this far past the world (the camera sees a little past it)

export const GROUND_FIELDS = ['paint', 'beach', 'path', 'width', 'rect', 'circle'];

// half: the world is [-half, half]
export function createGround(half) {
  const ext = half + PAD;
  const n = Math.round((2 * ext) / GROUND_CELL);
  return { ext, n, data: new Uint8Array(n * n * 4) };
}

// how far the edges of each paint wave in and out (world units)
const WOBBLE = { sand: 0.45, dirt: 0.35, pavement: 0, field: 0.2 };

// lay paint `name` where sd(x, z) > 0 (sd: signed distance to its edge, positive
// inside), visiting the cells in box [x0, x1, z0, z1]
export function paint(g, name, sd, box = [-g.ext, g.ext, -g.ext, g.ext]) {
  const ch = PAINTS.indexOf(name), w = WOBBLE[name];
  const wave = (x, z) => (w ? w * (0.7 * noise(x * 0.6, z * 0.6) + 0.3 * noise(x * 2.1 + 17, z * 2.1)) : 0);
  const cell = (v) => Math.min(g.n - 1, Math.max(0, Math.floor((v + g.ext) / GROUND_CELL)));
  const [i0, i1, j0, j1] = [cell(box[0] - SOFT), cell(box[1] + SOFT), cell(box[2] - SOFT), cell(box[3] + SOFT)];
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const x = -g.ext + (i + 0.5) * GROUND_CELL, z = -g.ext + (j + 0.5) * GROUND_CELL;
      const v = Math.round(Math.min(1, Math.max(0, 0.5 + (sd(x, z) + wave(x, z)) / (2 * SOFT))) * 255);
      const k = (j * g.n + i) * 4 + ch;
      if (v > g.data[k]) g.data[k] = v;
    }
}

// the paint at (x, z), or 'grass': the strongest one past `edge` (0.5 = on its edge)
export function groundAt(g, x, z, edge = 0.5) {
  if (!g) return 'grass';
  const fx = (x + g.ext) / GROUND_CELL - 0.5, fz = (z + g.ext) / GROUND_CELL - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const at = (a, b, ch) => g.data[(Math.min(g.n - 1, Math.max(0, b)) * g.n + Math.min(g.n - 1, Math.max(0, a))) * 4 + ch];
  let best = 'grass', most = edge * 255;
  PAINTS.forEach((name, ch) => {
    const v = (at(i, j, ch) * (1 - tx) + at(i + 1, j, ch) * tx) * (1 - tz) + (at(i, j + 1, ch) * (1 - tx) + at(i + 1, j + 1, ch) * tx) * tz;
    if (v > most) { most = v; best = name; }
  });
  return best;
}

// smooth value noise in [-1, 1]
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const h = (a, b) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

// ------------------------------------------------------------------ shapes
// -> { sd(x, z), box }

// a band `width` wide along the line through `points` [[x, z], ...]
export function pathShape(points, width) {
  const w = width / 2;
  const xs = points.map((p) => p[0]), zs = points.map((p) => p[1]);
  return {
    sd(x, z) {
      let d = Infinity;
      for (let k = 1; k < points.length; k++) d = Math.min(d, segmentDistance(points[k - 1], points[k], x, z));
      return w - d;
    },
    box: [Math.min(...xs) - w, Math.max(...xs) + w, Math.min(...zs) - w, Math.max(...zs) + w],
  };
}

export const rectShape = ([x0, z0, x1, z1]) => ({
  sd: (x, z) => Math.min(x - x0, x1 - x, z - z0, z1 - z),
  box: [x0, x1, z0, z1],
});

export const circleShape = ([cx, cz, r]) => ({
  sd: (x, z) => r - Math.hypot(x - cx, z - cz),
  box: [cx - r, cx + r, cz - r, cz + r],
});

export function segmentDistance([ax, az], [bx, bz], x, z) {
  const ex = bx - ax, ez = bz - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
}
