// Temporary: game view, plain view, and scene, with the textures of the plans (slot.data = PNG data URL),
// plus characters from a chars/*.js file (FlyFF export: joints in Blender coordinates, colored parts).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildAssetObject, buildGroundPatch } from "../vendor/packages/asset-format/src/build.ts";
import { buildShapeGeometry } from "../vendor/packages/asset-format/src/geometry.ts";
import { assetFootprint } from "../vendor/packages/asset-format/src/schema.ts";
import { PixelRenderer, preparePixelTexture } from "../vendor/packages/renderer/src/index.ts";

function toAsset(plan: any, id: string): any {
  return {
    ...plan, id, kind: "building",
    shapes: plan.shapes.map((s: any) => ({ tilt: 0, role: null, ...s, faces: Object.fromEntries(s.faces.map((f: any) => [f.face, f.texture])) })),
    textures: plan.textures.map((t: any) => ({ ...t, file: t.file ?? null, prompt: null, updatedAt: "" })),
  };
}

async function loadTextures(plan: any) {
  const loader = new THREE.TextureLoader();
  const map = new Map<string, THREE.Texture>();
  for (const slot of plan.textures) {
    if (!slot.data) continue;
    const t = preparePixelTexture(await loader.loadAsync(slot.data));
    t.repeat.set(1 / slot.widthM, 1 / slot.heightM);
    map.set(slot.name, t);
  }
  return map;
}

// Blender (x, y, z), z up, front -y  ->  three (x, z, -y), y up, front +z
const b2t = (x: number, y: number, z: number) => [x, z, -y];

function buildCharacter(data: any, materials: any) {
  const world: Record<string, number[]> = { root: [0, 0, 0] };
  const at = (name: string): number[] => {
    if (world[name]) return world[name];
    const [parent, off] = data.joints[name];
    const p = at(parent);
    return (world[name] = [p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
  };
  const group = new THREE.Group();
  const byColor = new Map<string, THREE.Material>();
  for (const part of data.parts) {
    const j = at(part.joint);
    const pos: number[] = [], nrm: number[] = [];
    for (let i = 0; i < part.pos.length; i += 3) {
      pos.push(...b2t(part.pos[i] + j[0], part.pos[i + 1] + j[1], part.pos[i + 2] + j[2]));
      nrm.push(...b2t(part.nrm[i], part.nrm[i + 1], part.nrm[i + 2]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
    g.setIndex(part.idx);
    let m = byColor.get(part.color);
    if (!m) { m = materials.solid({ color: data.palette[part.color][0] }); byColor.set(part.color, m!); }
    group.add(new THREE.Mesh(g, m));
  }
  return group;
}

// A FlyFF character from char/: the skinned parts posed with one frame of a clip of mvr_male.glb, then frozen
// into plain meshes (the game material has no skinning). makeMaterial gets each part's texture.
// The right side of some parts lost its second bone weights in the export (the wrist and ankle then fold out when
// the hand or foot turns). The parts are symmetric: give each right vertex the weights of its left twin.
function mirrorWeights(o: any) {
  const pos = o.geometry.getAttribute("position"), si = o.geometry.getAttribute("skinIndex"), sw = o.geometry.getAttribute("skinWeight");
  const names: string[] = o.skeleton.bones.map((b: any) => b.name);
  // GLTFLoader turns the spaces of node names into "_" (Bip02_L_Hand)
  const swap = (n: string) => n.replace(/([ _])([LR])([ _])/, (_m, a, side, b) => a + (side === "L" ? "R" : "L") + b);
  const left: number[] = [];
  for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 1e-3) left.push(i);
  let fixed = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) >= -1e-3) continue;
    let best = -1, bd = 2e-3;
    for (const k of left) {
      const d = Math.hypot(pos.getX(k) + pos.getX(i), pos.getY(k) - pos.getY(i), pos.getZ(k) - pos.getZ(i));
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) continue;
    for (let t = 0; t < 4; t++) {
      const w = sw.getComponent(best, t);
      const idx = names.indexOf(swap(names[si.getComponent(best, t)]));
      si.setComponent(i, t, w > 0 && idx >= 0 ? idx : 0);
      sw.setComponent(i, t, w > 0 && idx >= 0 ? w : 0);
    }
    fixed++;
  }
  return fixed;
}

// At the wrists and ankles some vertices are bound to one bone only, so they fold out when the hand or foot turns.
// Rebind them by where they sit: above the joint they follow the upper bone (forearm, calf), below it the lower bone
// (hand, foot), and within 2 cm of the joint they blend both.
function rebindJoint(o: any, upperName: string, lowerName: string) {
  const bones: any[] = o.skeleton.bones;
  const ui = bones.findIndex((b) => b.name === upperName), li = bones.findIndex((b) => b.name === lowerName);
  if (ui < 0 || li < 0) return 0;
  const restPos = (i: number) => new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[i].clone().invert());
  const up = restPos(ui), joint = restPos(li);
  const axis = joint.clone().sub(up).normalize();   // from the upper joint toward the lower one
  const pos = o.geometry.getAttribute("position"), si = o.geometry.getAttribute("skinIndex"), sw = o.geometry.getAttribute("skinWeight");
  const v = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    let onPair = false;
    for (let t = 0; t < 4; t++) if (sw.getComponent(i, t) > 0 && (si.getComponent(i, t) === ui || si.getComponent(i, t) === li)) onPair = true;
    if (!onPair) continue;
    v.fromBufferAttribute(pos, i);
    const d = v.clone().sub(joint).dot(axis);         // > 0: past the joint (hand side), < 0: upper side
    const wl = Math.min(1, Math.max(0, (d + 0.02) / 0.04));
    si.setXYZW(i, li, ui, 0, 0);
    sw.setXYZW(i, wl, 1 - wl, 0, 0);
    n++;
  }
  return n;
}

