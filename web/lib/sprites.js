// Camera-facing sprite quads (grass, flowers, leaf clumps).
import * as THREE from 'three';
import { nextRandom } from './random.js';

export const QUAD = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

export function spriteGeometry(pos, light, param) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = QUAD.index;
  g.setAttribute('position', QUAD.attributes.position);
  g.setAttribute('uv', QUAD.attributes.uv);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute('iLight', new THREE.InstancedBufferAttribute(light, 3));
  g.setAttribute('iParam', new THREE.InstancedBufferAttribute(param, 4));
  g.instanceCount = pos.length / 3;
  return g;
}

export function spriteUniforms(tex, info, kind, pivotY, ppu) {
  return {
    uAtlas: { value: tex },
    uCells: { value: info.count },
    uSize: { value: new THREE.Vector2(info.cell[0] / ppu, info.cell[1] / ppu) },
    uPivotY: { value: pivotY },
    uKind: { value: kind },
  };
}

// Leaf clumps on blue-noise points of an egg-shaped canopy, in tree space.
export function leafGeometry(info, rng, sunL, mid) {
  const [rx, ry, rz] = info.canopy_radii;
  const cy = info.canopy_center_y, k = info.canopy_scale, r = info.leaf_spacing;
  const acc = [];
  for (let c = 0; c < 9000; c++) {
    let vx = nextRandom(rng) * 2 - 1, vy = nextRandom(rng) * 2 - 1, vz = nextRandom(rng) * 2 - 1;
    const l = Math.hypot(vx, vy, vz);
    if (l > 1 || l < 1e-3) { c--; continue; }
    vx /= l; vy /= l; vz /= l;
    const egg = 1 + info.egg * vy;
    const p = [vx * rx * egg * k, cy + vy * ry * k, vz * rz * egg * k];
    if (acc.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < r)) continue;
    acc.push(p);
  }
  const n = acc.length;
  const pos = new Float32Array(n * 3), par = new Float32Array(n * 4);
  acc.forEach((p, i) => {
    const rel = [p[0] / (rx * rx), (p[1] - cy) / (ry * ry), p[2] / (rz * rz)];
    const nl = Math.hypot(...rel);
    const nn = rel.map((v) => v / nl);
    pos.set([p[0] + nn[0] * info.leaf_offset, p[1] + nn[1] * info.leaf_offset, p[2] + nn[2] * info.leaf_offset], i * 3);
    par.set([Math.floor(nextRandom(rng) * 4), mid, nn[0] * sunL.x + nn[1] * sunL.y + nn[2] * sunL.z, nextRandom(rng)], i * 4);
  });
  return spriteGeometry(pos, pos, par);
}
