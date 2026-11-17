// Palm trees (plant/palm): a ringed trunk of flat faces with outlines (gen/solids.js) that
// bends as it rises, a few coconuts, and a crown of drooping fronds made like
// the tree canopies: a thin folded leaf (canopy material) covered in leaf
// clumps (sprites lit by the leaf's normal, lib/sprites.js).
import { defineBuilder } from '../registry.js';
import { between, nextRandom } from '../../lib/random.js';
import { spriteGeometry } from '../../lib/sprites.js';
import { tube, ball, sheet, partsOf } from '../solids.js';

defineBuilder({
  name: 'palm',
  build(p, rng, ctx) {
    const H = between(rng, p.height), lean = between(rng, p.lean), turn = nextRandom(rng) * Math.PI * 2;
    // the trunk bends more near the top: out = lean * t^2
    const at = (t) => [Math.cos(turn) * lean * t * t, H * t, Math.sin(turn) * lean * t * t];
    const trunk = [];
    for (let i = 0; i < p.rings; i++) {
      const t0 = i / p.rings, t1 = (i + 1) / p.rings;
      const r = (t) => p.r1 + (p.r2 - p.r1) * t;
      // each ring is wider at its foot, so the rings show
      trunk.push(tube(at(t0), at(t1), r(t0) * 1.2, r(t1) * 0.9));
    }
    const top = at(1);
    const nuts = [0, 1, 2].map((k) => {
      const a = turn + k * 2.1;
      return ball(0.1, top[0] + Math.cos(a) * 0.14, top[1] - 0.12, top[2] + Math.sin(a) * 0.14);
    });
    const tris = [], clumps = [];
    const n = Math.round(between(rng, p.fronds));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (nextRandom(rng) - 0.5) * 0.6;
      frond(tris, clumps, [top[0], top[1] + 0.06, top[2]], a, between(rng, p.length), between(rng, p.droop), nextRandom(rng), rng);
    }
    // each clump: atlas cell, material, N.L of its leaf, a random value (like leafGeometry)
    const pos = new Float32Array(clumps.length * 3), par = new Float32Array(clumps.length * 4);
    clumps.forEach(([x, y, z, [nx, ny, nz]], i) => {
      pos.set([x, y, z], i * 3);
      par.set([Math.floor(nextRandom(rng) * 4), ctx.mid.canopy, nx * ctx.sunL.x + ny * ctx.sunL.y + nz * ctx.sunL.z, nextRandom(rng)], i * 4);
    });
    return {
      parts: [
        ...partsOf({ palm: trunk, wood: nuts }),
        { geometry: sheet(tris), role: 'canopy' },
        { geometry: spriteGeometry(pos, pos, par), role: 'leaves' },
      ],
      height: top[1] + 0.4,
      radius: p.r1 + 0.15,
      blocker: { r: p.r1 + 0.1, h: top[1] },
      turns: false,            // the leaves are lit in place
    };
  },
});

// one frond from `base` out along angle a: L long, its tip dropping `droop` * L / 2,
// widest a third of the way out; its two halves fold down from the middle rib.
// Adds its triangles to tris and its leaf clumps [x, y, z, normal] to clumps.
function frond(tris, clumps, [bx, by, bz], a, L, droop, lift, rng) {
  const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
  const rib = (s) => [bx + dx * L * s, by + L * ((0.3 + 0.15 * lift) * s - droop * 0.5 * s * s), bz + dz * L * s];
  const width = (s) => 0.34 * Math.sin(Math.PI * Math.min(1, s * 1.3)) * (1 - 0.3 * s);
  const edge = (s, side) => {
    const [x, y, z] = rib(s), w = width(s);
    return [x + sx * w * side, y - w * 0.5, z + sz * w * side];
  };
  const N = 6;
  for (let i = 0; i < N; i++) {
    const s0 = i / N, s1 = (i + 1) / N;
    for (const side of [-1, 1]) {
      tris.push([rib(s0), edge(s0, side), edge(s1, side)]);
      tris.push([rib(s0), edge(s1, side), rib(s1)]);
    }
  }
  // clumps along the frond, one to three across, on its upper side
  for (let s = 0.12; s <= 1.0; s += 0.11) {
    const [x, y, z] = rib(s), [x2, y2, z2] = rib(s + 0.01);
    const t = norm([x2 - x, y2 - y, z2 - z]);
    const w = width(s);
    const across = w > 0.2 ? [-0.6, 0, 0.6] : w > 0.1 ? [-0.4, 0.4] : [0];
    for (const f of across) {
      const side = f < 0 ? -1 : 1;
      // the leaf's normal: up from the rib, tilted out over the half it is on
      const up = norm(cross([sx, 0, sz], t));
      const nrm = norm([up[0] + sx * side * Math.abs(f) * 0.8, up[1], up[2] + sz * side * Math.abs(f) * 0.8]);
      const j = (nextRandom(rng) - 0.5) * 0.04;
      clumps.push([x + sx * w * f + j, y - w * Math.abs(f) * 0.5 + 0.06, z + sz * w * f - j, nrm]);
    }
  }
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