// The converter gets the second bone of a vertex wrong: a wrist is bound to the forearm and the spine, an ankle to
// the calf and the pelvis, or the same bone twice. When the two bones of a vertex are not parent and child, keep the
// bone nearest to the vertex and give the other weight to its parent or child, whichever is nearer.
function fixSecondBones(o: any) {
  const bones: any[] = o.skeleton.bones;
  const rest = bones.map((_, i) => new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[i].clone().invert()));
  const idx = new Map(bones.map((b, i) => [b, i]));
  const neighbors = (i: number) => [bones[i].parent, ...bones[i].children].map((b: any) => idx.get(b)).filter((k: any) => k !== undefined) as number[];
  const pos = o.geometry.getAttribute("position"), si = o.geometry.getAttribute("skinIndex"), sw = o.geometry.getAttribute("skinWeight");
  const v = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    const inf: [number, number][] = [];
    for (let t = 0; t < 4; t++) if (sw.getComponent(i, t) > 0) inf.push([si.getComponent(i, t), sw.getComponent(i, t)]);
    if (inf.length !== 2) continue;
    const [[a, wa], [b, wb]] = inf;
    if (a !== b && neighbors(a).includes(b)) continue;
    v.fromBufferAttribute(pos, i);
    const keep = a === b ? a : (v.distanceTo(rest[a]) <= v.distanceTo(rest[b]) ? a : b);
    const near = neighbors(keep).sort((x, y) => v.distanceTo(rest[x]) - v.distanceTo(rest[y]))[0];
    if (near === undefined) continue;
    const wKeep = a === b ? wa : keep === a ? wa : wb, wOther = a === b ? wb : keep === a ? wb : wa;
    si.setXYZW(i, keep, near, 0, 0);
    sw.setXYZW(i, wKeep, wOther, 0, 0);
    n++;
  }
  return n;
}

