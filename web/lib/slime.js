// Three.js side of the slimes: builds a slime's meshes and gives them the
// shape of a frame (lib/slimeShapes.js). Shared by the mesh system (build)
// and the slime rig system (shape).
import * as THREE from 'three';
import { SLIME_KINDS, SLIME_SCALE } from '../prefabs/slime.js';

const D = THREE.MathUtils.degToRad;
const UP = new THREE.Vector3(0, 1, 0);

// Blender axes (z up, facing -y) -> game axes (y up, facing +z)
const toGame = (x, y, z, out = new THREE.Vector3()) => out.set(x, z, -y);
// a Blender XYZ rotation (radians), as the same rotation in game axes
const setRot = (o, rx, ry, rz) => o.rotation.set(rx, rz, -ry, 'YZX');

// shared by every slime (never disposed)
const GEO = {
  eye: new THREE.SphereGeometry(1, 10, 6),
  drop: new THREE.IcosahedronGeometry(1, 0),
  blob: new THREE.IcosahedronGeometry(1, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
  spike: new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0),     // base at the origin
  flame: new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0),
  shaft: new THREE.CylinderGeometry(0.055, 0.055, 1.25, 8).rotateZ(Math.PI / 2),
  knob: new THREE.SphereGeometry(0.085, 8, 6),
};

// ------------------------------------------------------------------ body
// a low-poly blob: rings of points around the up axis
const RINGS = 8, SEG = 14;

