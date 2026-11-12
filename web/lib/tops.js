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

// adds the parts of meshes ({ geometry, matrix }: to the world) a walker can reach: what is below ceiling(x, z). So
// the roofs, arches and leaves of the FlyFF objects of a map are over its head (systems/objects.js), and their floors,
// steps and bridges are under its feet. A wall (a steep triangle) raises the cells along it to its top, at most the
// ceiling, so it stops a walker
export function addReachable(tops, meshes, ceiling) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), up = new THREE.Vector3();
  for (const { geometry, matrix } of meshes) {
    const pos = geometry.attributes.position, idx = geometry.index;
    const count = idx ? idx.count : pos.count, at = (k) => (idx ? idx.getX(k) : k);
    for (let t = 0; t < count; t += 3) {
      a.fromBufferAttribute(pos, at(t)).applyMatrix4(matrix);
      b.fromBufferAttribute(pos, at(t + 1)).applyMatrix4(matrix);
      c.fromBufferAttribute(pos, at(t + 2)).applyMatrix4(matrix);
      const lo = Math.min(a.y, b.y, c.y), hi = Math.max(a.y, b.y, c.y);
      if (lo > ceiling((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) continue;      // over the head
      up.subVectors(b, a).cross(c.clone().sub(a));
      if (Math.abs(up.y) > 0.3 * up.length()) { triangle(tops, a, b, c, ceiling); continue; }
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (CELL / 2));
        for (let s = 0; s <= steps; s++) {
          const x = p.x + ((q.x - p.x) * s) / steps, z = p.z + ((q.z - p.z) * s) / steps;
          raiseCell(tops, Math.floor((x + tops.ext) / CELL), Math.floor((z + tops.ext) / CELL), Math.min(hi, ceiling(x, z)));
        }
      }
    }
  }
}

const raiseCell = ({ n, top }, i, j, y) => { if (i >= 0 && j >= 0 && i < n && j < n && y > top[j * n + i]) top[j * n + i] = y; };

// raise every cell whose centre is under the triangle to its height there (and the cells of its corners); with a
// ceiling(x, z), not where the triangle is higher than it
function triangle(tops, a, b, c, ceiling = null) {
  const { ext } = tops;
  const raise = (i, j, y) => { if (!ceiling || y <= ceiling((i + 0.5) * CELL - ext, (j + 0.5) * CELL - ext)) raiseCell(tops, i, j, y); };
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
