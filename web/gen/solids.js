// Flat-faced building blocks for made-up objects (houses, palms): each one a
// non-indexed geometry with face normals (position + normal only), so pieces
// of one colour can be merged into one part.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// any geometry -> non-indexed, position only, with face normals
export const clean = (g) => {
  g = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.computeVertexNormals();
  return g;
};

// a box of size w (x), h (y), d (z), its centre at (x, y, z)
export const box = (w, h, d, x = 0, y = 0, z = 0) => clean(new THREE.BoxGeometry(w, h, d).translate(x, y, z));

// a closed outline [[x, y], ...] in the x-y plane (counter-clockwise), pushed out along z from z0 to z1
export function prism(outline, z0, z1) {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const n = outline.length;
  for (let i = 1; i < n - 1; i++) {
    const [a, b, c] = [outline[0], outline[i], outline[i + 1]];
    tri([...a, z1], [...b, z1], [...c, z1]);     // front (+z)
    tri([...a, z0], [...c, z0], [...b, z0]);     // back
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = outline[i], [bx, by] = outline[(i + 1) % n];
    tri([ax, ay, z0], [bx, by, z0], [bx, by, z1]);
    tri([ax, ay, z0], [bx, by, z1], [ax, ay, z1]);
  }
  return clean(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)));
}

// a board w long, t thick and d deep, its long side tilted up by `angle` (around
// z), its top face centred at (x, y, z)
export function plank(w, t, d, angle, x, y, z) {
  const g = new THREE.BoxGeometry(w, t, d).translate(0, -t / 2, 0).rotateZ(angle).translate(x, y, z);
  return clean(g);
}

// a tube with `sides` sides from point a to point b, radius ra at a and rb at b
export function tube(a, b, ra, rb, sides = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(rb, ra, dir.length(), sides).translate(0, dir.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return clean(g.translate(A.x, A.y, A.z));
}

// a small ball (20 flat faces)
export const ball = (r, x, y, z) => clean(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z));

// triangles [[a, b, c], ...] seen from both sides
export function sheet(tris) {
  const pos = [];
  for (const [a, b, c] of tris) pos.push(...a, ...b, ...c, ...a, ...c, ...b);
  return clean(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)));
}

// { palette: [geometry, ...] } -> shape parts (one per palette, role stone)
export const partsOf = (pieces) => Object.entries(pieces).filter(([, list]) => list.length)
  .map(([palette, list]) => ({ geometry: mergeGeometries(list), role: 'stone', palette }));

// circles of radius r that cover a w x d rectangle around the origin (they stop
// walkers and keep grass and other objects out): [[x, z, r]]
export function boxCircles(w, d, r) {
  const out = [];
  const nx = Math.max(1, Math.ceil(w / (r * 1.4))), nz = Math.max(1, Math.ceil(d / (r * 1.4)));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) out.push([(i + 0.5) * (w / nx) - w / 2, (j + 0.5) * (d / nz) - d / 2, r]);
  return out;
}
