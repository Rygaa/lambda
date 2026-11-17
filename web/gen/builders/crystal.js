// Crystals (rock/crystal): a cluster of six-sided columns with pointed tips, leaning out from the middle, the tallest
// in the middle, standing on a small stone. One palette of the stone family colours all of it (bright, so it shines
// in a dark cave). count: how many columns; height: of the tallest; radius: of a column; lean: how far they lean out.
import { defineBuilder } from '../registry.js';
import { between, nextRandom } from '../../lib/random.js';
import { tube, clean } from '../solids.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';

defineBuilder({
  name: 'crystal',
  build(p, rng) {
    const n = Math.round(between(rng, p.count)), H = between(rng, p.height), pieces = [];
    let reach = 0;
    for (let k = 0; k < n; k++) {
      const first = k === 0, a = (k / n) * Math.PI * 2 + nextRandom(rng) * 0.8, lean = first ? 0.05 : between(rng, p.lean);
      const h = first ? H : H * (0.4 + 0.45 * nextRandom(rng)), r = between(rng, p.radius) * (first ? 1.2 : 1);
      const base = [first ? 0 : Math.cos(a) * r * 1.4, -0.04, first ? 0 : Math.sin(a) * r * 1.4];
      const dir = new THREE.Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
      const body = base.map((v, i) => v + dir.getComponent(i) * h * 0.8), tip = base.map((v, i) => v + dir.getComponent(i) * h);
      pieces.push(tube(base, body, r, r, 6), tube(body, tip, r, 0.001, 6));
      reach = Math.max(reach, Math.hypot(tip[0], tip[2]) + r);
    }
    pieces.push(clean(new THREE.IcosahedronGeometry(reach * 0.55, 0).scale(1, 0.35, 1)));
    return { parts: [{ geometry: mergeGeometries(pieces), role: 'stone' }], height: H, radius: Math.max(0.15, reach * 0.8) };
  },
});