const FLYFF_PARTS = ["part_malehead01", "part_malehair01", "part_maleupper", "part_malelower", "part_malehand", "part_malefoot"];
async function loadFlyff(clip: string, time: number, makeMaterial: (map: THREE.Texture) => THREE.Material) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.endsWith(".dds") ? "char/textures/" + url.split("/").pop()!.replace(".dds", ".png") : url));
  const loader = new GLTFLoader(manager);
  const anim = await loader.loadAsync("char/mvr_male.glb");
  const clipObj = anim.animations.find((a) => a.name === clip);
  if (!clipObj && clip !== "none") throw new Error("no clip " + clip);
  const group = new THREE.Group();
  for (const name of FLYFF_PARTS) {
    const gltf = await loader.loadAsync(`char/${name}.glb`);
    const root = gltf.scene;
    if (clipObj) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clipObj).play();
      mixer.setTime(time);
    }
    root.updateMatrixWorld(true);
    root.traverse((o: any) => {
      if (!o.isSkinnedMesh) return;
      const mirrored = fixSecondBones(o);
      o.skeleton.update();
      const src = o.geometry;
      const pos = src.getAttribute("position");
      const nrmA = src.getAttribute("normal");
      const out: number[] = [];
      const vn: THREE.Vector3[] = [];   // the posed vertex normals, to find triangles wound the wrong way
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        w.copy(v).addScaledVector(new THREE.Vector3().fromBufferAttribute(nrmA, i), 0.01);
        o.applyBoneTransform(i, v);
        o.applyBoneTransform(i, w);
        v.applyMatrix4(o.matrixWorld);
        w.applyMatrix4(o.matrixWorld);
        out.push(v.x, v.y, v.z);
        vn.push(w.clone().sub(v));
      }
      const map = o.material.map as THREE.Texture;
      map.flipY = false;
      // The game material has no alpha test: drop the triangles that fall on transparent texels.
      const img: any = map.image;
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext("2d")!;
      cx.drawImage(img, 0, 0);
      const imgData = cx.getImageData(0, 0, cv.width, cv.height);
      const px = imgData.data;
      // The game material ignores alpha, so a transparent texel shows its own color (the dots on the waistband).
      // Give each transparent texel the color of an opaque neighbour, then make the texture opaque.
      const filled = new Uint8ClampedArray(px);
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
            const nx = (x + dx + cv.width) % cv.width, ny = (y + dy + cv.height) % cv.height, k = ny * cv.width + nx;
            if (opaque[k]) { r += filled[k * 4]; g += filled[k * 4 + 1]; b += filled[k * 4 + 2]; c++; }
          }
          if (c) { filled[i * 4] = r / c; filled[i * 4 + 1] = g / c; filled[i * 4 + 2] = b / c; next[i] = 1; changed++; }
        }
        opaque.set(next);
        if (!changed) break;
      }
      for (let i = 0; i < opaque.length; i++) filled[i * 4 + 3] = 255;
      const fcv = document.createElement("canvas");
      fcv.width = cv.width; fcv.height = cv.height;
      fcv.getContext("2d")!.putImageData(new ImageData(filled, cv.width, cv.height), 0, 0);
      const solidMap = new THREE.CanvasTexture(fcv);
      solidMap.flipY = false;
      solidMap.colorSpace = THREE.SRGBColorSpace;
      const uv = src.getAttribute("uv");
      const alphaAt = (u: number, w: number) => {
        const x = Math.min(cv.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * cv.width)));
        const y = Math.min(cv.height - 1, Math.max(0, Math.floor((((w % 1) + 1) % 1) * cv.height)));
        return px[(y * cv.width + x) * 4 + 3];
      };
      const index = src.index ? Array.from(src.index.array as ArrayLike<number>) : [...Array(pos.count).keys()];
      const kept: number[] = [];
      let flipped = 0;
      for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
        const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, w = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
        if (alphaAt(u, w) < 128) continue;
        // keep the triangle facing the same way as its vertex normals (the game draws front faces only)
        const P = (k: number) => new THREE.Vector3(out[k * 3], out[k * 3 + 1], out[k * 3 + 2]);
        const fn = P(b).sub(P(a)).cross(P(c).sub(P(a)));
        const avg = vn[a].clone().add(vn[b]).add(vn[c]);
        if (fn.dot(avg) < 0) { kept.push(a, c, b); flipped++; } else kept.push(a, b, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
      g.setAttribute("uv", uv);
      g.setIndex(kept);
      console.log(`flyff ${name}: kept ${kept.length / 3} of ${index.length / 3} triangles, turned ${flipped}, second bones fixed: ${mirrored}`);
      const mesh = new THREE.Mesh(g, makeMaterial(solidMap));
      mesh.name = name;
      mesh.userData.bindY = Array.from({ length: pos.count }, (_, i) => pos.getY(i));
      mesh.userData.bind = Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
      group.add(mesh);
    });
  }
  weldSeams(group.children as THREE.Mesh[]);
  smoothNormals(group.children as THREE.Mesh[]);
  return group;
}

