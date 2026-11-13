// The gold form of the human (systems/transform.js), like Super Saiyan in Dragon Ball: its FlyFF hair gives way to
// the hair of lib/superHair.js (a free VRoid hair), which turns into gold spikes as the transformation goes (bend).
// The gold form shares every frame of the human as it is (lib/character.js dress) but its hair. Made of cubes, the
// gold form is made of cubes once more (lib/voxelBody.js), its hair as cubes of their own.
import * as THREE from 'three';
import { getResource } from '../ecs/world.js';
import { Gpu, Wardrobe } from '../resources.js';
import { bakeClips, fineMeshes, fineMesh } from './bake.js';
import { clipNames, unitScale, ONCE } from './character.js';
import { lookOf } from './voxels.js';
import { voxelBody, BODIES } from './voxelBody.js';
import { loadHair, pose, poseGeometry } from './superHair.js';

const BASE = '../assets/character/player/';
const HEAD_BONE = THREE.PropertyBinding.sanitizeNodeName('Bip02 Head');

// 4 points around the middle of the head (the same in every FlyFF head), posed by the head bone: baked like a part,
// they give the matrix of the head in each frame. From them at rest (REST) to where a frame put them: headMatrix
const PROXY = [[0.05, 0, 0], [0, 0.05, 0], [0, 0, 0.05], [-0.03, -0.03, -0.03]].map((p) => new THREE.Vector3(...p).add(new THREE.Vector3(0, 1.408, 0.006)));
const REST = new THREE.Matrix4().set(...['x', 'y', 'z'].flatMap((k) => PROXY.map((p) => p[k])), 1, 1, 1, 1).invert();
function headMatrix(g) {
  const p = g.getAttribute('position'), at = (get) => [0, 1, 2, 3].map((i) => get.call(p, i));
  return new THREE.Matrix4().set(...at(p.getX), ...at(p.getY), ...at(p.getZ), 1, 1, 1, 1).multiply(REST);
}

// the proxy: a part of the body made of the 4 points, posed by the head bone of the part `on` (the face)
function proxyPart(on) {
  const o = on.mesh, back = o.matrixWorld.clone().invert(), n = PROXY.length, local = new Float32Array(n * 3);
  PROXY.forEach((v, i) => v.clone().applyMatrix4(back).toArray(local, i * 3));
  const bone = Math.max(0, o.skeleton.bones.findIndex((b) => b.name === HEAD_BONE));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(local, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(n * 2).fill(0.5), 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n).fill([bone, 0, 0, 0]).flat(), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill([1, 0, 0, 0]).flat(), 4));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]);
  g.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(g, o.material);
  mesh.bind(o.skeleton, o.bindMatrix);
  mesh.matrixWorld.copy(o.matrixWorld);
  // a new mesh: its triangles are kept again on its first frame (lib/bake.js pose)
  return { ...on, mesh, rigid: false, uv: g.getAttribute('uv'), index: undefined, alphaAt: () => 255 };
}

