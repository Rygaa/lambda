// Water: puddles, ponds, lakes and streams. Each shape is a signed distance
// field made with math (world units to the shore, positive inside):
//   blobs:  one or more round blobs, their edge waved by a few sine harmonics,
//           joined with a smooth union (lakes: more blobs, wider spread)
//   stream: a band of changing width along a winding centre line
//   coast:  the ocean along one side of the world (recipe "borders"), out to the horizon,
//           with islands cut out of it (recipe "islands")
// The field is sampled on a grid: the mesh is the grid cells near the water and
// each vertex carries its distance to the shore (aShore). The water shader cuts
// the surface where it drops below 0 and paints the depth bands from it.
// Circles laid inside the field hide the grass and stop the player.
import * as THREE from 'three';
import { defineKind } from '../registry.js';
import { nextRandom, between, hashSeed } from '../../lib/random.js';
import { fromSide, wavyLine } from '../borders.js';
import { segmentDistance } from '../ground.js';

export const WATER_Y = 0.004;   // the surface, just over the ground (the reflections mirror y = 0)
const STEP = 0.15;              // grid step of the surface mesh
const MIN_CIRCLE = 0.1;         // circles start this far inside the shore

defineKind({
  name: 'water',
  presets: {
    //        blob radius, blobs, sine harmonics on the edge, how much they wave the edge
    //        (share of the radius), how far extra blobs sit from the others; blocks: stops the player
    pond: { form: 'blobs', radius: [1.6, 2.3], blobs: [1, 2], waves: 4, wobble: [0.1, 0.18], spread: 0.9, blocks: true },
    lake: { form: 'blobs', radius: [2.6, 3.3], blobs: [3, 4], waves: 5, wobble: [0.08, 0.15], spread: 1.15, blocks: true },
    puddle: { form: 'blobs', radius: [0.45, 0.75], blobs: [1, 2], waves: 3, wobble: [0.1, 0.2], spread: 0.8, blocks: false },
    //        length, width, half waves of the bends, how far the bends swing to the side
    stream: { form: 'stream', length: [11, 15], width: [1.7, 2.3], bends: [2, 3], swing: [1.0, 1.6], blocks: true },
    //        side of the world, its half size, how far the ocean reaches in, how much
    //        the shore waves, how far it goes on past the edge, islands (in world coordinates: placed at 0, 0)
    ocean: { form: 'coast', side: 'east', half: 20, width: [5, 8], wobble: [0.6, 1.2], out: 60, islands: [], blocks: true },
  },
  variants: (p) => (p.form === 'coast' ? 1 : 3),
  palettes: { water: 'clear' },
  build(p, rng) {
    if (p.form === 'coast') return coast(p, rng);
    const field = p.form === 'stream' ? stream(p, rng) : blobs(p, rng);
    const { sdf, box } = recentre(field);
    const geometry = surface(sdf, box);
    const circles = coverCircles(sdf, box);
    geometry.computeBoundingSphere();
    return {
      parts: [{ geometry, role: 'water' }],
      height: WATER_Y,
      radius: Math.max(...circles.map(([x, z, r]) => Math.hypot(x, z) + r)),
      circles,
      blocks: p.blocks,
    };
  },
});

// ------------------------------------------------------------------ fields
// -> { sdf(x, z), box: [minX, maxX, minZ, maxZ] }

