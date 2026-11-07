// Cliffs: the ground in levels. A level map on a grid of half-unit cells: a
// plateau is a few round blobs with wavy edges, and a higher level sits inside
// a lower one with a terrace around it. Each separate plateau rises by its own
// height. Rock walls stand where the ground drops, and stone stairs go down
// from every plateau, so every level can be reached (recipe "cliffs", see
// documentation/worlds.md). A mountain border (recipe "borders", gen/borders.js) is a
// band of cliffs stacked along a side, with no stairs: it closes the world.
// Their numbers are in the asset types terrain/cliff and terrain/mountain.
//   heightAt, levelUnder, bareAt: what the movers, the placement rules and the grass ask
//   terrainGeometry: the tops, the walls and the stairs (made with math, like gen/builders)
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { nextRandom, hashSeed } from '../lib/random.js';
import { fromSide, wavyLine } from './borders.js';

export const CELL = 0.5;        // grid step (world units)
export const STEP = 0.35;       // a mover goes up or down at most this much at once
const MARGIN = 6;               // terrace (cells) between a cliff and the one above it: room for stairs
const SMOOTH = 2;               // no part of a plateau thinner than 2 * SMOOTH + 1 cells
const STAIRS = { len: 4, landing: 2, width: [4, 6], rise: 0.25 };   // in cells; rise: height of one step
const RIM = { out: 0.08, in: 0.15, up: [0.03, 0.12], down: 0.05 };  // the stone lip on top of a wall
const FOOT = 0.22;              // a wall leans back: its foot stands this far out (so side walls show from above)
const JITTER = 0.06;            // cell corners move this far at most, so edges are not ruler-straight
const MOVE = 0.2;               // smoothing moves a corner of the walls at most this far
const LANDING = -2;             // stair[] value of the free cells at the foot of stairs
const PAST = 18;                // mountain borders go on this far past the edge of the world
const END = 1;                  // a free end of a mountain border stops at least this far past the world
// the sides next to each side: at its negative end (along < 0), at its positive end (gen/borders.js fromSide)
const NEXT = { west: ['north', 'south'], east: ['north', 'south'], north: ['west', 'east'], south: ['west', 'east'] };

export const CLIFF_FIELDS = ['asset', 'count', 'palette', 'stairs'];
const DIRS = [[0, 1], [-1, 0], [1, 0], [0, -1]];    // the last one (-z) faces away from the camera

// the grid covers [-ext, ext] (past the world when there are mountain borders);
// level, height: per cell; border: 1 in a mountain border; stair: index in
// stairs, -1, or LANDING; edges: the top of every wall { x, z, nx, nz } (for
// "near": "cliffs"); seed: for the walls
function createTerrain(ext, seed, palette, stairsPalette) {
  const n = Math.round((2 * ext) / CELL);
  return { ext, n, seed, level: new Int8Array(n * n), height: new Float32Array(n * n), border: new Uint8Array(n * n),
    stair: new Int16Array(n * n).fill(-1), stairs: [], edges: [], palette, stairsPalette };
}

const cellOf = (t, v) => Math.floor((v + t.ext) / CELL);
const inside = (t, i, j) => i >= 0 && j >= 0 && i < t.n && j < t.n;
const levelAt = (t, i, j) => (inside(t, i, j) ? t.level[i * t.n + j] : 0);
const heightOf = (t, i, j) => (inside(t, i, j) ? t.height[i * t.n + j] : 0);
const stairAt = (t, i, j) => (inside(t, i, j) ? t.stair[i * t.n + j] : -1);
const centre = (t, i) => -t.ext + (i + 0.5) * CELL;

// height of the ground at (x, z): its plateau, or the slope of the stairs
export function heightAt(t, x, z) {
  if (!t) return 0;
  const i = cellOf(t, x), j = cellOf(t, z);
  const s = stairAt(t, i, j);
  if (s < 0) return heightOf(t, i, j);
  const st = t.stairs[s];
  const d = (x - st.x) * st.dx + (z - st.z) * st.dz;      // from the top of the stairs, down along them
  return st.top - (st.top - st.base) * Math.min(1, Math.max(0, d / (st.len * CELL)));
}

