// The human (assets/character/player, the FlyFF male): ported from the voxel branch
// (game/src/client/character.ts). Its clips (idle, walk, run, the 4 parts of a jump, 4 hits) are baked once at load into frames of posed
// vertices (bakeFps a second); systems/player.js swaps the frames and moves it.
// The fixes of character.ts are kept: fixSecondBones, triangles on transparent texels dropped,
// faces turned the right way, transparent texels filled, seams welded, normals smoothed over the body.
// It is drawn 4x finer than the world, on top of the frame (render/shaders.js FINE_VERT, FINE_FRAG), like the
// fixed human of the scene tool on the backup branch. Layer 1: it casts a shadow; layer 2: the fine pass.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getResource, spawn } from '../ecs/world.js';
import { Player } from '../components.js';
import { Gpu, Settings } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';

const BASE = '../assets/character/player/';
const HEIGHT = 1.05;    // world units: a person is about 1 unit tall (gen/collision.js)

// the converter gets the second bone of a vertex wrong: keep the nearest bone, give the other weight to a neighbour
function fixSecondBones(o) {
  const bones = o.skeleton.bones;
  const rest = bones.map((_, i) => new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[i].clone().invert()));
  const idx = new Map(bones.map((b, i) => [b, i]));
  const neighbors = (i) => [bones[i].parent, ...bones[i].children].map((b) => idx.get(b)).filter((k) => k !== undefined);
  const pos = o.geometry.getAttribute('position'), si = o.geometry.getAttribute('skinIndex'), sw = o.geometry.getAttribute('skinWeight');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const inf = [];
    for (let t = 0; t < 4; t++) if (sw.getComponent(i, t) > 0) inf.push([si.getComponent(i, t), sw.getComponent(i, t)]);
    if (inf.length !== 2) continue;
    const [[a, wa], [b, wb]] = inf;
    if (a !== b && neighbors(a).includes(b)) continue;
    v.fromBufferAttribute(pos, i);
    const keep = a === b ? a : v.distanceTo(rest[a]) <= v.distanceTo(rest[b]) ? a : b;
    const near = neighbors(keep).sort((x, y) => v.distanceTo(rest[x]) - v.distanceTo(rest[y]))[0];
    if (near === undefined) continue;
    const wKeep = a === b ? wa : keep === a ? wa : wb, wOther = a === b ? wb : keep === a ? wb : wa;
    si.setXYZW(i, keep, near, 0, 0);
    sw.setXYZW(i, wKeep, wOther, 0, 0);
  }
}

// each transparent texel gets the colour of an opaque neighbour; alphaAt reads the first alpha
function solidTexture(map) {
  const img = map.image, cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, cv.width, cv.height).data, filled = new Uint8ClampedArray(px);
  const opaque = new Uint8Array(cv.width * cv.height);
  for (let i = 0; i < opaque.length; i++) opaque[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  for (let pass = 0; pass < 64; pass++) {
    let changed = 0;
    const next = opaque.slice();
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = y * cv.width + x;
      if (opaque[i]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = ((y + dy + cv.height) % cv.height) * cv.width + ((x + dx + cv.width) % cv.width);
        if (opaque[k]) { r += filled[k * 4]; g += filled[k * 4 + 1]; b += filled[k * 4 + 2]; c++; }
      }
      if (c) { filled[i * 4] = r / c; filled[i * 4 + 1] = g / c; filled[i * 4 + 2] = b / c; next[i] = 1; changed++; }
    }
    opaque.set(next);
    if (!changed) break;
  }
  for (let i = 0; i < opaque.length; i++) filled[i * 4 + 3] = 255;
  const fcv = document.createElement('canvas');
  fcv.width = cv.width; fcv.height = cv.height;
  fcv.getContext('2d').putImageData(new ImageData(filled, cv.width, cv.height), 0, 0);
  const texture = new THREE.CanvasTexture(fcv);
  texture.flipY = false;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  const alphaAt = (u, w) => {
    const x = Math.min(cv.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * cv.width)));
    const y = Math.min(cv.height - 1, Math.max(0, Math.floor((((w % 1) + 1) % 1) * cv.height)));
    return px[(y * cv.width + x) * 4 + 3];
  };
  return { texture, alphaAt };
}

