// Big-leaf plants (plant/leafy): the 3 leafy plants of FlyFF (obj_macoprgr04, 05, 06), one per variant, with their
// stems and their leaves at the same places (params.models, made by assets/plant/leafy/import-leafy.mjs, in FlyFF
// units from the place of the model, so a turn of the FlyFF map turns it the same way). Made in our style, green like
// the FlyFF ones: the stems are tubes of flat faces and each leaf is a thin sheet with its rib a little raised, so its
// two halves catch the light apart, all lit like our leaves (canopy material). You walk through it.
import { defineBuilder } from '../registry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tube, sheet } from '../solids.js';
import { FLYFF } from '../map.js';

const FOLD = 0.25;     // how high the rib of a leaf is raised, for its half width

defineBuilder({
  name: 'leafy',
  build(p, rng, ctx, i) {
    const { stems, leaves } = p.models[i % p.models.length], k = FLYFF * p.scale[0];
    const at = ([x, y, z]) => [x * k, y * k, z * k];
    const tubes = [];
    for (const stem of stems)
      for (let j = 0; j + 1 < stem.length; j++) tubes.push(tube(at(stem[j]), at(stem[j + 1]), stem[j][3] * k, stem[j + 1][3] * k));
    const tris = [];
    let top = 0, reach = 0;
    for (const rows of leaves) {
      const pts = rows.map((r) => [at(r.slice(0, 3)), at(r.slice(3, 6)), at(r.slice(6, 9))]);
      pts.forEach(([rib, a, b], j) => {
        // raise the rib off the sheet, up from it
        const along = sub(pts[Math.min(j + 1, pts.length - 1)][0], pts[Math.max(j - 1, 0)][0]);
        let n = cross(sub(b, a), along);
        if (n[1] < 0) n = n.map((v) => -v);
        const len = Math.hypot(...n), half = Math.hypot(...sub(b, a)) / 2;
        if (len > 1e-9) for (let c = 0; c < 3; c++) rib[c] += (n[c] / len) * half * FOLD;
        for (const q of [rib, a, b]) { top = Math.max(top, q[1]); reach = Math.max(reach, Math.hypot(q[0], q[2])); }
      });
      for (let j = 0; j + 1 < pts.length; j++) {
        const [r0, a0, b0] = pts[j], [r1, a1, b1] = pts[j + 1];
        tris.push([r0, a0, a1], [r0, a1, r1], [r0, b1, b0], [r0, r1, b1]);
      }
    }
    return {
      parts: [{ geometry: mergeGeometries([...tubes, sheet(tris)]), role: 'canopy' }],
      height: top + 0.05,
      radius: reach * 0.6,
      blocker: { r: 0.1, h: top },
      blocks: false,
    };
  },
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