// Where two parts meet (waist, wrists, ankles, neck), their edge vertices are at the same place in the rest pose,
// but the export gave them different bone weights in each part, so once posed they come apart and leave a slit
// (through it the inside of the shorts showed at the waist). Every vertex that shares its rest place with a vertex
// of another part takes the average of their posed places, so the parts stay joined.
function weldSeams(meshes: THREE.Mesh[]) {
  const key = (p: number[]) => p.map((c) => Math.round(c * 333)).join(",");
  const groups = new Map<string, { m: number; i: number }[]>();
  meshes.forEach((m, mi) => (m.userData.bind as number[][]).forEach((p, i) => {
    const k = key(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ m: mi, i });
  }));
  let welded = 0;
  for (const g of groups.values()) {
    if (new Set(g.map((e) => e.m)).size < 2) continue;
    const avg = new THREE.Vector3();
    for (const e of g) avg.add(new THREE.Vector3().fromBufferAttribute(meshes[e.m].geometry.getAttribute("position") as THREE.BufferAttribute, e.i));
    avg.divideScalar(g.length);
    for (const e of g) (meshes[e.m].geometry.getAttribute("position") as THREE.BufferAttribute).setXYZ(e.i, avg.x, avg.y, avg.z);
    welded += g.length;
  }
  console.log(`flyff seams: ${welded} vertices welded`);
}

