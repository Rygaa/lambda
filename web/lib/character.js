// Three.js side of the character: builds the rig of a look and poses it.
// Shared by the mesh system (build) and the rig system (pose).
import * as THREE from 'three';
import { SLASH, RIG_SCALE, CHAR_PALETTE, characterParts, jointsOf, screenParts } from '../prefabs/character.js';

const D = THREE.MathUtils.degToRad;
const UP = new THREE.Vector3(0, 1, 0);

// Blender rig axes (z up, facing -y) -> game axes (y up, facing +z)
const toGame = ([x, y, z]) => new THREE.Vector3(x, z, -y);
// a Blender XYZ rotation (degrees), as the same rotation in game axes
function setRot(o, [rx, ry, rz] = [0, 0, 0]) {
  o.rotation.set(D(rx), D(rz), D(-ry), 'YZX');
}

function partGeometry({ shape, size: [a, b, c] = [], mesh }) {
  if (shape === 'mesh') return meshGeometry(mesh);
  if (shape === 'box') return new THREE.BoxGeometry(a, c, b);
  if (shape === 'cyl') return new THREE.CylinderGeometry(a, a, b, c);
  return new THREE.ConeGeometry(a, b, c);
}

// a mesh part (the 3d_new model): positions and normals in rig axes
function meshGeometry({ pos, nrm, idx, uv }) {
  const conv = (a) => {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) toGame([a[i], a[i + 1], a[i + 2]]).toArray(out, i);
    return out;
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(conv(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(conv(nrm), 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// the sword trail: a two-sided ribbon; applyPose shows the part between two angles
function slashGeometry() {
  const { from, to, segments: n, inner, outer } = SLASH;
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = D(from + ((to - from) * i) / n);
    for (const r of [inner, outer]) pos.push(...toGame([0, r * Math.sin(a), -r * Math.cos(a)]).toArray());
  }
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = [2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2];
    idx.push(a, b, c, a, c, d, a, c, b, a, d, c);   // both sides: 12 indices per segment
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 0 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// look: a Character component; material(role) -> THREE.Material;
// screenMaterial(tex or '#rrggbb') -> the material of a full-resolution copy (top view, layer 3 only)
// returns { root, joints, slash, meshes: [{ mesh, role }], table, screen } with role =
// char_<colour>, table = the joint table of the look's model and screen = the textured copies
export function buildRig(look, material, screenMaterial) {
  const root = new THREE.Group();
  const joints = { root };
  const table = jointsOf(look);
  for (const [name, [parent, at, rot]] of Object.entries(table)) {   // parents come first
    const j = new THREE.Group();
    j.position.copy(toGame(at));
    setRot(j, rot);
    joints[parent].add(j);
    joints[name] = j;
  }
  const meshes = [];
  // a model with textured copies also gets a flat-coloured copy of its other
  // parts (sword, shield, slash), so the top view's full-resolution pass draws
  // them too; the copy shares the geometry and follows its part
  const copies = screenParts(look).length > 0;
  const copy = (mesh, color) => {
    if (!copies) return;
    const c = new THREE.Mesh(mesh.geometry, screenMaterial(CHAR_PALETTE[color][0]));
    c.layers.set(3);
    c.frustumCulled = mesh.frustumCulled;
    mesh.add(c);
  };
  for (const part of characterParts(look)) {
    const role = 'char_' + part.color;
    const mesh = new THREE.Mesh(partGeometry(part), material(role));
    mesh.position.copy(toGame(part.pos ?? [0, 0, 0]));
    setRot(mesh, part.rot);
    if (!part.noShadow) mesh.layers.enable(1);      // layer 1 = shadow casters
    joints[part.joint].add(mesh);
    meshes.push({ mesh, role });
    if (part.shape !== 'mesh') copy(mesh, part.color);
  }
  // textured copies (3d_new): only the top view's full-resolution pass draws them
  const screen = [];
  for (const part of screenParts(look)) {
    const mesh = new THREE.Mesh(meshGeometry(part), screenMaterial(part.tex));
    mesh.layers.set(3);
    joints[part.joint].add(mesh);
    screen.push(mesh);
  }
  const slash = new THREE.Mesh(slashGeometry(), material('char_slash'));
  slash.visible = false;
  slash.frustumCulled = false;
  joints.slash.add(slash);
  copy(slash, 'slash');
  meshes.push({ mesh: slash, role: 'char_slash' });
  root.scale.setScalar(RIG_SCALE);
  return { root, joints, slash, meshes, table, screen };
}

export function disposeRig(rig) {
  for (const { mesh } of rig.meshes) mesh.geometry.dispose();
  for (const mesh of rig.screen) mesh.geometry.dispose();
}

const qHand = new THREE.Quaternion(), qRoot = new THREE.Quaternion(), qYaw = new THREE.Quaternion();

// p: a Pose component (see lib/poses.js)
export function applyPose(rig, p) {
  const j = rig.joints;
  rig.root.scale.set(RIG_SCALE * p.sx, RIG_SCALE * p.sz, RIG_SCALE * p.sx);
  j.hips.position.copy(toGame([0, p.dy, rig.table.hips[1][2] + p.dz]));
  setRot(j.chest, [p.lean, 0, p.twist]);
  setRot(j.neck, [p.neck, 0, 0]);
  setRot(j.shS, [p.aS, -8, p.aSz]);       // arms hang a little outwards
  setRot(j.shH, [p.aH, 8, p.aHz]);
  setRot(j.legS, [p.lS, 0, 0]);
  setRot(j.legH, [p.lH, 0, 0]);
  setRot(j.sword, [p.w, p.swy, 0]);
  // the shield keeps its heading in the character's frame, whatever the arm does
  j.handH.getWorldQuaternion(qHand);
  rig.root.getWorldQuaternion(qRoot);
  j.shield.quaternion.copy(qHand.invert()).multiply(qRoot).multiply(qYaw.setFromAxisAngle(UP, D(p.syaw)));

  const { from, to, segments: n } = SLASH;
  const seg = (a) => THREE.MathUtils.clamp(((a - from) / (to - from)) * n, 0, n);
  const i0 = p.slash ? Math.floor(seg(p.slash[0])) : 0, i1 = p.slash ? Math.ceil(seg(p.slash[1])) : 0;
  rig.slash.visible = i1 > i0;
  rig.slash.geometry.setDrawRange(i0 * 12, (i1 - i0) * 12);
}
