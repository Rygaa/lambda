// The tops of solid objects (rocks, buildings: gen/collision.js BY_SHAPE): a height map of their real shape, seen from
// above, in cells of CELL world units. A walker stands on it, and a part higher than it can step stops it
// (systems/player.js), so it can jump onto a rock and walk on it.
import * as THREE from 'three';

const CELL = 1 / 16;

// an empty map over the square [-ext, ext]
export function createTops(ext) {
  const n = Math.ceil((2 * ext) / CELL);
  return { ext, n, top: new Float32Array(n * n).fill(-Infinity) };
}

// the highest point of any solid object at (x, z), or -Infinity
export function topAt(tops, x, z) {
  const i = Math.floor((x + tops.ext) / CELL), j = Math.floor((z + tops.ext) / CELL);
  if (i < 0 || j < 0 || i >= tops.n || j >= tops.n) return -Infinity;
  return tops.top[j * tops.n + i];
}

// adds the parts of a shape placed at (x, y, z), turned by rot around the up axis
export function addShape(tops, parts, x, y, z, rot) {
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const { geometry } of parts) {
    const pos = geometry.attributes.position, idx = geometry.index;
    const count = idx ? idx.count : pos.count, at = (k) => (idx ? idx.getX(k) : k);
    for (let t = 0; t < count; t += 3) {
      a.fromBufferAttribute(pos, at(t)).applyMatrix4(m);
      b.fromBufferAttribute(pos, at(t + 1)).applyMatrix4(m);
      c.fromBufferAttribute(pos, at(t + 2)).applyMatrix4(m);
      triangle(tops, a, b, c);
    }
  }
}

// raise every cell whose centre is under the triangle to its height there (and the cells of its corners)
function triangle(tops, a, b, c) {
  const { ext, n, top } = tops;
  const raise = (i, j, y) => { if (i >= 0 && j >= 0 && i < n && j < n && y > top[j * n + i]) top[j * n + i] = y; };
  for (const p of [a, b, c]) raise(Math.floor((p.x + ext) / CELL), Math.floor((p.z + ext) / CELL), p.y);
  const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
  if (Math.abs(d) < 1e-9) return;      // a wall seen from above: its corners are enough
  const i0 = Math.floor((Math.min(a.x, b.x, c.x) + ext) / CELL), i1 = Math.floor((Math.max(a.x, b.x, c.x) + ext) / CELL);
  const j0 = Math.floor((Math.min(a.z, b.z, c.z) + ext) / CELL), j1 = Math.floor((Math.max(a.z, b.z, c.z) + ext) / CELL);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = (i + 0.5) * CELL - ext, z = (j + 0.5) * CELL - ext;
    const u = ((x - a.x) * (c.z - a.z) - (c.x - a.x) * (z - a.z)) / d;
    const v = ((b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z)) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    raise(i, j, a.y + u * (b.y - a.y) + v * (c.y - a.y));
  }
}
