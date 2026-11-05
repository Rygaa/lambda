// The player character: the FlyFF male of documentation/building/tools/scene (web/char/).
// The game material has no skinning, so each clip is baked once at load into frames of posed vertices
// (bakeFps a second). A character on screen swaps its geometries to the frame of its animation.
// The fixes of the scene tool are kept: fixSecondBones, triangles on transparent texels dropped, faces turned the
// right way, transparent texels filled, seams welded and normals smoothed over the whole body.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { preparePixelTexture, type PixelRenderer } from "../engine/renderer/index.ts";
import type { AnimState } from "../shared/components.ts";
import type { CharacterConfig } from "../shared/config.ts";

const BASE = "assets/characters/player/";

// The converter gets the second bone of a vertex wrong: when the two bones of a vertex are not parent and child,
// keep the bone nearest to the vertex and give the other weight to its parent or child, whichever is nearer.
function fixSecondBones(o: any) {
  const bones: any[] = o.skeleton.bones;
  const rest = bones.map((_, i) => new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[i].clone().invert()));
  const idx = new Map(bones.map((b, i) => [b, i]));
  const neighbors = (i: number) => [bones[i].parent, ...bones[i].children].map((b: any) => idx.get(b)).filter((k: any) => k !== undefined) as number[];
  const pos = o.geometry.getAttribute("position"), si = o.geometry.getAttribute("skinIndex"), sw = o.geometry.getAttribute("skinWeight");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const inf: [number, number][] = [];
    for (let t = 0; t < 4; t++) if (sw.getComponent(i, t) > 0) inf.push([si.getComponent(i, t), sw.getComponent(i, t)]);
    if (inf.length !== 2) continue;
    const [[a, wa], [b, wb]] = inf as [[number, number], [number, number]];
    if (a !== b && neighbors(a).includes(b)) continue;
    v.fromBufferAttribute(pos, i);
    const keep = a === b ? a : v.distanceTo(rest[a]!) <= v.distanceTo(rest[b]!) ? a : b;
    const near = neighbors(keep).sort((x, y) => v.distanceTo(rest[x]!) - v.distanceTo(rest[y]!))[0];
    if (near === undefined) continue;
    const wKeep = a === b ? wa : keep === a ? wa : wb, wOther = a === b ? wb : keep === a ? wb : wa;
    si.setXYZW(i, keep, near, 0, 0);
    sw.setXYZW(i, wKeep, wOther, 0, 0);
  }
}

// The game material ignores alpha: give each transparent texel the color of an opaque neighbour.
function solidTexture(map: THREE.Texture) {
  const img: any = map.image;
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext("2d")!;
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, cv.width, cv.height).data;
  const filled = new Uint8ClampedArray(px);
  const opaque = new Uint8Array(cv.width * cv.height);
  for (let i = 0; i < opaque.length; i++) opaque[i] = px[i * 4 + 3]! >= 128 ? 1 : 0;
  for (let pass = 0; pass < 64; pass++) {
    let changed = 0;
    const next = opaque.slice();
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = y * cv.width + x;
      if (opaque[i]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = ((y + dy + cv.height) % cv.height) * cv.width + ((x + dx + cv.width) % cv.width);
        if (opaque[k]) { r += filled[k * 4]!; g += filled[k * 4 + 1]!; b += filled[k * 4 + 2]!; c++; }
      }
      if (c) { filled[i * 4] = r / c; filled[i * 4 + 1] = g / c; filled[i * 4 + 2] = b / c; next[i] = 1; changed++; }
    }
    opaque.set(next);
    if (!changed) break;
  }
  for (let i = 0; i < opaque.length; i++) filled[i * 4 + 3] = 255;
  const fcv = document.createElement("canvas");
  fcv.width = cv.width;
  fcv.height = cv.height;
  fcv.getContext("2d")!.putImageData(new ImageData(filled, cv.width, cv.height), 0, 0);
  const texture = new THREE.CanvasTexture(fcv);
  texture.flipY = false;
  const alphaAt = (u: number, w: number) => {
    const x = Math.min(cv.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * cv.width)));
    const y = Math.min(cv.height - 1, Math.max(0, Math.floor((((w % 1) + 1) % 1) * cv.height)));
    return px[(y * cv.width + x) * 4 + 3]!;
  };
  return { texture, alphaAt };
}

