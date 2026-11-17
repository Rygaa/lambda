// Trees: a six-sided trunk, a canopy and leaf clumps on it (port of
// blender/pipeline/geometry.py trunk + canopy). A tree without a trunk
// (trunk: 0) is a bush (plant/bush): it never blocks the way.
// form: the canopy shape. egg (default): the egg-shaped ball of the oak.
// The others are one smooth shape turned around the trunk, from a side
// profile (FORMS): cone (pine and fir: "tiers" cones stacked), column
// (cypress), bell (willow, it hangs low).
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { defineBuilder } from '../registry.js';
import { between, nextRandom } from '../../lib/random.js';
import { leafGeometry, spriteGeometry } from '../../lib/sprites.js';

// side profiles [r, y] from the bottom to the top, in canopy radii, y from the canopy centre
const FORMS = {
  cone: [[0, -0.6], [1, -1], [0.72, -0.62], [0.38, 0.05], [0, 1]],
  column: [[0, -1], [0.7, -0.92], [1, -0.55], [1, 0], [0.85, 0.45], [0.5, 0.8], [0, 1]],
  bell: [[0, -0.95], [1.15, -1], [1.05, -0.55], [0.95, -0.05], [0.85, 0.4], [0.62, 0.75], [0.3, 0.95], [0, 1]],
};
const LEAF = { offset: 0.13, spacing: 0.15, tries: 560 };   // tries: points tried per m² of canopy (blue noise)

defineBuilder({
  name: 'tree',
  build(p, rng, ctx) {
    const s = between(rng, p.scale);
    const radii = p.radii.map((r) => r * s);
    const canopyY = p.canopyY * s;
    const parts = [];
    if (p.trunk > 0) {
      const t = new THREE.CylinderGeometry(p.r2 * s, p.r1 * s, p.trunk * s, 6).toNonIndexed();
      t.translate(0, p.trunkY * s, 0);
      t.computeVertexNormals();
      parts.push({ geometry: t, role: 'trunk' });
    }
    let top = canopyY + radii[1] * 0.9;
    if (!p.form || p.form === 'egg') {
      parts.push({ geometry: canopy(canopyY, radii), role: 'canopy' });
      // the leaf clumps: same layout rules as the trees exported from Blender
      const info = { canopy_radii: radii, canopy_center_y: canopyY, canopy_scale: 0.9, egg: 0.1, leaf_offset: 0.13, leaf_spacing: 0.15 };
      parts.push({ geometry: leafGeometry(info, rng, ctx.sunL, ctx.mid.canopy), role: 'leaves' });
    } else {
      const g = turned(p.form, p.tiers ?? 1, canopyY, radii);
      parts.push({ geometry: g, role: 'canopy' });
      parts.push({ geometry: leavesOn(g, rng, ctx.sunL, ctx.mid.canopy), role: 'leaves' });
      g.computeBoundingBox();
      top = g.boundingBox.max.y;
    }
    const trunk = p.trunk > 0;
    return {
      parts,
      height: top,
      radius: trunk ? p.r2 * s + 0.15 : radii[0] * 0.6,
      blocker: { r: p.r2 * s + 0.15, h: canopyY },
      blocks: trunk,
      turns: false,
    };
  },
});

// egg-shaped ball, wider at the top, smooth, scaled 0.9 (the leaves sit outside)
function canopy(cy, [rx, ry, rz]) {
  let g = new THREE.IcosahedronGeometry(1, 7);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const egg = 1 + 0.1 * y;
    pos.setXYZ(i, x * rx * egg * 0.9, y * ry * 0.9 + cy, z * rz * egg * 0.9);
  }
  g.computeVertexNormals();
  return g;
}

// a canopy turned around the trunk from a side profile of FORMS; a cone has
// "tiers" cones stacked, each narrower, overlapping the one below
function turned(form, tiers, cy, [rx, ry, rz]) {
  const profile = FORMS[form];
  if (!profile) throw new Error(`tree: unknown form "${form}" (known: egg, ${Object.keys(FORMS).join(', ')})`);
  const parts = [];
  const h = tiers > 1 ? (2 * ry) / (1 + (tiers - 1) * 0.62) : 2 * ry;   // each tier: this high, the next starts 38 % below its top
  for (let k = 0; k < tiers; k++) {
    const w = 1 - 0.6 * (tiers > 1 ? k / (tiers - 1) : 0), mid = cy - ry + h / 2 + k * h * 0.62;
    let g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), 24);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    g.scale(rx * w, h / 2, rz * w).translate(0, mid, 0);
    parts.push(g);
  }
  const g = parts.length > 1 ? mergeGeometries(parts) : parts[0];
  g.computeVertexNormals();
  return g;
}

// leaf clumps on blue-noise points of any canopy mesh, lit by its normal there
function leavesOn(g, rng, sunL, mid) {
  const P = g.attributes.position, N = g.attributes.normal, I = g.index;
  const v = (a, i) => new THREE.Vector3().fromBufferAttribute(a, i);
  const tris = [];
  let total = 0;
  for (let i = 0; i < I.count; i += 3) {
    const t = [I.getX(i), I.getX(i + 1), I.getX(i + 2)];
    const [A, B, C] = t.map((k) => v(P, k));
    const area = B.clone().sub(A).cross(C.clone().sub(A)).length() / 2;
    if (area < 1e-6) continue;
    total += area;
    tris.push({ t, A, B, C, end: total });
  }
  const acc = [], grid = new Map(), S = LEAF.spacing, key = (x, y, z) => `${x},${y},${z}`;
  for (let c = 0, n = Math.round(total * LEAF.tries); c < n; c++) {
    const r = nextRandom(rng) * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m].end < r) lo = m + 1; else hi = m; }
    const { t, A, B, C } = tris[lo];
    let u = nextRandom(rng), w = nextRandom(rng);
    if (u + w > 1) { u = 1 - u; w = 1 - w; }
    const p = A.clone().addScaledVector(B.clone().sub(A), u).addScaledVector(C.clone().sub(A), w);
    const gx = Math.floor(p.x / S), gy = Math.floor(p.y / S), gz = Math.floor(p.z / S);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) for (let dz = -1; dz <= 1 && !near; dz++)
      near = (grid.get(key(gx + dx, gy + dy, gz + dz)) ?? []).some((q) => q.p.distanceTo(p) < S);
    if (near) continue;
    const nn = v(N, t[0]).multiplyScalar(1 - u - w).addScaledVector(v(N, t[1]), u).addScaledVector(v(N, t[2]), w).normalize();
    const leaf = { p, n: nn };
    acc.push(leaf);
    const k = key(gx, gy, gz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(leaf);
  }
  const pos = new Float32Array(acc.length * 3), par = new Float32Array(acc.length * 4);
  acc.forEach(({ p, n }, i) => {
    pos.set([p.x + n.x * LEAF.offset, p.y + n.y * LEAF.offset, p.z + n.z * LEAF.offset], i * 3);
    // atlas cell, material, N.L, a random value: like leafGeometry
    par.set([Math.floor(nextRandom(rng) * 4), mid, n.x * sunL.x + n.y * sunL.y + n.z * sunL.z, nextRandom(rng)], i * 4);
  });
  return spriteGeometry(pos, pos, par);
}
