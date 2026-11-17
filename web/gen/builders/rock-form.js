// Rock forms (rock/slab, rock/stack, rock/cluster, rock/split): one or a few stones with flat faces, each the hull
// of random points like rock/sharp, put together in a form (FORMS). Every variant is drawn
// again, so no two are the same.
// form: the name in FORMS; size: [width, height, depth] of the whole form; scale: [lo, hi];
// sink: how far it goes into the ground.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { defineBuilder } from '../registry.js';
import { nextRandom, between } from '../../lib/random.js';
import { gauss, fit, settle } from './sharp-rock.js';

defineBuilder({
  name: 'rock-form',
  build(p, rng) {
    const form = FORMS[p.form];
    if (!form) throw new Error(`rock-form: unknown form "${p.form}" (known: ${Object.keys(FORMS).join(', ')})`);
    const k = between(rng, p.scale), [W, H, D] = p.size.map((v) => v * k);
    const r = (lo, hi) => lo + (hi - lo) * nextRandom(rng);
    const stones = form({ W, H, D, r, rng });
    return settle(mergeGeometries(stones), p.sink);
  },
});

// a stone: the hull of n random points, fitted to [w, h, d], turned, leaned, moved to [x, y, z] (its bottom centre)
function stone(rng, [w, h, d], [x, y, z] = [0, 0, 0], { n = 10, turn = nextRandom(rng) * Math.PI * 2, lean = 0, pts } = {}) {
  pts ??= Array.from({ length: n }, () => new THREE.Vector3(gauss(rng), gauss(rng), gauss(rng)).normalize().multiplyScalar(0.7 + 0.3 * nextRandom(rng)));
  const g = fit(new ConvexGeometry(pts), new THREE.Vector3(w, h, d));
  g.translate(0, h / 2, 0);
  g.rotateX((nextRandom(rng) * 2 - 1) * lean);
  g.rotateZ((nextRandom(rng) * 2 - 1) * lean);
  g.rotateY(turn);
  g.translate(x, y, z);
  return g;
}

// points for a stone with a flat top and a flat bottom: two rings of n random corners
const flat = (rng, n = 7) => [-1, 1].flatMap((y) => Array.from({ length: n }, () => {
  const a = nextRandom(rng) * Math.PI * 2, k = (y > 0 ? 0.8 : 1) * (0.85 + 0.15 * nextRandom(rng));
  return new THREE.Vector3(Math.cos(a) * k, y, Math.sin(a) * k);
}));

const FORMS = {
  // one flat, wide stone
  slab: ({ W, H, D, r, rng }) => [stone(rng, [W * r(0.85, 1), H * r(0.8, 1), D * r(0.85, 1)], [0, 0, 0], { pts: flat(rng, 8), lean: 0.06 })],

  // 2 or 3 flat stones piled up, each smaller, a little off centre
  stack: ({ W, H, D, r, rng }) => {
    const n = nextRandom(rng) < 0.5 ? 2 : 3, out = [];
    let y = 0;
    for (let i = 0; i < n; i++) {
      const s = 1 - 0.28 * i, h = (H / n) * r(0.85, 1.1);
      out.push(stone(rng, [W * s, h, D * s], [r(-0.08, 0.08) * W, y, r(-0.08, 0.08) * D], { pts: flat(rng, 6), lean: 0.08 }));
      y += h * 0.82;
    }
    return out;
  },

  // one stone with 2 or 3 smaller ones at its foot
  cluster: ({ W, H, D, r, rng }) => {
    const out = [stone(rng, [W * 0.62, H, D * 0.62], [0, 0, 0], { n: 11 })];
    const n = nextRandom(rng) < 0.5 ? 2 : 3, turn = r(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * Math.PI * 2 + r(-0.4, 0.4), s = r(0.3, 0.45);
      out.push(stone(rng, [W * s, H * s * r(0.7, 1), D * s], [Math.cos(a) * W * 0.5, 0, Math.sin(a) * D * 0.5], { n: 9 }));
    }
    return out;
  },

  // one round stone split in two halves, with a gap between them
  split: ({ W, H, D, r, rng }) => {
    const pts = Array.from({ length: 14 }, () => new THREE.Vector3(gauss(rng), gauss(rng), gauss(rng)).normalize().multiplyScalar(0.8 + 0.2 * nextRandom(rng)));
    const cut = pts.map((q) => new THREE.Vector3(0, q.y * 0.9, q.z * 0.9)), turn = r(0, Math.PI * 2), gap = W * r(0.06, 0.1);
    return [-1, 1].map((side) => {
      const half = pts.filter((q) => q.x * side > 0).concat(cut);
      const g = fit(new ConvexGeometry(half), new THREE.Vector3(W / 2, H, D));
      g.translate(side * (W / 4 + gap / 2), H / 2, 0);
      g.rotateZ(-side * r(0.04, 0.1));
      g.rotateY(turn);
      return g;
    });
  },
};
