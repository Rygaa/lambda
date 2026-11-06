// Trees: a six-sided trunk, an egg-shaped canopy and leaf clumps on it (port
// of blender/pipeline/geometry.py trunk + canopy). A tree without a trunk
// (trunk: 0) is a bush: it never blocks the way.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { defineKind } from '../registry.js';
import { between } from '../../lib/random.js';
import { leafGeometry } from '../../lib/sprites.js';

defineKind({
  name: 'tree',
  presets: {
    //       trunk length, radius at the bottom / top, trunk centre height,
    //       canopy centre height, canopy radii [x, y, z], everything times `scale`
    small: { trunk: 1.4, r1: 0.22, r2: 0.15, trunkY: 0.6, canopyY: 1.95, radii: [0.95, 1.08, 0.95], scale: [0.92, 1.08] },
    medium: { trunk: 1.7, r1: 0.27, r2: 0.18, trunkY: 0.75, canopyY: 2.3, radii: [1.18, 1.32, 1.18], scale: [0.92, 1.08] },
    big: { trunk: 2.0, r1: 0.32, r2: 0.22, trunkY: 0.9, canopyY: 2.75, radii: [1.42, 1.58, 1.42], scale: [0.92, 1.08] },
    bush: { trunk: 0, r1: 0, r2: 0, trunkY: 0, canopyY: 0.3, radii: [0.62, 0.45, 0.62], scale: [0.8, 1.2] },
  },
  variants: 3,
  palettes: { trunk: 'brown', canopy: 'green' },
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
    parts.push({ geometry: canopy(canopyY, radii), role: 'canopy' });
    // the leaf clumps: same layout rules as the exported trees (assets.json "trees")
    const info = { canopy_radii: radii, canopy_center_y: canopyY, canopy_scale: 0.9, egg: 0.1, leaf_offset: 0.13, leaf_spacing: 0.15 };
    parts.push({ geometry: leafGeometry(info, rng, ctx.sunL, ctx.mid.canopy), role: 'leaves' });
    const trunk = p.trunk > 0;
    return {
      parts,
      height: canopyY + radii[1] * 0.9,
      radius: trunk ? p.r2 * s + 0.15 : radii[0] * 0.6,
      blocker: { r: p.r2 * s + 0.15, h: canopyY },
      blocks: trunk,
      turns: false,
      crown: { y: canopyY, r: Math.max(...radii) },
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