// no grass here: stairs, and the top edge of a cliff (the lip)
export function bareAt(t, x, z) {
  if (!t) return false;
  const i = cellOf(t, x), j = cellOf(t, z);
  if (stairAt(t, i, j) >= 0) return true;
  const h = heightOf(t, i, j);
  return h > 0 && DIRS.some(([dx, dz]) => heightOf(t, i + dx, j + dz) < h);
}

// the level of the ground under a circle, or -1 when it is not flat there
// (a cliff edge, stairs, the foot of stairs, which stays free, or a mountain border)
export function levelUnder(t, x, z, r) {
  if (!t) return 0;
  let level = null;
  for (let i = cellOf(t, x - r); i <= cellOf(t, x + r); i++)
    for (let j = cellOf(t, z - r); j <= cellOf(t, z + r); j++) {
      if (stairAt(t, i, j) !== -1 || (inside(t, i, j) && t.border[i * t.n + j])) return -1;
      const l = levelAt(t, i, j);
      if (level !== null && l !== level) return -1;
      level = l;
    }
  return level;
}

// ---------------------------------------------------------------- the level map
// b: gen/world.js builder; spec: { count, levels, width, height, palette, stairs };
// borders: the planned borders (gen/recipe.js), a mountain border has
// { name, mountain: the values of its type, line, inside(x, z, pad) }
export function buildCliffs(b, spec, borders = []) {
  const mountains = borders.filter((bd) => bd.mountain);
  const ext = b.half + (mountains.length ? PAST : 0);
  const t = createTerrain(ext, Math.floor(b.rand() * 2 ** 31), spec.palette, spec.stairs ?? 'sand');
  const n = t.n;
  const pick = (v) => (Array.isArray(v) ? b.range(v[0], v[1]) : v);
  const start = { x: b.start[0], z: b.start[2], r: (b.glades[0]?.r ?? 2) + 2 };
  const masks = [];     // masks[k - 1]: the cells at level k or higher

  // a mask of `count` blobs around (cx, cz): radius R, the others smaller and
  // `spread` away; sine waves on the radius make each edge wavy
  const blobs = (cx, cz, R, count, spread) => {
    const shapes = [];
    for (let k = 0; k < count; k++) {
      const a = b.range(0, Math.PI * 2), d = k === 0 ? 0 : R * spread * b.range(0.5, 0.9);
      const waves = [2, 3, 4, 6, 9].map((h) => ({ h, amp: b.range(0.03, 0.15) / Math.sqrt(h - 1), ph: b.range(0, Math.PI * 2) }));
      shapes.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, r: k === 0 ? R : R * b.range(0.5, 0.8), waves });
    }
    const m = new Uint8Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = centre(t, i), z = centre(t, j);
        m[i * n + j] = shapes.some((s) => {
          const ang = Math.atan2(z - s.z, x - s.x);
          const edge = s.r * (1 + s.waves.reduce((sum, w) => sum + w.amp * Math.sin(w.h * ang + w.ph), 0));
          return Math.hypot(x - s.x, z - s.z) < edge;
        }) ? 1 : 0;
      }
    return m;
  };

  const count = spec.count;
  for (let made = 0, tries = 0; made < count && tries < count * 40; tries++) {
    const R = pick(spec.width) / 2;
    const cx = b.range(-b.half * 0.85, b.half * 0.85), cz = b.range(-b.half * 0.85, b.half * 0.85);
    let cur = open(blobs(cx, cz, R, 1 + Math.floor(b.rand() * 3), 1), n);
    // the camera starts on the ground, in the first clearing; borders stay apart
    if (!any(cur) || touches(t, cur, start)) continue;
    if (cur.some((v, c) => v && borders.some((bd) => bd.inside(centre(t, Math.floor(c / n)), centre(t, c % n), MARGIN * CELL + 1)))) continue;
    const levels = Math.round(pick(spec.levels));
    for (let k = 1; k <= levels; k++) {
      masks[k - 1] = or(masks[k - 1] ?? new Uint8Array(n * n), cur);
      const ox = b.range(-R, R) * 0.3, oz = b.range(-R, R) * 0.3;
      cur = open(and(erode(cur, MARGIN, n), blobs(cx + ox, cz + oz, R * 0.65, 1 + Math.floor(b.rand() * 2), 0.8)), n);
      if (!any(cur)) break;
    }
    made++;
  }

  // no slivers and no narrow gaps; every level keeps its terrace inside the one
  // below; each separate piece of a level rises by its own height
  for (let k = 0; k < masks.length; k++) {
    masks[k] = open(close(masks[k], n), n);
    if (k > 0) masks[k] = open(and(masks[k], erode(masks[k - 1], MARGIN, n)), n);
    for (const piece of pieces(masks[k], n)) {
      const h = Math.round(pick(spec.height) * 20) / 20;
      for (const c of piece) { t.level[c]++; t.height[c] += h; }
    }
  }

  // stairs: one down from every separate piece of every level
  for (let k = 1; k <= masks.length; k++)
    for (const piece of pieces(masks[k - 1], n)) addStairs(t, b, piece, k);

  // mountain borders: tiers of cliffs, each further in from the side than the one
  // on top of it (a wavy ledge between); one type has the same tiers on every
  // side, so they meet at the corners
  const rng = { seed: Math.floor(b.rand() * 2 ** 31) };
  // a world with no mountain border still takes these numbers, so that its objects stay where they are
  if (!mountains.length) for (let k = Math.round(b.range(3, 4)); k > 0; k--) b.rand();
  const stacks = new Map();      // type -> the height of each tier
  for (const bd of mountains) {
    const m = bd.mountain;
    if (!stacks.has(bd.name)) stacks.set(bd.name, Array.from({ length: Math.round(pick(m.tiers)) }, () => Math.round(pick(m.height) * 20) / 20));
    const tierHeights = stacks.get(bd.name), tiers = tierHeights.length;
    const ledges = tierHeights.map(() => wavyLine(rng, m.ledge, m.ledgeWobble));     // ledges[0] is not used
    // an end with no mountain on the next side stops past the world tier by tier,
    // each tier on its own wavy line (like the foot and the ledges of the side), and
    // all before the end of the grid (else a flat cut shows there). Its own random
    // numbers, so the world itself stays the same.
    const endRng = { seed: hashSeed(t.seed, bd.side, 'end') };
    const ends = NEXT[bd.side].map((side) => !mountains.some((o) => o.side === side) && {
      foot: wavyLine(endRng, [2 * m.wobble[1], 2 * m.wobble[1]], m.wobble),
      ledges: tierHeights.map(() => wavyLine(endRng, m.ledge, m.ledgeWobble)),
    });
    // how far past the world tier k of an end goes, at e in from the side (the top tier stops first)
    const endOf = (end, k, e) => {
      let a = END + end.foot(e);
      for (let q = k + 1; q < tiers; q++) a += end.ledges[q](e);
      return Math.min(a, PAST - 1);
    };
    for (let k = 0; k < tiers; k++) {
      const m = new Uint8Array(n * n);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const [e, along] = fromSide(bd.side, b.half, centre(t, i), centre(t, j));
          const end = ends[along < 0 ? 0 : 1];
          if (end && Math.abs(along) - b.half >= endOf(end, k, e)) continue;
          let inward = bd.line(along);
          for (let q = 1; q <= k; q++) inward -= ledges[q](along);
          m[i * n + j] = e < inward ? 1 : 0;
        }
      const tier = open(m, n);
      for (let c = 0; c < n * n; c++) {
        if (!tier[c] || t.level[c] > k) continue;      // where two sides meet, a tier counts once
        t.level[c] = k + 1;
        t.height[c] = tierHeights.slice(0, k + 1).reduce((s, h) => s + h, 0);
        t.border[c] = 1;
      }
    }
  }
  eachWall(t, (i, j, dx, dz) => t.edges.push({ x: centre(t, i) + dx * CELL / 2, z: centre(t, j) + dz * CELL / 2, nx: dx, nz: dz }));
  return t;
}

