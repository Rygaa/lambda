// The pieces exported from Blender (assets.glb): stones, pillars, lintel,
// rubble, and the three trees. Used by the ?layout=blender comparison and for
// the ruins until they get a kind of their own (like rock.js).
import { defineKind } from '../registry.js';
import { leafGeometry } from '../../lib/sprites.js';

// one variant per name: { names: ['GatePillarL', 'OldPillar'] }
defineKind({
  name: 'glb',
  presets: { piece: { names: ['OldPillar'] } },
  variants: (p) => p.names.length,
  palettes: { stone: 'grey' },
  build(p, rng, ctx, i) {
    const a = ctx.meta.assets[p.names[i]];
    if (!a) throw new Error(`glb: no piece "${p.names[i]}" in assets.json`);
    return { parts: [{ geometry: ctx.geo[p.names[i]], role: 'stone' }], height: a.height, radius: a.footprint * 0.85 };
  },
});

// a tree size from assets.json (A, B, C), with two leaf layouts
defineKind({
  name: 'glb-tree',
  presets: { A: { tag: 'A' }, B: { tag: 'B' }, C: { tag: 'C' } },
  variants: 2,
  palettes: { trunk: 'brown', canopy: 'green' },
  build(p, rng, ctx) {
    const t = ctx.meta.trees[p.tag];
    const r = t.trunk_footprint + 0.15;
    return {
      parts: [
        { geometry: ctx.geo[t.trunk], role: 'trunk' },
        { geometry: ctx.geo[t.canopy], role: 'canopy' },
        { geometry: leafGeometry(t, rng, ctx.sunL, ctx.mid.canopy), role: 'leaves' },
      ],
      height: t.canopy_center_y + t.canopy_radii[1],
      radius: r,
      blocker: { r, h: t.canopy_center_y },
      blocks: true,                    // it has a trunk
      turns: false,
      crown: { y: t.canopy_center_y, r: Math.max(...t.canopy_radii) },
    };
  },
});