type Part = { name: string; mesh: any; root: THREE.Object3D; mixer: THREE.AnimationMixer; uv: THREE.BufferAttribute; index: number[] | null; alphaAt: (u: number, v: number) => number; material: THREE.Material; bind: number[][] };
export type BakedClip = { frames: THREE.BufferGeometry[][]; duration: number; loop: boolean };
export type CharacterLibrary = { clips: Record<AnimState, BakedClip>; materials: THREE.Material[]; fps: number };

export async function loadCharacterLibrary(renderer: PixelRenderer, config: CharacterConfig): Promise<CharacterLibrary> {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.endsWith(".dds") ? BASE + "textures/" + url.split("/").pop()!.replace(".dds", ".png") : url));
  const loader = new GLTFLoader(manager);
  const anim = await loader.loadAsync(BASE + config.animations);
  const parts: Part[] = [];
  for (const name of config.parts) {
    const gltf = await loader.loadAsync(`${BASE}${name}.glb`);
    const root = gltf.scene;
    root.traverse((o: any) => {
      if (!o.isSkinnedMesh) return;
      fixSecondBones(o);
      const map = o.material.map as THREE.Texture;
      map.flipY = false;
      const { texture, alphaAt } = solidTexture(map);
      const material = renderer.materials.solid({ map: preparePixelTexture(texture) });
      // both sides: through the small gaps of the body (waist, wrists) the inside shows, not the grass behind
      material.side = THREE.DoubleSide;
      material.uniforms.uChar!.value = 1;
      const pos = o.geometry.getAttribute("position");
      parts.push({
        name, mesh: o, root, mixer: new THREE.AnimationMixer(root), uv: o.geometry.getAttribute("uv"), index: null, alphaAt, material,
        bind: Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]),
      });
    });
  }

  // Seams: vertices of different parts at the same rest place are welded together after posing.
  const key = (p: number[]) => p.map((c) => Math.round(c * 333)).join(",");
  const seamGroups = new Map<string, { m: number; i: number }[]>();
  parts.forEach((part, m) => part.bind.forEach((p, i) => {
    const k = key(p);
    if (!seamGroups.has(k)) seamGroups.set(k, []);
    seamGroups.get(k)!.push({ m, i });
  }));
  const seams = [...seamGroups.values()].filter((g) => new Set(g.map((e) => e.m)).size > 1);

  // One posed frame: positions of every part, then the shared index (set on the first frame), welds and normals.
  const pose = (clip: THREE.AnimationClip | null, time: number) => {
    const out: Float32Array[] = [];
    const normalsHint: THREE.Vector3[][] = [];
    for (const part of parts) {
      part.mixer.stopAllAction();
      if (clip) {
        const action = part.mixer.clipAction(clip);
        action.reset().play();
        part.mixer.setTime(time);
      }
      part.root.updateMatrixWorld(true);
      const o = part.mesh;
      o.skeleton.update();
      const pos = o.geometry.getAttribute("position"), nrm = o.geometry.getAttribute("normal");
      const arr = new Float32Array(pos.count * 3);
      const hint: THREE.Vector3[] = [];
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        w.copy(v).addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, i), 0.01);
        o.applyBoneTransform(i, v);
        o.applyBoneTransform(i, w);
        v.applyMatrix4(o.matrixWorld);
        w.applyMatrix4(o.matrixWorld);
        arr.set([v.x, v.y, v.z], i * 3);
        hint.push(w.clone().sub(v));
      }
      out.push(arr);
      normalsHint.push(hint);
    }
    // the index: drop triangles on transparent texels, turn triangles to face like their vertex normals
    parts.forEach((part, m) => {
      if (part.index) return;
      const src = part.mesh.geometry;
      const count = src.getAttribute("position").count;
      const index: number[] = src.index ? Array.from(src.index.array as ArrayLike<number>) : [...Array(count).keys()];
      const kept: number[] = [];
      const P = (k: number) => new THREE.Vector3(out[m]![k * 3], out[m]![k * 3 + 1], out[m]![k * 3 + 2]);
      for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [index[t]!, index[t + 1]!, index[t + 2]!];
        const u = (part.uv.getX(a) + part.uv.getX(b) + part.uv.getX(c)) / 3, w = (part.uv.getY(a) + part.uv.getY(b) + part.uv.getY(c)) / 3;
        if (part.alphaAt(u, w) < 128) continue;
        const fn = P(b).sub(P(a)).cross(P(c).sub(P(a)));
        const avg = normalsHint[m]![a]!.clone().add(normalsHint[m]![b]!).add(normalsHint[m]![c]!);
        if (fn.dot(avg) < 0) kept.push(a, c, b);
        else kept.push(a, b, c);
      }
      part.index = kept;
    });
    for (const g of seams) {
      let x = 0, y = 0, z = 0;
      for (const e of g) { x += out[e.m]![e.i * 3]!; y += out[e.m]![e.i * 3 + 1]!; z += out[e.m]![e.i * 3 + 2]!; }
      x /= g.length; y /= g.length; z /= g.length;
      for (const e of g) out[e.m]!.set([x, y, z], e.i * 3);
    }
    // smooth normals over the whole body (vertices at the same place share one normal)
    const nkey = (a: Float32Array, i: number) => `${Math.round(a[i * 3]! * 500)},${Math.round(a[i * 3 + 1]! * 500)},${Math.round(a[i * 3 + 2]! * 500)}`;
    const acc = new Map<string, THREE.Vector3>();
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    parts.forEach((part, m) => {
      const a = out[m]!, idx = part.index!;
      for (let t = 0; t < idx.length; t += 3) {
        A.fromArray(a, idx[t]! * 3); B.fromArray(a, idx[t + 1]! * 3); C.fromArray(a, idx[t + 2]! * 3);
        const fn = B.clone().sub(A).cross(C.clone().sub(A));
        for (const k of [idx[t]!, idx[t + 1]!, idx[t + 2]!]) {
          const kk = nkey(a, k);
          acc.set(kk, (acc.get(kk) ?? new THREE.Vector3()).add(fn));
        }
      }
    });
    return parts.map((part, m) => {
      const a = out[m]!;
      const n = new Float32Array(a.length);
      for (let i = 0; i < a.length / 3; i++) {
        const v = (acc.get(nkey(a, i)) ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
        n.set([v.x, v.y, v.z], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(a, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
      g.setAttribute("uv", part.uv);
      g.setIndex(part.index!);
      g.computeBoundingSphere();
      return g;
    });
  };

  // the first pose fixes the index, from the idle clip
  const fps = config.bakeFps;
  const clips = {} as Record<AnimState, BakedClip>;
  for (const state of ["idle", "walk", "attack", "hit", "dead"] as AnimState[]) {
    const clip = anim.animations.find((a) => a.name === config.clips[state]);
    if (!clip) throw new Error(`No clip ${config.clips[state]} in ${config.animations}`);
    const count = Math.max(1, Math.round(clip.duration * fps));
    const frames: THREE.BufferGeometry[][] = [];
    for (let k = 0; k < count; k++) frames.push(pose(clip, Math.min(clip.duration - 1e-3, k / fps)));
    clips[state] = { frames, duration: clip.duration, loop: state === "idle" || state === "walk" };
  }
  return { clips, materials: parts.map((p) => p.material), fps };
}

// One character on screen. setPose picks the frame of an animation at a time in seconds.
export function createCharacter(library: CharacterLibrary) {
  const group = new THREE.Group();
  const meshes = library.materials.map((material, m) => {
    const mesh = new THREE.Mesh(library.clips.idle.frames[0]![m], material);
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  const setPose = (state: AnimState, time: number, speed = 1) => {
    const clip = library.clips[state];
    const n = clip.frames.length;
    let k = Math.floor(time * speed * library.fps);
    k = clip.loop ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k));
    const frame = clip.frames[k]!;
    meshes.forEach((mesh, m) => (mesh.geometry = frame[m]!));
  };
  return { group, setPose };
}