function blobs(p, rng) {
  const R = between(rng, p.radius);
  const n = Math.round(between(rng, p.blobs));
  const polys = [];
  const centres = [];
  for (let i = 0; i < n; i++) {
    const r = i ? R * (0.55 + 0.3 * nextRandom(rng)) : R;
    let cx = 0, cz = 0;
    if (i) {
      // next to one of the blobs made so far, overlapping it
      const [ox, oz, or] = centres[Math.floor(nextRandom(rng) * centres.length)];
      const a = nextRandom(rng) * Math.PI * 2, d = (or + r) * 0.5 * p.spread * (0.75 + 0.25 * nextRandom(rng));
      cx = ox + Math.cos(a) * d;
      cz = oz + Math.sin(a) * d;
    }
    centres.push([cx, cz, r]);
    // r(t) = r * (1 + sum of a_k cos(k t + phase_k)), k = 2..waves
    const w = between(rng, p.wobble), harm = [];
    for (let k = 2; k <= p.waves; k++) harm.push([k, (w * (0.4 + 0.6 * nextRandom(rng))) / (k - 1), nextRandom(rng) * Math.PI * 2]);
    const poly = [];
    for (let s = 0; s < 96; s++) {
      const t = (s / 96) * Math.PI * 2;
      const rr = r * (1 + harm.reduce((acc, [k, a, ph]) => acc + a * Math.cos(k * t + ph), 0));
      poly.push([cx + Math.cos(t) * rr, cz + Math.sin(t) * rr]);
    }
    polys.push(poly);
  }
  const k = R * 0.45;
  return {
    sdf: (x, z) => polys.reduce((acc, poly) => smoothMax(acc, polyDistance(poly, x, z), k), -Infinity),
    box: boxOf(polys.flat(), k * 0.25),     // the smooth union grows the shape by up to k / 4
  };
}

function stream(p, rng) {
  const L = between(rng, p.length), W = between(rng, p.width);
  const bends = between(rng, p.bends), swing = between(rng, p.swing);
  const ph = [0, 0, 0].map(() => nextRandom(rng) * Math.PI * 2);
  const n = Math.ceil(L / 0.25);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = swing * (Math.sin(Math.PI * bends * t + ph[0]) + 0.3 * Math.sin(Math.PI * bends * 2.3 * t + ph[1]));
    // half width: wavy, a little narrower at the two ends
    const ends = 0.65 + 0.35 * Math.min(1, t / 0.15, (1 - t) / 0.15);
    pts.push([(t - 0.5) * L, z, (W / 2) * (0.85 + 0.2 * Math.sin(7 * t + ph[2])) * ends]);
  }
  return {
    sdf(x, z) {
      let best = -Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az, aw] = pts[i - 1], [bx, bz, bw] = pts[i];
        const ex = bx - ax, ez = bz - az;
        const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
        best = Math.max(best, aw + (bw - aw) * t - Math.hypot(x - ax - ex * t, z - az - ez * t));
      }
      return best;
    },
    box: boxOf(pts.map(([x, z, w]) => [x, z]), W),
  };
}

// the ocean: in from the side as far as a wavy line. The mesh is fine near the
// shore and coarse out at sea; circles only where something can walk (the
// world). It is placed at `origin`, out at sea past the middle of its side
// (where the ground is flat); shore(x, z): the field in world coordinates
function coast(p, rng) {
  const line = wavyLine(rng, p.width, p.wobble);
  const islands = p.islands.map(island);
  const sdf = (x, z) => {
    const [e, along] = fromSide(p.side, p.half, x, z);
    return islands.reduce((d, f) => Math.min(d, -f(x, z)), line(along) - e);
  };
  const top = (v) => (Array.isArray(v) ? v[1] : v);
  const inner = p.half - top(p.width) - 2 * top(p.wobble) - 1, far = p.half + p.out;
  const box = { east: [inner, far, -far, far], west: [-far, -inner, -far, far],
    south: [-far, far, inner, far], north: [-far, far, -far, -inner] }[p.side];
  const d = p.half + 10;
  const [ox, oz] = { east: [d, 0], west: [-d, 0], south: [0, d], north: [0, -d] }[p.side];
  const local = (x, z) => sdf(x + ox, z + oz);
  const shift = ([x0, x1, z0, z1]) => [x0 - ox, x1 - ox, z0 - oz, z1 - oz];
  const geometry = surface(local, shift(box), 1.5);
  geometry.computeBoundingSphere();
  const reach = p.half + 6;
  const circles = coverCircles(local, shift([Math.max(box[0], -reach), Math.min(box[1], reach), Math.max(box[2], -reach), Math.min(box[3], reach)]));
  return { parts: [{ geometry, role: 'water' }], height: WATER_Y, radius: p.half * Math.SQRT2, circles, blocks: p.blocks,
    turns: false, shore: sdf, origin: [ox, oz] };
}