// Smooth normals over the whole character: vertices at the same place (texture seams, and where two parts meet,
// such as the calf and the foot) share one normal, so the game draws no outline along those seams.
function smoothNormals(meshes: THREE.Mesh[]) {
  const key = (x: number, y: number, z: number) => `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;
  const acc = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position"), idx = m.geometry.index!.array;
    for (let t = 0; t < idx.length; t += 3) {
      a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
      const fn = b.clone().sub(a).cross(c.clone().sub(a));   // length = 2 x area, so big faces count more
      for (const v of [a, b, c]) {
        const k = key(v.x, v.y, v.z);
        acc.set(k, (acc.get(k) ?? new THREE.Vector3()).add(fn));
      }
    }
  }
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    const nrm: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const n = (acc.get(key(pos.getX(i), pos.getY(i), pos.getZ(i))) ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
      nrm.push(n.x, n.y, n.z);
    }
    m.geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  }
}

async function capture(renderer: any) {
  await new Promise((r) => setTimeout(r, 2500));
  const blob = await renderer.capture();
  renderer.dispose();
  return await new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(f.result as string); f.readAsDataURL(blob); });
}

// chars: [{ data, x, z, rot }] placed in scene coordinates.
// mode "all": everything; "charsHidden": the characters only cast shadows; "charsOnly": only the characters show
// (the buildings still cast shadows on them, there is no ground). Returns the image and the camera snap error.
async function sceneView(plans: any[], gap: number, rotation = 0, chars: any[] = [], target: any = null, clouds = true, mode = "all"): Promise<any> {
  const container = document.getElementById("view")!;
  container.innerHTML = "";
  const renderer = new PixelRenderer(container, { shadowRadius: 14, clouds });
  const assets = plans.map((p, k) => toAsset(p, `b${k}`));
  const boxes = assets.map((a) => assetFootprint(a));
  const total = boxes.reduce((s, b) => s + b.maxX - b.minX, 0) + gap * (boxes.length - 1);
  let x = -total / 2;
  const placed: any[] = [];
  const root = new THREE.Group();
  root.rotation.y = THREE.MathUtils.degToRad(rotation);
  let topY = 0;
  for (let k = 0; k < assets.length; k++) {
    const b = boxes[k]!;
    const dx = x - b.minX, dz = -(b.minZ + b.maxZ) / 2;
    const model = renderer.castShadows(buildAssetObject(assets[k], await loadTextures(plans[k]), renderer.materials));
    if (mode === "charsOnly") model.traverse((o: any) => o.layers.set(1));
    model.position.set(dx, 0, dz);
    root.add(model);
    topY = Math.max(topY, new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()).y);
    placed.push({ minX: b.minX + dx, maxX: b.maxX + dx, minZ: b.minZ + dz, maxZ: b.maxZ + dz });
    x += b.maxX - b.minX + gap;
  }
  for (const c of chars) {
    const built = c.flyff
      ? await loadFlyff(c.flyff.clip, c.flyff.time, (map) => {
          // both sides: through the small gaps of the body (waist, wrists) the inside shows, not the grass behind
          const m = renderer.materials.solid({ map: preparePixelTexture(map) });
          m.side = THREE.DoubleSide;
          m.uniforms.uChar.value = 1;
          return m;
        })
      : buildCharacter(c.data, renderer.materials);
    const model = renderer.castShadows(built);
    if (mode === "charsHidden") model.traverse((o: any) => o.layers.set(1));
    model.position.set(c.x, 0, c.z);
    model.rotation.y = THREE.MathUtils.degToRad(c.rot ?? 0);
    root.add(model);
    placed.push({ minX: c.x - 0.3, maxX: c.x + 0.3, minZ: c.z - 0.3, maxZ: c.z + 0.3 });
  }
  console.log("layout " + JSON.stringify(placed.map((p) => [+p.minX.toFixed(2), +p.maxX.toFixed(2), +p.minZ.toFixed(2), +p.maxZ.toFixed(2)])));
  const half = 30;
  const rot = (px: number, pz: number) => { const a = -root.rotation.y; return [px * Math.cos(a) + pz * Math.sin(a), -px * Math.sin(a) + pz * Math.cos(a)]; };
  const under = (px: number, pz: number) => { const [qx, qz] = rot(px, pz); return placed.some((b) => qx > b.minX - 0.1 && qx < b.maxX + 0.1 && qz > b.minZ - 0.1 && qz < b.maxZ + 0.1); };
  if (mode !== "charsOnly") renderer.scene.add(
    buildGroundPatch(renderer.materials.ground({ row: "grass" }), half * 2),
    renderer.createGroundCover({ minX: -half, maxX: half, minZ: -half, maxZ: half, groundAt: (px, pz) => (under(px, pz) ? null : "grass") }),
  );
  renderer.scene.add(root);
  renderer.setTarget(target ?? { x: 0, y: plans.length === 1 ? topY : 1.2, z: 0 });
  const r: any = renderer;
  const url = await capture(renderer);
  return mode === "all" ? url : { url, ex: r.snapError.x, ey: r.snapError.y, scale: r.pixelScale };
}

async function angleView(plan: any, from: number[], target: number[], halfWidth: number): Promise<string> {
  const W = 800, H = 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#9cc8f0");
  scene.add(new THREE.HemisphereLight("#ffffff", "#8080a0", 2.0));
  const sun = new THREE.DirectionalLight("#ffffff", 1.5);
  sun.position.set(-0.4, 1, 0.6);
  scene.add(sun);
  const textures = await loadTextures(plan);
  const slots = new Map(plan.textures.map((s: any) => [s.name, s]));
  for (const shape of plan.shapes) {
    const faces = Object.fromEntries(shape.faces.map((f: any) => [f.face, f.texture]));
    const { geometry, groups } = buildShapeGeometry({ tilt: 0, ...shape });
    const materials: THREE.Material[] = [];
    for (const g of groups) {
      geometry.addGroup(g.start, g.count, materials.length);
      const tex = textures.get(faces[g.face]);
      const slot: any = slots.get(faces[g.face]);
      materials.push(tex ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ color: slot?.color ?? "#ff00ff" }));
    }
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(...(shape.position as [number, number, number]));
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(THREE.MathUtils.degToRad(shape.tilt ?? 0), THREE.MathUtils.degToRad(shape.rotationY), 0);
    scene.add(mesh);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: "#7fbf5a" }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, (halfWidth * H) / W, (-halfWidth * H) / W, 0.1, 400);
  const t = new THREE.Vector3(...(target as [number, number, number]));
  camera.position.copy(t).addScaledVector(new THREE.Vector3(...(from as [number, number, number])).normalize(), 50);
  camera.lookAt(t);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
}
Object.assign(window, { sceneView, angleView });

// A plain close view of one character: mode "parts" (flat colors) or "screen" (textured, tex = name -> data URL).
async function charView(data: any, mode: string, texData: Record<string, string>, from: number[], halfHeight: number): Promise<string> {
  const W = 600, H = 800;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#9cc8f0");
  scene.add(new THREE.HemisphereLight("#ffffff", "#8080a0", 2.2));
  const sun = new THREE.DirectionalLight("#ffffff", 1.4);
  sun.position.set(-0.4, 1, 0.8);
  scene.add(sun);
  const world: Record<string, number[]> = { root: [0, 0, 0] };
  const at = (name: string): number[] => {
    if (world[name]) return world[name];
    const [parent, off] = data.joints[name];
    const p = at(parent);
    return (world[name] = [p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
  };
  const loader = new THREE.TextureLoader();
  for (const part of data[mode]) {
    const j = at(part.joint);
    const pos: number[] = [], nrm: number[] = [];
    for (let i = 0; i < part.pos.length; i += 3) {
      pos.push(...b2t(part.pos[i] + j[0], part.pos[i + 1] + j[1], part.pos[i + 2] + j[2]));
      nrm.push(...b2t(part.nrm[i], part.nrm[i + 1], part.nrm[i + 2]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    if (part.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(part.uv, 2));
    g.setIndex(part.idx);
    let m: THREE.Material;
    if (part.tex && texData[part.tex]) {
      const t = await loader.loadAsync(texData[part.tex]);
      t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.flipY = false;
      m = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide, alphaTest: 0.5 });
    } else m = new THREE.MeshLambertMaterial({ color: data.palette[part.color]?.[0] ?? "#ff00ff" });
    scene.add(new THREE.Mesh(g, m));
  }
  const camera = new THREE.OrthographicCamera((-halfHeight * W) / H, (halfHeight * W) / H, halfHeight, -halfHeight, 0.1, 100);
  const t = new THREE.Vector3(0, 0.81, 0);
  camera.position.copy(t).addScaledVector(new THREE.Vector3(...(from as [number, number, number])).normalize(), 20);
  camera.lookAt(t);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
}
Object.assign(window, { charView });

// A plain close view of the FlyFF character (Lambert, textures, alpha test).
async function flyffView(clip: string, time: number, from: number[], halfHeight: number, single = false, center: number[] = [0, 0.81, 0], wire = false): Promise<string> {
  const W = 600, H = 800;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#9cc8f0");
  scene.add(new THREE.HemisphereLight("#ffffff", "#8080a0", 2.2));
  const sun = new THREE.DirectionalLight("#ffffff", 1.4);
  sun.position.set(-0.4, 1, 0.8);
  scene.add(sun);
  const ch = await loadFlyff(clip, time, (map) => { map.magFilter = THREE.NearestFilter; return new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: single ? THREE.FrontSide : THREE.DoubleSide }); });
  scene.add(ch);
  if (wire) ch.children.forEach((m: any) => scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), new THREE.LineBasicMaterial({ color: "#203060" }))));
  const camera = new THREE.OrthographicCamera((-halfHeight * W) / H, (halfHeight * W) / H, halfHeight, -halfHeight, 0.1, 100);
  const t = new THREE.Vector3(...(center as [number, number, number]));
  camera.position.copy(t).addScaledVector(new THREE.Vector3(...(from as [number, number, number])).normalize(), 20);
  camera.lookAt(t);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
}
Object.assign(window, { flyffView });