// stairs down from level k, from a cell of `piece`: towards the camera or a
// side (in random order), else away from it; the cells picked at random
function addStairs(t, b, piece, k) {
  const { len, landing } = STAIRS;
  const width = Math.round(b.range(...STAIRS.width));
  const order = DIRS.slice(0, 3);
  for (let a = order.length - 1; a > 0; a--) {
    const c = Math.floor(b.rand() * (a + 1));
    [order[a], order[c]] = [order[c], order[a]];
  }
  for (const [dx, dz] of [...order, DIRS[3]]) {
    const rx = dz, rz = -dx;          // along the wall
    const fits = piece.filter((c) => {
      const i = Math.floor(c / t.n), j = c % t.n;
      for (let w = 0; w < width; w++) {
        const ai = i + rx * w, aj = j + rz * w;
        if (levelAt(t, ai, aj) !== k || stairAt(t, ai, aj) !== -1) return false;
        // the stairs, the free foot, and one cell beside them on both sides
        for (let s = 1; s <= len + landing; s++)
          for (const side of [-1, w, width]) {
            if (side !== w && s > len) continue;
            const si = i + dx * s + rx * side, sj = j + dz * s + rz * side;
            if (!inside(t, si, sj) || levelAt(t, si, sj) !== k - 1 || stairAt(t, si, sj) >= 0) return false;
          }
      }
      return true;
    });
    if (!fits.length) continue;
    const c = b.pick(fits), i = Math.floor(c / t.n), j = c % t.n;
    const index = t.stairs.length;
    // x, z: where the stairs meet the wall, at their left end seen from the front
    t.stairs.push({ dx, dz, rx, rz, len, width, top: heightOf(t, i, j), base: heightOf(t, i + dx, j + dz),
      x: centre(t, i) + dx * CELL / 2 - rx * CELL / 2, z: centre(t, j) + dz * CELL / 2 - rz * CELL / 2 });
    for (let w = 0; w < width; w++)
      for (let s = 1; s <= len + landing; s++) t.stair[(i + dx * s + rx * w) * t.n + (j + dz * s + rz * w)] = s > len ? LANDING : index;
    return;
  }
}