// the triangles as point indices, in a fixed shuffled order: the magma slime
// lets its first ones glow, more of them while it attacks
function bodyTriangles() {
  const top = 1 + (RINGS - 1) * SEG;
  const v = (i, j) => 1 + (i - 1) * SEG + (j % SEG);
  const tris = [];
  for (let j = 0; j < SEG; j++) tris.push([0, v(1, j + 1), v(1, j)]);
  for (let i = 1; i < RINGS - 1; i++)
    for (let j = 0; j < SEG; j++) tris.push([v(i, j), v(i, j + 1), v(i + 1, j + 1)], [v(i, j), v(i + 1, j + 1), v(i + 1, j)]);
  for (let j = 0; j < SEG; j++) tris.push([v(RINGS - 1, j), v(RINGS - 1, j + 1), top]);
  const key = (i) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
  return tris.map((t, i) => [t, Math.abs(key(i))]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
}
const TRIS = bodyTriangles();

// the outline of the blob: phi from -pi/2 (bottom) to pi/2 (top) -> [radius, height]
function profile(s, phi) {
  const sn = Math.sin(phi), c = Math.cos(phi);
  if (phi < 0) return [s.W * Math.max(c, 0) ** 0.45, s.b * s.H * (1 + sn)];
  return [s.W * ((1 - s.tip) * c + s.tip * (1 - sn)), s.b * s.H + (1 - s.b) * s.H * sn];
}

// a point on the surface (Blender axes), th = angle around (0 = front)
function surface(s, phi, th, inset = 0) {
  const [r0, z] = profile(s, phi);
  const r = r0 - inset, k = (z / Math.max(s.H, 1e-3)) ** 2;
  return [r * Math.sin(th), -r * Math.cos(th) - s.lean * s.H * k, z];
}

const pts = Array.from({ length: 2 + (RINGS - 1) * SEG }, () => new THREE.Vector3());
const nrm = pts.map(() => new THREE.Vector3());
const ea = new THREE.Vector3(), eb = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3(), centre = new THREE.Vector3();

function fillBody(geo, s) {
  toGame(0, 0, 0, pts[0]);
  for (let i = 1; i < RINGS; i++) {
    const phi = -Math.PI / 2 + (Math.PI * i) / RINGS;
    const [r, z] = profile(s, phi);
    const k = (z / Math.max(s.H, 1e-3)) ** 2;
    for (let j = 0; j < SEG; j++) {
      const th = (2 * Math.PI * (j + 0.5)) / SEG;     // a face, not a fold, at the front
      const rr = r * (1 + s.wob * Math.sin(5 * th + s.wph) * Math.max(Math.cos(phi), 0));
      toGame(rr * Math.sin(th), -rr * Math.cos(th) - s.lean * s.H * k, z, pts[1 + (i - 1) * SEG + j]);
    }
  }
  toGame(0, -s.lean * s.H, s.H, pts[pts.length - 1]);
  toGame(0, -s.lean * s.H * 0.25, s.H * 0.5, centre);
  // smooth normals (face normals summed per point): the post pass then draws
  // the outline and the light bands, not a line on every facet
  for (const p of nrm) p.set(0, 0, 0);
  const order = TRIS.map(([a, b, c]) => {
    n.crossVectors(ea.subVectors(pts[b], pts[a]), eb.subVectors(pts[c], pts[a]));
    mid.copy(pts[a]).add(pts[b]).add(pts[c]).divideScalar(3).sub(centre);
    const out = n.dot(mid) < 0 ? [a, c, b] : [a, b, c];   // outward, counter-clockwise
    if (out[1] !== b) n.negate();
    for (const i of out) nrm[i].add(n);
    return out;
  });
  for (const p of nrm) p.normalize();
  const P = geo.attributes.position.array, N = geo.attributes.normal.array;
  order.forEach((tri, t) => tri.forEach((i, k) => {
    P.set([pts[i].x, pts[i].y, pts[i].z], t * 9 + k * 3);
    N.set([nrm[i].x, nrm[i].y, nrm[i].z], t * 9 + k * 3);
  }));
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  // group 0: the body colour, group 1: glowing faces (magma)
  const glow = s.crackW > 0 && s.tint === null ? Math.round(TRIS.length * s.crackW * 2.5) : 0;
  geo.clearGroups();
  geo.addGroup(0, glow * 3, 1);
  geo.addGroup(glow * 3, (TRIS.length - glow) * 3, 0);
}

// ------------------------------------------------------------------ rig
// kind: green | undead | magma; material(role) -> THREE.Material (role = char_<palette colour>)
// returns { slime: true, kind, root, body, eyes, brows, mouth, teeth, drops, spikes,
//   pillars, cracks, flames, bone, boneParts, meshes: [{ mesh, role }], material }
export function buildSlimeRig(kind, material) {
  const K = SLIME_KINDS[kind];
  const role = (name) => 'char_' + name;
  const root = new THREE.Group();
  root.scale.setScalar(SLIME_SCALE);
  const meshes = [];
  const add = (geo, colour, parent = root, shadow = true) => {
    const mesh = new THREE.Mesh(geo, material(role(colour)));
    if (shadow) mesh.layers.enable(1);        // layer 1 = shadow casters
    mesh.visible = false;
    parent.add(mesh);
    meshes.push({ mesh, role: role(colour) });
    return mesh;
  };
  const many = (count, geo, colour, shadow) => Array.from({ length: count }, () => add(geo, colour, root, shadow));

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRIS.length * 9), 3));
  bodyGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(TRIS.length * 9), 3));
  const body = new THREE.Mesh(bodyGeo, [material(role(K.body)), material(role(K.lava || K.body))]);
  body.layers.enable(1);
  body.frustumCulled = false;
  root.add(body);

  const bone = new THREE.Group();
  root.add(bone);
  const boneParts = [add(GEO.shaft, 'slime_bone', bone)];
  for (const x of [-0.64, 0.64]) for (const z of [-0.06, 0.06]) {
    const knob = add(GEO.knob, 'slime_bone', bone);
    knob.position.set(x, 0, z);
    boneParts.push(knob);
  }

  return {
    slime: true, kind, root, body, bone, boneParts, meshes, material,
    eyes: many(2, GEO.eye, K.eye),
    brows: many(2, GEO.box, 'slime_ink'),
    mouth: add(GEO.eye, 'slime_ink'),
    teeth: many(3, GEO.box, 'slime_tooth'),
    drops: many(24, GEO.drop, K.fx),
    spikes: many(8, GEO.spike, K.fx),
    pillars: Array.from({ length: 7 }, () => many(3, GEO.blob, 'slime_lava')),
    cracks: many(16, GEO.box, K.crack, false),
    flames: many(3, GEO.flame, 'slime_lava'),
  };
}

export function disposeSlimeRig(rig) {
  rig.body.geometry.dispose();        // the other geometries are shared
}

const v = new THREE.Vector3(), dir = new THREE.Vector3();

