// The things of a mine (building/mine-frame, rails, minecart, crates, torch), made with math. They turn (the recipe
// "at": [x, z, turn]): what runs along a tunnel (a frame, the rails, a cart) runs along its local z, so its turn is
// atan2(dx, dz) of the tunnel. They stop walkers by simple colliders (circles under the posts, the torch, the crates,
// the cart: lib/parts.js), not by their real shape, so a walker slides along them; the rails stop nobody, and one walks
// under the beam of a frame.
//   kind: frame | rails | cart | crates | torch
//   frame: width (between the posts), height (under the beam); rails: length; crates: count (1 to 3)
import { defineBuilder } from '../registry.js';
import { between, nextRandom } from '../../lib/random.js';
import { box, tube, ball, partsOf } from '../solids.js';

const KINDS = {
  // two posts, a beam across, two braces, and a lantern hanging from the middle of the beam (in front of it)
  frame(p, out) {
    const W = p.width, H = p.height, x = W / 2;
    for (const s of [1, -1]) {
      out.wood.push(box(0.2, H, 0.2, s * x, H / 2, 0));
      out['wood-dark'].push(tube([s * (x - 0.08), H - 0.5, 0], [s * (x - 0.55), H - 0.02, 0], 0.045, 0.045, 5));
    }
    out.wood.push(box(W + 0.4, 0.22, 0.24, 0, H + 0.11, 0));
    out.black.push(tube([0, H, 0.15], [0, H - 0.2, 0.15], 0.012, 0.012, 4), box(0.2, 0.05, 0.2, 0, H - 0.22, 0.15), box(0.2, 0.04, 0.2, 0, H - 0.48, 0.15));
    out.flame.push(box(0.15, 0.22, 0.15, 0, H - 0.35, 0.15));
    return { height: H + 0.22, radius: x + 0.2, colliders: [[x, 0, 0.16], [-x, 0, 0.16]] };
  },
  // two steel rails on wooden sleepers, `length` long
  rails(p, out) {
    const L = p.length, n = Math.round(L / 0.4);
    for (let k = 0; k < n; k++) out['wood-dark'].push(box(0.9, 0.04, 0.14, 0, 0.02, -L / 2 + (k + 0.5) * (L / n)));
    for (const s of [1, -1]) out.steel.push(box(0.05, 0.05, L, s * 0.3, 0.065, 0));
    return { height: 0.09, radius: L / 2, colliders: [] };
  },
  // a wooden tub with iron bands on four black wheels, full of ore and crystals
  cart(p, out, rng) {
    out.black.push(box(0.6, 0.06, 0.8, 0, 0.16, 0));
    for (const sx of [1, -1]) for (const sz of [1, -1]) out.black.push(tube([sx * 0.3, 0.13, sz * 0.28], [sx * 0.37, 0.13, sz * 0.28], 0.12, 0.12, 8));
    out.wood.push(box(0.72, 0.42, 0.98, 0, 0.4, 0));
    for (const z of [-0.36, 0.36]) out.steel.push(box(0.76, 0.44, 0.06, 0, 0.4, z));
    out.steel.push(box(0.76, 0.05, 1.02, 0, 0.62, 0));
    for (let k = 0; k < 5; k++) out.dark.push(ball(0.13 + 0.05 * nextRandom(rng), (nextRandom(rng) - 0.5) * 0.4, 0.62, (nextRandom(rng) - 0.5) * 0.6));
    for (let k = 0; k < 3; k++) {
      const x = (nextRandom(rng) - 0.5) * 0.35, z = (nextRandom(rng) - 0.5) * 0.5;
      out['crystal-cyan'].push(tube([x, 0.6, z], [x + (nextRandom(rng) - 0.5) * 0.15, 0.95, z], 0.06, 0.001, 6));
    }
    return { height: 0.95, radius: 0.6, colliders: [[0, 0.25, 0.38], [0, -0.25, 0.38]] };
  },
  // crates (planks: a lighter box with darker edges) and a barrel with black hoops
  crates(p, out, rng) {
    const spots = [[-0.35, 0, 0], [0.32, 0, 0.1], [-0.05, 0.56, 0.02]].slice(0, Math.round(between(rng, p.count)));
    for (const [x, y, z] of spots) {
      const s = 0.52 + 0.06 * nextRandom(rng);
      out.wood.push(box(s, s, s, x, y + s / 2, z));
      for (const e of [-1, 1]) {
        out['wood-dark'].push(box(s + 0.02, 0.07, 0.07, x, y + s / 2 + e * (s / 2 - 0.035), z + s / 2 - 0.03));
        out['wood-dark'].push(box(0.07, s + 0.02, 0.07, x + e * (s / 2 - 0.035), y + s / 2, z + s / 2 - 0.03));
      }
    }
    const colliders = spots.filter(([, y]) => y === 0).map(([x, , z]) => [x, z, 0.34]);
    const bx = 0.75, bz = -0.25;
    colliders.push([bx, bz, 0.26]);
    out['wood-dark'].push(tube([bx, 0, bz], [bx, 0.66, bz], 0.24, 0.24, 8));
    for (const y of [0.12, 0.54]) out.black.push(tube([bx, y, bz], [bx, y + 0.05, bz], 0.25, 0.25, 8));
    return { height: 1.1, radius: 1.05, colliders };
  },
  // a torch on a post: a pole, an iron cup and a flame
  torch(p, out) {
    out['wood-dark'].push(tube([0, 0, 0], [0, 0.85, 0], 0.05, 0.04, 5));
    out.black.push(tube([0, 0.82, 0], [0, 0.95, 0], 0.05, 0.1, 6));
    out.flame.push(tube([0, 0.95, 0], [0, 1.12, 0], 0.09, 0.07, 6), tube([0, 1.12, 0], [0, 1.3, 0], 0.07, 0.001, 6));
    return { height: 1.3, radius: 0.2, colliders: [[0, 0, 0.1]] };
  },
};

defineBuilder({
  name: 'mine',
  build(p, rng) {
    const make = KINDS[p.kind];
    if (!make) throw new Error(`mine: kind "${p.kind}" (use ${Object.keys(KINDS).join(', ')})`);
    const out = { wood: [], 'wood-dark': [], black: [], steel: [], dark: [], flame: [], 'crystal-cyan': [] };
    const { height, radius, colliders } = make(p, out, rng);
    return { parts: partsOf(out), height, radius, colliders };
  },
});
