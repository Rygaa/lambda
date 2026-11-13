// A small wooden boat: an open hull of planks, pointed at the bow (+x) and cut
// square at the stern, its rim rising to the bow, a white band under the rim,
// seats across it and two oars.
// The hull is made of stations along x, each one a cross-section (rim, bottom),
// joined by flat faces seen from both sides (an open hull shows its inside).
//   length (x), width (z), depth: rim height at the middle, sheer: how much the
//   rim rises at the bow, seats: how many seats
import { defineBuilder } from '../registry.js';
import { box, tube, sheet, partsOf } from '../solids.js';

const STATIONS = 14;
const WALL = 0.045;     // plank thickness

defineBuilder({
  name: 'boat',
  build(p) {
    const L = p.length, hw = p.width / 2, D = p.depth;
    const outer = [], inner = [], rim = [], band = [], seats = [];
    // the cross-section at t (0: stern, 1: bow): x, rim height, bottom height, half widths at the rim and the bottom
    const at = (t) => {
      const f = t < 0.45 ? 0.72 + 0.28 * Math.sin((t / 0.45) * Math.PI / 2) : Math.cos(((t - 0.45) / 0.55) * Math.PI / 2) ** 0.8;
      const top = D + p.sheer * t ** 3 + 0.04 * (1 - t) ** 3;
      const lift = Math.max(0, (t - 0.65) / 0.35);
      return { x: -L / 2 + t * L, top, bot: 0.02 + lift * lift * D * 0.85, w: hw * f, b: hw * f * 0.45 };
    };
    const S = Array.from({ length: STATIONS + 1 }, (_, i) => at(i / STATIONS));
    // a point down the side of a station: s = 0 at the rim, 1 at the bottom; side = 1 (+z) or -1; inset: inward
    const side = (st, s, sgn, inset = 0) => {
      const w = Math.max(0, st.w + (st.b - st.w) * s - inset);
      return [st.x, st.top + (st.bot - st.top) * s + (s === 1 ? inset : 0), sgn * w];
    };
    const quad = (out, a, b, c, d) => { out.push([a, b, c], [a, c, d]); };
    for (let i = 0; i < STATIONS; i++) {
      const a = S[i], c = S[i + 1];
      for (const sgn of [1, -1]) {
        quad(outer, side(a, 0, sgn), side(c, 0, sgn), side(c, 1, sgn), side(a, 1, sgn));
        quad(inner, side(a, 0, sgn, WALL), side(c, 0, sgn, WALL), side(c, 1, sgn, WALL), side(a, 1, sgn, WALL));
        quad(rim, side(a, 0, sgn), side(c, 0, sgn), side(c, 0, sgn, WALL), side(a, 0, sgn, WALL));
        // the white band just under the rim, a little out from the planks
        const out = (q) => [q[0], q[1], q[2] + sgn * 0.006];
        quad(band, out(side(a, 0.16, sgn)), out(side(c, 0.16, sgn)), out(side(c, 0.3, sgn)), out(side(a, 0.3, sgn)));
      }
      quad(outer, side(a, 1, 1), side(c, 1, 1), side(c, 1, -1), side(a, 1, -1));
      quad(inner, side(a, 1, 1, WALL), side(c, 1, 1, WALL), side(c, 1, -1, WALL), side(a, 1, -1, WALL));
    }
    // the stern board and its top
    const s0 = S[0];
    quad(outer, side(s0, 0, 1), side(s0, 1, 1), side(s0, 1, -1), side(s0, 0, -1));
    quad(rim, side(s0, 0, 1), side(s0, 0, -1), side(s0, 0, -1, WALL), side(s0, 0, 1, WALL));

    // seats across the hull, a little under the rim
    const seatAt = Array.from({ length: p.seats }, (_, k) => 0.2 + (0.5 * (k + 0.5)) / p.seats);
    for (const t of seatAt) {
      const st = at(t), y = st.top - 0.12;
      seats.push(box(0.2, 0.04, 2 * (st.w + (st.b - st.w) * 0.35) - 2 * WALL, st.x, y, 0));
    }
    // two oars resting on the seats, their blades to the stern
    for (const sgn of [1, -1]) {
      const st = at(0.45), y = st.top - 0.08, z = sgn * (st.w - 0.16);
      seats.push(tube([st.x + L * 0.28, y, z], [st.x - L * 0.3, y, z * 0.8], 0.022, 0.022, 5));
      seats.push(box(0.32, 0.02, 0.1, st.x - L * 0.3 - 0.12, y, z * 0.8));
    }
    const pieces = { wood: [sheet(outer), sheet(rim), ...seats], 'wood-dark': [sheet(inner)], plaster: [sheet(band)] };
    return {
      parts: partsOf(pieces),
      height: Math.max(...S.map((st) => st.top)),
      radius: L / 2 + 0.1,
    };
  },
});