// every cell edge where the ground drops: fn(i, j, dx, dz, top, bottom), the
// higher cell (i, j) and the way it faces; not at the top of stairs
function eachWall(t, fn) {
  for (let i = 0; i < t.n; i++)
    for (let j = 0; j < t.n; j++) {
      const h = t.height[i * t.n + j];
      if (h === 0 || t.stair[i * t.n + j] >= 0) continue;
      for (const [dx, dz] of DIRS) {
        const h2 = heightOf(t, i + dx, j + dz);
        if (h2 >= h) continue;
        const st = t.stairs[stairAt(t, i + dx, j + dz)];
        if (st && st.dx === dx && st.dz === dz && st.top === h) continue;
        fn(i, j, dx, dz, h, h2);
      }
    }
}

// ---------------------------------------------------------------- masks (0 / 1 per cell)
const any = (m) => m.some((v) => v);
const or = (a, b) => a.map((v, c) => v | b[c]);
const and = (a, b) => a.map((v, c) => v & b[c]);
const touches = (t, m, p) => m.some((v, c) => v && Math.hypot(centre(t, Math.floor(c / t.n)) - p.x, centre(t, c % t.n) - p.z) < p.r + CELL);

// keep (erode) or add (dilate) a cell when all / any cells within the disc of radius r are in the mask
function grow(m, r, n, all) {
  const disc = [];
  for (let a = -r; a <= r; a++) for (let c = -r; c <= r; c++) if (a * a + c * c <= r * r + r) disc.push([a, c]);
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const hit = disc.some(([a, c]) => {
        const v = i + a >= 0 && j + c >= 0 && i + a < n && j + c < n && m[(i + a) * n + j + c] === 1;
        return v !== all;
      });
      out[i * n + j] = hit !== all ? 1 : 0;
    }
  return out;
}
const erode = (m, r, n) => grow(m, r, n, true);
const dilate = (m, r, n) => grow(m, r, n, false);
const open = (m, n) => dilate(erode(m, SMOOTH, n), SMOOTH, n);      // no thin parts
const close = (m, n) => erode(dilate(m, SMOOTH, n), SMOOTH, n);     // no narrow gaps