// the body: its parts (skinned meshes, fixed), the seams between them, and the clips
async function loadBody(config) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.endsWith('.dds') ? BASE + 'textures/' + url.split('/').pop().replace('.dds', '.png') : url));
  const loader = new GLTFLoader(manager);
  const anim = await loader.loadAsync(BASE + config.animations);
  const parts = [];
  for (const name of config.parts) {
    const gltf = await loader.loadAsync(`${BASE}${name}.glb`);
    gltf.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      fixSecondBones(o);
      o.material.map.flipY = false;
      const { texture, alphaAt } = solidTexture(o.material.map);
      const pos = o.geometry.getAttribute('position');
      parts.push({ mesh: o, root: gltf.scene, mixer: new THREE.AnimationMixer(gltf.scene), uv: o.geometry.getAttribute('uv'), alphaAt, texture,
        bind: Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]) });
    });
  }
  // seams: vertices of different parts at the same rest place are welded after posing
  const key = (p) => p.map((c) => Math.round(c * 333)).join(',');
  const groups = new Map();
  parts.forEach((part, m) => part.bind.forEach((p, i) => { const k = key(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ m, i }); }));
  const seams = [...groups.values()].filter((g) => new Set(g.map((e) => e.m)).size > 1);
  return { parts, seams, clips: anim.animations };
}