// s: a SlimeShape component (see lib/slimeShapes.js)
export function applySlimeShape(rig, s) {
  const K = SLIME_KINDS[rig.kind];
  for (const { mesh } of rig.meshes) mesh.visible = false;
  const show = (mesh, x, y, z) => {
    mesh.visible = true;
    toGame(x, y, z, mesh.position);
    return mesh;
  };
  // Blender-axes size -> game-axes scale
  const size = (mesh, x, y, z) => mesh.scale.set(x, z, y);

  fillBody(rig.body.geometry, s);
  toGame(s.sx, 0, s.z, rig.body.position);
  const tint = { hurt: 'slime_hurt', gray: 'slime_gray' }[s.tint];
  rig.body.material[0] = rig.material('char_' + (tint || K[s.mat] || K.body));
  const lift = (p) => [p[0] + s.sx, p[1], p[2] + s.z];

  // face
  const phiE = s.b < 0.45 ? 0.38 : 0.2;
  const ex = s.W < 0.7 ? 0.42 : 0.32;
  rig.eyes.forEach((e, i) => {
    if (s.eyes === 'none') return;
    const side = i === 0 ? -1 : 1;
    show(e, ...lift(surface(s, phiE, side * ex, 0.025)));
    setRot(e, 0, 0, side * ex);
    let sz = { open: [0.085, 0.05, 0.1], closed: [0.09, 0.04, 0.022], slit: [0.09, 0.04, 0.03], angry: [0.09, 0.05, 0.075] }[s.eyes];
    if (rig.kind === 'magma' && s.eyes === 'open') sz = [0.09, 0.05, 0.05];
    size(e, ...sz);
    if (s.brows) {
      const b = show(rig.brows[i], ...lift(surface(s, phiE + 0.16, side * ex * 0.9)));
      setRot(b, 0, side * D(28), side * ex);
      size(b, 0.16, 0.05, 0.04);
    }
  });
  if (s.mouth) {
    const m = lift(surface(s, phiE - 0.3, 0, 0.03));
    size(show(rig.mouth, ...m), 0.2 * s.mouth, 0.05, 0.13 * s.mouth);
    if (s.teeth) rig.teeth.forEach((t, k) => size(show(t, m[0] + (k - 1) * 0.1, m[1] - 0.03, m[2] + 0.09), 0.05, 0.04, 0.05));
  }
  if (s.bone) {
    for (const p of rig.boneParts) p.visible = true;
    toGame(s.sx, 0.05, s.z + s.b * s.H + 0.12 * s.H, rig.bone.position);
    setRot(rig.bone, 0, D(-18), D(25));
    rig.bone.scale.setScalar(0.9);
  }

  // effects
  s.drops.forEach(([x, y, z, r, stretch], i) => i < rig.drops.length && size(show(rig.drops[i], x, y, z), r, r, r * stretch));
  s.spikes.forEach(([az, el, L, w], i) => {
    const a = D(az), e = D(el);
    toGame(Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e), dir);
    const m = rig.spikes[i];
    m.visible = true;
    m.position.copy(dir).multiplyScalar(0.15).add(v.set(0, 0.08, 0));
    m.quaternion.setFromUnitVectors(UP, dir);
    m.scale.set(w, L, w);
  });
  s.pillars.forEach(([x, y, h, w], i) => rig.pillars[i].forEach((m, k) => {
    const r = w * (1 - 0.18 * k);
    size(show(m, x, y, (h * (k + 0.5)) / 3), r, r, Math.max((h / 3) * 0.75, w));
  }));
  s.cracks.forEach(([a, L, w], i) => {
    const ar = D(a);
    const m = show(rig.cracks[i], Math.cos(ar) * (0.3 + L / 2), Math.sin(ar) * (0.3 + L / 2), 0.01);
    setRot(m, 0, 0, ar + 0.15 * Math.sin(a));
    size(m, L, w, 0.02);
  });
  if (s.flames && s.eyes !== 'none') {
    const top = surface(s, 1.2, 0)[2];
    rig.flames.forEach((m, k) => {
      const u = (s.frame / 6 + k / 3) % 1, r = 0.08 * (1 - u) + 0.02;
      size(show(m, s.sx + (k - 1) * 0.16, 0.05, s.z + top + 0.02 + u * 0.3), r, r, r * 2.6);
    });
  }
}