// the separate pieces of a mask (4 neighbours) -> [[cell, ...], ...]
function pieces(m, n) {
  const seen = new Uint8Array(n * n), out = [];
  for (let c0 = 0; c0 < n * n; c0++) {
    if (!m[c0] || seen[c0]) continue;
    const piece = [], todo = [c0];
    seen[c0] = 1;
    while (todo.length) {
      const c = todo.pop(), i = Math.floor(c / n), j = c % n;
      piece.push(c);
      for (const [dx, dz] of DIRS) {
        const a = i + dx, d = j + dz, nc = a * n + d;
        if (a >= 0 && d >= 0 && a < n && d < n && m[nc] && !seen[nc]) { seen[nc] = 1; todo.push(nc); }
      }
    }
    out.push(piece);
  }
  return out;
}

// ---------------------------------------------------------------- geometry
// -> { tops, walls, stairs }: BufferGeometry (or null). The walls are rock
// columns of random width (two faces each, so the outlines draw their edges),
// with a few rocks stuck in them, under an uneven stone lip.
export function terrainGeometry(t) {
  const rng = { seed: t.seed };
  const rand = (lo, hi) => lo + (hi - lo) * nextRandom(rng);
  const n = t.n;

  // the walls: one per cell edge, its left and right corner seen from the front
  const list = [];
  eachWall(t, (i, j, dx, dz, h, h2) => {
    const rx = dz, rz = -dx;
    const mi = i + 0.5 + dx / 2, mj = j + 0.5 + dz / 2;
    list.push({ a: [mi - rx / 2, mj - rz / 2], b: [mi + rx / 2, mj + rz / 2], h, h2 });
  });

  // cell corners (lattice indices) -> world [x, z]. Corners on walls are
  // smoothed along them (a staircase of cells becomes a slope, square corners get
  // round), then every corner moves a little. The same for every face that uses
  // it, so nothing cracks; corners next to stairs stay (the steps are straight blocks).
  const key = (v) => `${v[0]},${v[1]}`;
  const grid = (vi, vj) => [-t.ext + vi * CELL, -t.ext + vj * CELL];
  const still = (vi, vj) => {
    for (let a = vi - 1; a <= vi; a++) for (let c = vj - 1; c <= vj; c++) if (stairAt(t, a, c) >= 0) return true;
    return false;
  };
  const along = new Map();     // corner -> { v, next: the corners beside it along walls }
  for (const { a, b } of list)
    for (const [p, q] of [[a, b], [b, a]]) {
      if (!along.has(key(p))) along.set(key(p), { v: p, next: [] });
      along.get(key(p)).next.push(q);
    }
  let smooth = new Map([...along].map(([k, e]) => [k, grid(...e.v)]));
  for (let it = 0; it < 2; it++)
    smooth = new Map([...along].map(([k, e]) => {
      const p = smooth.get(k);
      if (still(...e.v)) return [k, p];
      const ax = e.next.reduce((s, q) => s + smooth.get(key(q))[0], 0) / e.next.length;
      const az = e.next.reduce((s, q) => s + smooth.get(key(q))[1], 0) / e.next.length;
      return [k, [p[0] + 0.5 * (ax - p[0]), p[1] + 0.5 * (az - p[1])]];
    }));
  // a corner moves at most MOVE from its grid point, so no cell of a top folds over
  const corner = (vi, vj) => {
    const g = grid(vi, vj), s = smooth.get(`${vi},${vj}`) ?? g;
    const d = Math.hypot(s[0] - g[0], s[1] - g[1]), k = d > MOVE ? MOVE / d : 1;
    const p = [g[0] + (s[0] - g[0]) * k, g[1] + (s[1] - g[1]) * k];
    if (still(vi, vj)) return p;
    const r = { seed: hashSeed(t.seed, vi, vj) };
    return [p[0] + (2 * nextRandom(r) - 1) * JITTER, p[1] + (2 * nextRandom(r) - 1) * JITTER];
  };

  // which way the walls meeting at a corner face, from where their corners
  // ended up: the foot and the lip move out along it, as a mitre, so the walls
  // meet there and no face twists (the length keeps a wall's own offset)
  const normal = ({ a, b }) => {
    const P = corner(...a), Q = corner(...b), ex = Q[0] - P[0], ez = Q[1] - P[1], el = Math.hypot(ex, ez);
    return [-ez / el, ex / el];
  };
  const meet = new Map();      // corner and top height -> the normals of the walls there
  for (const w of list)
    for (const v of [w.a, w.b]) {
      const k = `${v[0]},${v[1]},${w.h}`;
      if (!meet.has(k)) meet.set(k, []);
      meet.get(k).push(normal(w));
    }
  const outward = (v, h) => {
    const ns = meet.get(`${v[0]},${v[1]},${h}`);
    const mx = ns.reduce((s, q) => s + q[0], 0), mz = ns.reduce((s, q) => s + q[1], 0), ml = Math.hypot(mx, mz);
    if (ml < 1e-6) return ns[0];
    const c = Math.max(0.5, (mx * ns[0][0] + mz * ns[0][1]) / ml);
    return [mx / ml / c, mz / ml / c];
  };

  const walls = [];
  for (const w of list) {
    const { a, b, h, h2 } = w;
    const P = corner(...a), Q = corner(...b), oP = outward(a, h), oQ = outward(b, h);
    const ex = Q[0] - P[0], ez = Q[1] - P[1], [nx, nz] = normal(w);
    // a point of the wall face: u along it (0..1), off out from it, k up it (0 foot, 1 top)
    const at = (u, off, k) => {
      const f = FOOT * (1 - k);
      return [P[0] + ex * u + (oP[0] + (oQ[0] - oP[0]) * u) * f + nx * off, h2 + (h - h2) * k,
        P[1] + ez * u + (oP[1] + (oQ[1] - oP[1]) * u) * f + nz * off];
    };
    // 1 to 3 rock columns of random width, each with its ridge pushed out
    const cuts = [0];
    for (let c = Math.floor(rand(1, 4)); c > 1; c--) cuts.push(rand(0.15, 0.85));
    cuts.sort((p, q) => p - q).push(1);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const u0 = cuts[c], u1 = cuts[c + 1], um = u0 + (u1 - u0) * rand(0.3, 0.7), off = rand(0.02, 0.08);
      quad(walls, at(u0, 0, 0), at(um, off, 0), at(um, off, 1), at(u0, 0, 1));
      quad(walls, at(um, off, 0), at(u1, 0, 0), at(u1, 0, 1), at(um, off, 1));
    }
    // now and then a rock stuck in the wall
    if (nextRandom(rng) < 0.12) walls.push(...rock(rng, at(rand(0.2, 0.8), 0.03, rand(0.15, 0.8)), rand(0.12, 0.3)));
    // the lip: front, top, back, bottom; each corner at its own height
    const up = (v) => h + RIM.up[0] + (RIM.up[1] - RIM.up[0]) * nextRandom({ seed: hashSeed(t.seed, 'lip', v[0], v[1]) });
    const out = (p, o, d) => [p[0] + o[0] * d, p[1] + o[1] * d];
    const Po = out(P, oP, RIM.out), Qo = out(Q, oQ, RIM.out), Pi = out(P, oP, -RIM.in), Qi = out(Q, oQ, -RIM.in);
    const yb = h - RIM.down, yP = up(a), yQ = up(b);
    const v3 = (p, y) => [p[0], y, p[1]];
    quad(walls, v3(Po, yb), v3(Qo, yb), v3(Qo, yQ), v3(Po, yP));
    quad(walls, v3(Po, yP), v3(Qo, yQ), v3(Qi, yQ), v3(Pi, yP));
    quad(walls, v3(Qi, h), v3(Pi, h), v3(Pi, yP), v3(Qi, yQ));
    quad(walls, v3(P, yb), v3(Q, yb), v3(Qo, yb), v3(Po, yb));
  }

  // plateau tops: one quad per cell, on the moved corners
  const tops = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const h = t.height[i * n + j];
      if (h === 0 || t.stair[i * n + j] >= 0) continue;
      const [A, B, C, D] = [corner(i, j), corner(i, j + 1), corner(i + 1, j + 1), corner(i + 1, j)].map((q) => [q[0], h, q[1]]);
      // split along the diagonal that keeps both triangles facing up (a smoothed corner can bend a cell)
      const up = (p, q, r) => (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]) > 0;
      if (up(A, B, C) && up(A, C, D)) quad(tops, A, B, C, D);
      else quad(tops, B, C, D, A);
    }

  const stairs = [];
  for (const st of t.stairs) stairSteps(stairs, walls, st);
  return { tops: faces(tops), walls: faces(walls), stairs: faces(stairs) };
}

