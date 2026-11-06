// Part blueprints: groups of exported Blender pieces kept in their arrangement.
//   part = { type: 'solid', name } | { type: 'tree', tag }, plus dx, dz inside a group

// same rotation as THREE.Object3D.rotation.y
export const rotY = (x, z, a) => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];

export const GATE = ['GatePillarL', 'GatePillarR', 'Lintel', 'Rubble01', 'Rubble02', 'Rubble03', 'Rubble04'];
export const GROVE = ['Stone01', 'Stone02', 'Stone03', 'Stone04', 'Stone05', 'Stone06', 'Pebble01', 'Pebble03', 'Pebble06'];

// A group of pieces kept in their Blender arrangement, relative to its centre:
// [{ type: 'solid', name, dx, dz } | { type: 'tree', tag, dx, dz }]
export function groupParts(meta, names, treeTag = null) {
  const A = meta.assets;
  let cx = 0, cz = 0;
  for (const n of names) { cx += A[n].origin[0]; cz += A[n].origin[2]; }
  cx /= names.length; cz /= names.length;
  const parts = names.map((n) => ({ type: 'solid', name: n, dx: A[n].origin[0] - cx, dz: A[n].origin[2] - cz }));
  if (treeTag) {
    const o = meta.trees.A.origin;
    parts.push({ type: 'tree', tag: treeTag, dx: o[0] - cx, dz: o[2] - cz });
  }
  return parts;
}