// an island (recipe "islands": { at, radius, bar, barWidth }): a round blob, its
// edge waved by sine harmonics, and a sand bar out to `bar`. The waves come
// from its place, so every ocean that holds it cuts the same island.
// -> field(x, z), positive on the island
function island({ at: [cx, cz], radius, bar, barWidth }) {
  const rng = { seed: hashSeed('island', cx, cz) };
  const harm = [2, 3, 5].map((k) => [k, (0.1 + 0.08 * nextRandom(rng)) / (k - 1), nextRandom(rng) * Math.PI * 2]);
  return (x, z) => {
    const t = Math.atan2(z - cz, x - cx);
    const r = radius * (1 + harm.reduce((acc, [k, a, ph]) => acc + a * Math.cos(k * t + ph), 0));
    const d = r - Math.hypot(x - cx, z - cz);
    return bar ? smoothMax(d, barWidth / 2 - segmentDistance([cx, cz], bar, x, z), 1.5) : d;
  };
}

// move the field so its box is centred on the origin (the spot it is placed on)
function recentre({ sdf, box }) {
  const cx = (box[0] + box[1]) / 2, cz = (box[2] + box[3]) / 2;
  return { sdf: (x, z) => sdf(x + cx, z + cz), box: [box[0] - cx, box[1] - cx, box[2] - cz, box[3] - cz] };
}

// ------------------------------------------------------------------ mesh + circles

// the grid cells near the water, each vertex with its distance to the shore;
// deep: further in than this, big coarse quads instead (all deep water)
function surface(sdf, [x0, x1, z0, z1], deep = Infinity) {
  const nx = Math.ceil((x1 - x0) / STEP) + 3, nz = Math.ceil((z1 - z0) / STEP) + 3;
  const ox = x0 - STEP, oz = z0 - STEP;
  const val = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) val[j * nx + i] = sdf(ox + i * STEP, oz + j * STEP);
  const index = new Int32Array(nx * nz).fill(-1);
  const pos = [], shore = [], tris = [];
  const vert = (i, j) => {
    const k = j * nx + i;
    if (index[k] < 0) {
      index[k] = pos.length / 3;
      pos.push(ox + i * STEP, WATER_Y, oz + j * STEP);
      shore.push(val[k]);
    }
    return index[k];
  };
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      if (Math.max(val[k], val[k + 1], val[k + nx], val[k + nx + 1]) <= 0) continue;
      // well inside the coarse quads (the field changes about 1 per unit)
      if (Math.min(val[k], val[k + 1], val[k + nx], val[k + nx + 1]) > deep + 3.5) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      tris.push(a, c, b, b, c, d);     // facing up
    }
  if (deep < Infinity) {
    const C = 2;
    for (let z = z0; z < z1; z += C)
      for (let x = x0; x < x1; x += C) {
        const q = [[x, z], [x + C, z], [x, z + C], [x + C, z + C]];
        const s = q.map(([qx, qz]) => sdf(qx, qz));
        if (Math.min(...s) <= deep) continue;
        const at = pos.length / 3;
        q.forEach(([qx, qz], n) => { pos.push(qx, WATER_Y, qz); shore.push(s[n]); });
        tris.push(at, at + 2, at + 1, at + 1, at + 2, at + 3);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  g.setIndex(tris);
  return g;
}

// circles inside the water, biggest first, until every grid point deeper than
// MIN_CIRCLE is inside one: [[x, z, r]], r = distance to the shore
function coverCircles(sdf, [x0, x1, z0, z1]) {
  const pts = [];
  for (let z = z0; z <= z1; z += STEP)
    for (let x = x0; x <= x1; x += STEP) {
      const d = sdf(x, z);
      if (d > MIN_CIRCLE) pts.push([x, z, d]);
    }
  pts.sort((a, b) => b[2] - a[2]);
  const out = [];
  for (const [x, z, d] of pts)
    if (!out.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) out.push([x, z, d]);
  return out;
}

// ------------------------------------------------------------------ math

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// distance to a closed outline, positive inside
function polyDistance(poly, x, z) {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    d = Math.min(d, Math.hypot(wx - ex * t, wz - ez * t));
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * ex) / ez) inside = !inside;
  }
  return inside ? d : -d;
}

// union of two fields (positive inside) with a round seam of size k
function smoothMax(a, b, k) {
  if (a === -Infinity) return b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

function boxOf(pts, pad = 0) {
  const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
  return [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
}