// a small rock of size s at p: the hull of a few random points -> positions
function rock(rng, p, s) {
  const pts = [];
  for (let k = 0; k < 8; k++)
    pts.push(new THREE.Vector3(2 * nextRandom(rng) - 1, (2 * nextRandom(rng) - 1) * 0.7, 2 * nextRandom(rng) - 1).multiplyScalar(s));
  const g = new ConvexGeometry(pts).translate(...p);
  return g.attributes.position.array;
}

// one flight of stairs: the treads and risers in stone (out), the two sides
// in rock like the walls (sides), so stairs to the side read as cut into the cliff
function stairSteps(out, sides, st) {
  const steps = Math.max(3, Math.round((st.top - st.base) / STAIRS.rise));
  const run = (st.len * CELL) / steps, W = st.width * CELL;
  // s down along the stairs from the wall, w across from their left end, y up
  const at = (s, w, y) => [st.x + st.dx * s + st.rx * w, y, st.z + st.dz * s + st.rz * w];
  for (let m = 0; m < steps; m++) {
    const top = st.top - (m * (st.top - st.base)) / steps, below = st.top - ((m + 1) * (st.top - st.base)) / steps;
    const s0 = m * run, s1 = s0 + run;
    quad(out, at(s0, 0, top), at(s1, 0, top), at(s1, W, top), at(s0, W, top));
    quad(out, at(s1, 0, below), at(s1, W, below), at(s1, W, top), at(s1, 0, top));
    quad(sides, at(s0, 0, st.base), at(s1, 0, st.base), at(s1, 0, top), at(s0, 0, top));
    quad(sides, at(s1, W, st.base), at(s0, W, st.base), at(s0, W, top), at(s1, W, top));
  }
}

// a quad a, b, c, d (counter-clockwise seen from its front) as two triangles
function quad(out, a, b, c, d) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function faces(arr) {
  if (!arr.length) return null;
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}
