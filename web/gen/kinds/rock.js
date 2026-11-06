// Rocks: the convex hull of a few random points on a squashed sphere, set on
// the ground (port of blender/pipeline/geometry.py rock). Flat faces, outlined
// like the Blender stones. Values in [lo, hi] are drawn per variant.
// width, depth, height: the size of the rock before it sinks into the ground.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { defineKind } from '../registry.js';
import { nextRandom, between } from '../../lib/random.js';

defineKind({
  name: 'rock',
  presets: {
    //        width (x), depth (z), height (y), corner points, sunk into the ground, lean (radians)
    pebble: { width: [0.3, 0.5], depth: [0.26, 0.44], height: [0.14, 0.28], points: 8, sink: [0.03, 0.05], lean: 0 },
    stone: { width: [0.65, 0.95], depth: [0.6, 0.85], height: [0.8, 1.2], points: [9, 11], sink: 0.12, lean: 0.08 },
    crag: { width: [1.2, 1.5], depth: [1.0, 1.3], height: [1.0, 1.5], points: 12, sink: 0.12, lean: 0 },
  },
  variants: 6,
  palettes: { stone: 'grey' },
  build(p, rng) {
    const size = new THREE.Vector3(between(rng, p.width), between(rng, p.height), between(rng, p.depth));
    const n = Math.round(between(rng, p.points));
    const pts = [];
    for (let i = 0; i < n; i++) {
      // a random direction (normal distribution: even over the sphere), a little inside it
      pts.push(new THREE.Vector3(gauss(rng), gauss(rng), gauss(rng)).normalize().multiplyScalar(0.7 + 0.3 * nextRandom(rng)));
    }
    const g = fit(new ConvexGeometry(pts), size);
    g.rotateX(between(rng, [-p.lean, p.lean]));
    g.rotateZ(between(rng, [-p.lean, p.lean]));
    return settle(g, between(rng, p.sink));
  },
});

// standard normal random number (Box-Muller)
export const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - nextRandom(rng))) * Math.cos(2 * Math.PI * nextRandom(rng));

// scale a geometry so its box is exactly `size` (width, height, depth), centred
export function fit(g, size) {
  g.computeBoundingBox();
  const box = g.boundingBox, c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.scale(size.x / s.x, size.y / s.y, size.z / s.z);
  return g;
}

// put a stone shape on the ground, `sink` below it -> Shape
export function settle(g, sink) {
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y - sink, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const pos = g.attributes.position;
  let r = 0;
  // widest part above the ground
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > -0.02) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  return { parts: [{ geometry: g, role: 'stone' }], height: g.boundingBox.max.y, radius: r * 0.85 };
}
