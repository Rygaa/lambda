// Fixed layouts made from the exported Blender pieces (kind glb / glb-tree):
//   blender  the exact layout of the Blender render, for side-by-side checks
//   pillars  test ground: only the three big stone pillars
//   forest   the hand-made forest: ruins and groves, then scattered trees and stones
import { createWorldBuilder, finish } from './world.js';
import { GATE, GROVE, groupParts, rotY } from '../prefabs/parts.js';

export function buildLayout(cache, layout, seed = 11) {
  const meta = cache.ctx.meta;
  const A = meta.assets;
  const half = layout === 'blender' ? 7 : 20;
  const b = createWorldBuilder(cache, seed, half);
  const piece = (name) => b.set('glb', 'piece', { names: [name] });
  const addSolid = (name, x, z, rot = 0) => b.add(piece(name), 0, x, z, rot);
  const addTree = (tag, x, z) => b.add(b.set('glb-tree', tag), Math.floor(b.rand() * 2), x, z);

  if (layout === 'pillars') {
    addSolid('GatePillarL', -3, 0, 0.3);
    addSolid('OldPillar', 0, 0, 0.7);
    addSolid('GatePillarR', 3, 0, -0.2);
    b.start = [0, 0.6, 2.5];
    return finish(b);
  }

  if (layout === 'blender') {
    for (const name of Object.keys(A)) addSolid(name, A[name].origin[0], A[name].origin[2]);
    const t = meta.trees.A;
    addTree('A', t.origin[0], t.origin[2]);
    const g = meta.render.glade;
    b.glades.push({ x: g[0], z: g[2], r: meta.render.glade_r, k: 0.2 });
    b.start = meta.render.cam_target;
    return finish(b);
  }

  function prefab(names, x, z, rot, treeTag = null) {
    for (const p of groupParts(meta, names, treeTag)) {
      const [dx, dz] = rotY(p.dx, p.dz, rot);
      if (p.type === 'tree') addTree(p.tag, x + dx, z + dz);
      else addSolid(p.name, x + dx, z + dz, rot);
    }
  }

  const HALF = half;
  // hand-placed ruins and groves, each in a clearing
  prefab(GATE, 2.2, -1.9, 0.25);
  b.glades.push({ x: 1.5, z: -0.5, r: 3.2, k: 0.18 });
  prefab(GROVE, -3.4, 1.2, 0.9, 'A');
  prefab(GROVE, 10.5, 7.5, -1.4, 'C');
  b.glades.push({ x: 10.5, z: 7.5, r: 3.0, k: 0.16 });
  prefab(GROVE, -10.5, -8.5, 2.2, 'B');
  prefab(GATE, -8.5, 11.5, 2.6);
  b.glades.push({ x: -8.5, z: 11.5, r: 3.4, k: 0.2 });
  b.glades.push({ x: 11.0, z: -9.0, r: 3.6, k: 0.18 });
  addSolid('OldPillar', -6.4, -2.6, 0.3);
  addSolid('OldPillar', 12.5, -5.5, 1.9);
  addSolid('OldPillar', -13.5, 7.5, -0.8);
  addSolid('GatePillarR', 13.2, -9.6, 0.7);

  const trees = () => b.props.filter((p) => p.kind === 'glb-tree');
  const scatter = (names, count, minR = 0.3, near = null) => {
    for (let k = 0, tries = 0; k < count && tries < count * 60; tries++) {
      let x, z;
      if (near) { const t = b.pick(near); const a = b.range(0, 6.283); const r = b.range(1.6, 3.2); x = t.x + Math.cos(a) * r; z = t.z + Math.sin(a) * r; }
      else { x = b.range(-HALF, HALF); z = b.range(-HALF, HALF); }
      const name = b.pick(names);
      if (Math.abs(x) > HALF || Math.abs(z) > HALF || !b.free(x, z, A[name].footprint + minR)) continue;
      addSolid(name, x, z, b.range(0, 6.283));
      k++;
    }
  };

  // trees: blue-noise spacing, kept out of the clearings
  for (let tries = 0; tries < 4000; tries++) {
    const x = b.range(-HALF, HALF), z = b.range(-HALF, HALF);
    if (b.glades.some((g) => Math.hypot(g.x - x, g.z - z) < g.r * 0.95)) continue;
    if (trees().some((t) => Math.hypot(t.x - x, t.z - z) < 4.6)) continue;
    if (!b.free(x, z, 1.0)) continue;
    addTree(b.pick(['A', 'A', 'B', 'C']), x, z);
  }

  const kindOf = (kind) => Object.keys(A).filter((n) => A[n].kind === kind);
  scatter(['Boulder01', 'Boulder02'], 6, 1.0);
  scatter(['Crag01', 'Crag02', 'Crag03'], 9, 0.8);
  scatter(kindOf('stone'), 18, 0.4, trees());
  scatter(kindOf('stone'), 10, 0.5);
  scatter(kindOf('rubble'), 12, 0.3);
  scatter(kindOf('pebble'), 70, 0.2);

  b.start = [2.0, 0.6, -1.0];
  return finish(b);
}