// the gold form of the human as it is (dressed: lib/character.js dress), in the same look -> { clips, meshes, bend
// ({ lift, shake, gold, time }: how far its hair has turned, lib/superHair.js pose), forget }, or null: it has no hair
// (a cap hides it). Each frame: the parts of the human but its FlyFF hair, then the proxy (the matrix of the head).
// The hair is one geometry, bent at rest and moved by the matrix of the head: in the Normal look one mesh; made of
// cubes, its cubes follow its triangles, moved
export async function goldForm(world, dressed) {
  const { config } = getResource(world, Wardrobe), body = dressed.body, gpu = getResource(world, Gpu);
  const url = dressed.outfit.hair && `${BASE}parts/${dressed.outfit.hair}.glb`;
  const hairs = body ? body.parts.flatMap((p, m) => (p.url === url && !p.rigid ? [m] : [])) : [];
  if (!hairs.length) return null;
  const faceUrl = `${BASE}parts/${dressed.outfit.head}.glb`, face = body.parts.find((p) => p.url === faceUrl && !p.rigid);
  if (!face) return null;
  const baked = await bakeClips({ parts: [proxyPart(face)], seams: [], clips: body.clips }, clipNames(config), config.bakeFps, ONCE);
  const hair = await loadHair(), look = lookOf(world), bent = poseGeometry(hair), proxies = [];
  const keep = (list) => list.filter((_, m) => !hairs.includes(m));
  const clips = Object.fromEntries(Object.entries(dressed.clips).map(([state, frames]) => [state, frames.map((frame, k) => {
    const proxy = baked[state][k][0];
    proxy.userData.head = headMatrix(proxy);
    proxies.push(proxy);
    return [...keep(frame), proxy];
  })]));
  const geometries = [bent];
  let meshes, hairMesh, seen = 0, bends = 1;
  if (look) {
    // made of cubes: the body without its hair, then the hair (all its cubes, each keeps its place on a strand, so the
    // strands can open; its clear texels make no cubes), moved by the matrix of the head into `moved`
    const size = look.human.size / (await unitScale(world)).k, snap = BODIES === 'snap';
    const cubes = await voxelBody(world, { ...body, parts: keep(body.parts) }, { idle: [clips.idle[0].slice(0, -1)] }, size, look.normals, snap);
    const moved = poseGeometry(hair), P = moved.getAttribute('position'), N = moved.getAttribute('normal');
    geometries.push(moved);
    const place = (M) => {
      P.copy(bent.getAttribute('position')).applyMatrix4(M); P.needsUpdate = true;
      N.copy(bent.getAttribute('normal')).transformDirection(M); N.needsUpdate = true;
    };
    place(clips.idle[0].at(-1).userData.head);
    hairMesh = (await voxelBody(world, { parts: [{ texture: hair.texture, cut: true }] }, { idle: [[moved]] }, size, look.normals, snap, true)).mesh();
    const show = hairMesh.userData.showFrame;
    let shown = null;
    hairMesh.userData.showFrame = (frame) => {
      if (frame === shown && seen === bends) return;
      shown = frame; seen = bends;
      place(frame.at(-1).userData.head);
      show([moved]);
    };
    meshes = [cubes.mesh(), hairMesh];
  } else {
    meshes = fineMeshes(gpu, { ...body, parts: keep(body.parts) }, clips.idle[0].slice(0, -1));
    hairMesh = fineMesh(gpu, hair.texture, bent);
    hairMesh.material.uniforms.uCut.value = 0.5;
    hairMesh.matrixAutoUpdate = false;
    hairMesh.userData.showFrame = (frame) => { hairMesh.matrix.copy(frame.at(-1).userData.head); hairMesh.matrixWorldNeedsUpdate = true; };
    hairMesh.userData.showFrame(clips.idle[0]);
    hairMesh.layers.disable(3);   // no shadow: the shadow pass would draw its strands without their holes
    meshes.push(hairMesh);
  }
  // gold, the hair glows: its shade stays warm (render/shaders.js FINE_FRAG uGold, uGlow)
  const u = hairMesh.material.uniforms;
  let last = '';
  const bend = (to) => {
    u.uGold.value = u.uGlow.value = to.gold;
    const key = `${to.lift.toFixed(3)} ${to.shake.toFixed(3)} ${to.shake ? to.time.toFixed(3) : 0}`;
    if (key === last) return;
    last = key;
    pose(hair, bent, to);
    bends++;
  };
  const forget = () => {
    for (const mesh of meshes) mesh.material.dispose();
    for (const g of [...geometries, ...proxies]) g.dispose();
  };
  return { clips, meshes, bend, forget };
}

// puts a form ({ clips, meshes }) on the human (the Player component): its meshes in its group, its frames
export function wear(p, form) {
  for (const mesh of p.meshes) p.group.remove(mesh);
  for (const mesh of form.meshes) p.group.add(mesh);
  p.meshes = form.meshes;
  p.clips = form.clips;
}