// one posed frame of the body: one geometry per part, at `time` seconds of `clip`
function pose({ parts, seams }, clip, time) {
  const out = [], hints = [];
  for (const part of parts) {
    part.mixer.stopAllAction();
    part.mixer.clipAction(clip).reset().play();
    part.mixer.setTime(time);
    part.root.updateMatrixWorld(true);
    const o = part.mesh;
    o.skeleton.update();
    const pos = o.geometry.getAttribute('position'), nrm = o.geometry.getAttribute('normal');
    const arr = new Float32Array(pos.count * 3), hint = [];
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      w.copy(v).addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, i), 0.01);
      o.applyBoneTransform(i, v); o.applyBoneTransform(i, w);
      v.applyMatrix4(o.matrixWorld); w.applyMatrix4(o.matrixWorld);
      arr.set([v.x, v.y, v.z], i * 3);
      hint.push(w.clone().sub(v));
    }
    out.push(arr); hints.push(hint);
  }
  // the index (on the first frame): no triangles on transparent texels, each triangle faces like its vertex normals
  parts.forEach((part, m) => {
    if (part.index) return;
    const src = part.mesh.geometry, count = src.getAttribute('position').count;
    const index = src.index ? Array.from(src.index.array) : [...Array(count).keys()];
    const kept = [], P = (k) => new THREE.Vector3(out[m][k * 3], out[m][k * 3 + 1], out[m][k * 3 + 2]);
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      const u = (part.uv.getX(a) + part.uv.getX(b) + part.uv.getX(c)) / 3, w = (part.uv.getY(a) + part.uv.getY(b) + part.uv.getY(c)) / 3;
      if (part.alphaAt(u, w) < 128) continue;
      const fn = P(b).sub(P(a)).cross(P(c).sub(P(a)));
      const avg = hints[m][a].clone().add(hints[m][b]).add(hints[m][c]);
      if (fn.dot(avg) < 0) kept.push(a, c, b); else kept.push(a, b, c);
    }
    part.index = kept;
  });
  for (const g of seams) {
    let x = 0, y = 0, z = 0;
    for (const e of g) { x += out[e.m][e.i * 3]; y += out[e.m][e.i * 3 + 1]; z += out[e.m][e.i * 3 + 2]; }
    for (const e of g) out[e.m].set([x / g.length, y / g.length, z / g.length], e.i * 3);
  }
  // smooth normals over the whole body
  const nkey = (a, i) => `${Math.round(a[i * 3] * 500)},${Math.round(a[i * 3 + 1] * 500)},${Math.round(a[i * 3 + 2] * 500)}`;
  const acc = new Map(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  parts.forEach((part, m) => {
    const a = out[m], idx = part.index;
    for (let t = 0; t < idx.length; t += 3) {
      A.fromArray(a, idx[t] * 3); B.fromArray(a, idx[t + 1] * 3); C.fromArray(a, idx[t + 2] * 3);
      const fn = B.clone().sub(A).cross(C.clone().sub(A));
      for (const k of [idx[t], idx[t + 1], idx[t + 2]]) { const kk = nkey(a, k); acc.set(kk, (acc.get(kk) ?? new THREE.Vector3()).add(fn)); }
    }
  });
  return parts.map((part, m) => {
    const a = out[m], n = new Float32Array(a.length);
    for (let i = 0; i < a.length / 3; i++) n.set((acc.get(nkey(a, i)) ?? new THREE.Vector3(0, 1, 0)).clone().normalize().toArray(), i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('uv', part.uv);
    g.setIndex(part.index);
    return g;
  });
}

// spawns the human at (x, z), or at the start of the world
export async function addCharacter(world, at) {
  const gpu = getResource(world, Gpu), settings = getResource(world, Settings);
  // the fine pass (systems/render.js): its camera and the uniforms all its materials share
  gpu.fine = {
    camera: new THREE.OrthographicCamera(),
    uniforms: { tNorm: { value: null }, uLowSize: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() },
      uOffset: gpu.blit.uniforms.uOffset, uScale: gpu.blit.uniforms.uScale, uMargin: gpu.blit.uniforms.uMargin },
  };
  gpu.fine.camera.layers.set(2);
  const config = await (await fetch(BASE + 'character.json')).json();
  const body = await loadBody(config);
  const clips = {};
  for (const state of ['idle', 'walk', 'run', 'jumpStart', 'jumpUp', 'jumpDown', 'jumpLand', 'attack1', 'attack2', 'attack3', 'attack4']) {
    const clip = body.clips.find((a) => a.name === config.clips[state]);
    if (!clip) throw new Error(`character: no clip ${config.clips[state]} in ${config.animations}`);
    // a loop leaves out its last frame (it is the first one again); a part of the jump or a hit plays once, so it keeps it
    const once = /^(jump|attack)/.test(state), n = Math.max(1, Math.round(clip.duration * config.bakeFps)) + (once ? 1 : 0);
    clips[state] = Array.from({ length: n }, (_, k) => pose(body, clip, Math.min(clip.duration - 1e-3, k / config.bakeFps)));
  }
  const group = new THREE.Group();
  const meshes = body.parts.map((part, m) => {
    const mesh = new THREE.Mesh(clips.idle[0][m], shaderMaterial(gpu.shared, S.FINE_VERT, S.FINE_FRAG, { uMap: { value: part.texture }, ...gpu.fine.uniforms }, { side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    mesh.layers.set(1);      // casts a shadow, not in the G-buffer
    mesh.layers.enable(2);   // the fine pass
    group.add(mesh);
    return mesh;
  });
  // feet on the ground, HEIGHT tall
  const box = new THREE.Box3().setFromObject(group), k = HEIGHT / (box.max.y - box.min.y);
  group.scale.setScalar(k);
  gpu.scene.add(group);
  gpu.shadowsDirty = true;
  const [x, z] = at ?? [settings.land.start[0], settings.land.start[settings.land.start.length - 1]];
  return spawn(world, [Player, { group, meshes, clips, fps: config.bakeFps, foot: -box.min.y * k, x, z, rot: 0, state: 'idle', t: 0 }]);
}
