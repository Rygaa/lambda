// Boulders: a subdivided cube pushed out towards a sphere, a little bumpy,
// half sunk into the ground (port of blender/pipeline/geometry.py boulder).
// width, depth, height: the size of the whole ball, before it sinks.
import * as THREE from 'three';
import { defineKind } from '../registry.js';
import { between, hashSeed, nextRandom } from '../../lib/random.js';
import { settle, fit } from './rock.js';

defineKind({
  name: 'boulder',
  presets: {
    big: { width: [2.0, 2.9], depth: [1.7, 2.3], height: [1.5, 1.9], cuts: [2, 3], bump: 0.06, sink: 0.3 },
    small: { width: [1.1, 1.5], depth: [0.9, 1.3], height: [0.8, 1.1], cuts: 2, bump: 0.08, sink: 0.12 },
  },
  variants: 4,
  palettes: { stone: 'grey' },
  build(p, rng) {
    const size = new THREE.Vector3(between(rng, p.width), between(rng, p.height), between(rng, p.depth));
    const cuts = Math.round(between(rng, p.cuts)) + 1;
    const g = new THREE.BoxGeometry(2, 2, 2, cuts, cuts, cuts).toNonIndexed();
    const pos = g.attributes.position, v = new THREE.Vector3(), salt = nextRandom(rng);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // the same corner of two faces gets the same bump (seeded by its place), so no cracks
      const bump = 1 + p.bump * (2 * nextRandom({ seed: hashSeed(salt, v.x.toFixed(3), v.y.toFixed(3), v.z.toFixed(3)) }) - 1);
      v.lerp(v.clone().normalize().multiplyScalar(1.25), 0.75).multiplyScalar(bump);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    fit(g, size).computeVertexNormals();
    // about half of the lower part goes under the ground, like the Blender boulders
    return settle(g, size.y / 2 * 0.45 + p.sink);
  },
});
