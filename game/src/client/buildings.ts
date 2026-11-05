// The 4 buildings, drawn as in documentation/building/tools/scene: buildAssetObject for the textured plans,
// buildPod for Raditz's pod (its door is cut out of the sphere).
import * as THREE from "three";
import { buildAssetObject } from "../engine/asset-format/build.ts";
import { buildShapeGeometry } from "../engine/asset-format/geometry.ts";
import { preparePixelTexture, type PixelRenderer } from "../engine/renderer/index.ts";
import type { BuildingId, BuildingPlan } from "../shared/config.ts";
import type { GameMap } from "../shared/worldgen.ts";
import { collectMeshes, meshVolume, voxelize } from "../engine/voxel/index.ts";
import type { Voxels } from "./voxels.ts";

function toAsset(plan: any, id: string): any {
  return {
    ...plan, id, kind: "building",
    shapes: plan.shapes.map((s: any) => ({ tilt: 0, role: null, ...s, faces: Object.fromEntries(s.faces.map((f: any) => [f.face, f.texture])) })),
    textures: plan.textures.map((t: any) => ({ ...t, file: t.file ?? null, prompt: null, updatedAt: "" })),
  };
}

async function loadTextures(id: BuildingId, plan: BuildingPlan) {
  const loader = new THREE.TextureLoader();
  const map = new Map<string, THREE.Texture>();
  await Promise.all(plan.textures.map(async (slot) => {
    if (!slot.file) return;
    const texture = await loader.loadAsync(`assets/buildings/${id}/${slot.file}`).catch(() => null);
    if (!texture) return;
    preparePixelTexture(texture);
    texture.repeat.set(1 / slot.widthM, 1 / slot.heightM);
    map.set(slot.name, texture);
  }));
  return map;
}

// With voxels, each building is voxelized where it stands (on the world grid), with the colors of its textures,
// and drawn as one merged mesh.
export async function buildBuildings(renderer: PixelRenderer, map: GameMap, voxels: Voxels | null) {
  const group = new THREE.Group();
  for (const placed of map.buildings) {
    const plan = map.config.buildings[placed.id];
    const model = plan.pod ? buildPod(plan, renderer.materials) : buildAssetObject(toAsset(plan, placed.id), await loadTextures(placed.id, plan), renderer.materials);
    model.position.set(placed.x, 0, placed.z);
    model.name = placed.id;
    if (!voxels) {
      group.add(model);
      continue;
    }
    const volume = voxelize(collectMeshes(model, true), voxels.size, voxels.palette, { clipBelowGround: true, fill: true, surfaceNormals: voxels.surfaceNormals });
    const geometry = volume && meshVolume(volume, voxels.palette, { cullGround: true });
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, voxels.material);
    mesh.name = placed.id;
    group.add(mesh);
  }
  return renderer.castShadows(group);
}

// Raditz's pod, copied from documentation/building/tools/scene/src/main.ts (buildPod).
// plan.pod = {open (degrees), hinge [y, z], box [min elevation, max elevation, max azimuth] (degrees, around the sphere
// center), center [x, y, z], look {hull, inside, frame, glass, portElev, frameDeg, glassDeg}}. Flat colors only.
export function buildPod(plan: any, materials: any) {
  const pod = plan.pod, look = pod.look;
  const c = new THREE.Vector3(...(pod.center as [number, number, number]));
  const [eMin, eMax, aMax] = pod.box;
  const body: THREE.Vector3[] = [], door: THREE.Vector3[] = [];
  for (const shape of plan.shapes) {
    const { geometry, groups } = buildShapeGeometry({ tilt: 0, ...shape });
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(...(shape.position as [number, number, number]));
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(THREE.MathUtils.degToRad(shape.tilt ?? 0), THREE.MathUtils.degToRad(shape.rotationY), 0);
    mesh.updateMatrixWorld();
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute("position");
    const faceOf = (i: number) => groups.find((gr: any) => i >= gr.start && i < gr.start + gr.count)?.face;
    for (let i = 0; i < pos.count; i += 3) {
      if (faceOf(i) !== "side") continue;
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
      const m = v[0]!.clone().add(v[1]!).add(v[2]!).divideScalar(3).sub(c);
      const elev = THREE.MathUtils.radToDeg(Math.asin(m.y / m.length()));
      const az = THREE.MathUtils.radToDeg(Math.atan2(m.x, m.z));
      (elev > eMin && elev < eMax && Math.abs(az) < aMax ? door : body).push(...v);
    }
  }
  const e = THREE.MathUtils.degToRad(look.portElev);
  const axis = new THREE.Vector3(0, Math.sin(e), Math.cos(e));
  const cosFrame = Math.cos(THREE.MathUtils.degToRad(look.frameDeg)), cosGlass = Math.cos(THREE.MathUtils.degToRad(look.glassDeg));
  const mats = [look.hull, look.inside, look.frame, look.glass].map((color: string) => materials.solid({ color }));
  // tris: triangles (3 points each). inside: the same triangles 1 cm toward the center, turned to face it.
  // withPort: cut each triangle in n x n small ones and give each the color of the porthole where it lies.
  const mesh = (tris: THREE.Vector3[], withPort: boolean) => {
    const out: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [] };
    const push = (k: number, a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3) => out[k]!.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
    const portOf = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3) => {
      if (!withPort) return -1;
      const k = a.clone().add(b).add(d).divideScalar(3).sub(c).normalize().dot(axis);
      return k > cosGlass ? 3 : k > cosFrame ? 2 : -1;
    };
    const n = withPort ? 12 : 1;
    for (let i = 0; i < tris.length; i += 3) {
      const [A, B, C] = [tris[i]!, tris[i + 1]!, tris[i + 2]!];
      const P = (u: number, v: number) => A.clone().addScaledVector(B.clone().sub(A), u / n).addScaledVector(C.clone().sub(A), v / n);
      for (let u = 0; u < n; u++) for (let v = 0; u + v < n; v++) {
        const sub = [[P(u, v), P(u + 1, v), P(u, v + 1)]];
        if (u + v < n - 1) sub.push([P(u + 1, v), P(u + 1, v + 1), P(u, v + 1)]);
        for (const [a, b, d] of sub) {
          const port = portOf(a!, b!, d!);
          push(port < 0 ? 0 : port, a!, b!, d!);
          const inn = (p: THREE.Vector3) => p.clone().sub(c).multiplyScalar(0.99).add(c);
          push(port < 0 ? 1 : port, inn(a!), inn(d!), inn(b!));
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    const all: number[] = [];
    const used: THREE.Material[] = [];
    for (const k of [0, 1, 2, 3]) {
      if (!out[k]!.length) continue;
      geometry.addGroup(all.length / 3, out[k]!.length / 3, used.length);
      used.push(mats[k]!);
      all.push(...out[k]!);
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(all, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((all.length / 3) * 2), 2));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, used);
  };
  const group = new THREE.Group();
  group.add(mesh(body, false));
  const pivot = new THREE.Group();
  pivot.position.set(0, pod.hinge[0], pod.hinge[1]);
  const doorMesh = mesh(door, true);
  doorMesh.position.set(0, -pod.hinge[0], -pod.hinge[1]);
  pivot.add(doorMesh);
  pivot.rotation.x = THREE.MathUtils.degToRad(pod.open);
  group.add(pivot);
  // What holds the door to the pod: the hinge bar along x on the hinge line, and 2 arms.
  const metal = materials.solid({ color: look.metal ?? "#8fb0c8" });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(look.hingeR ?? 0.07, look.hingeR ?? 0.07, look.hingeW ?? 0.9, 8), metal);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0, pod.hinge[0], look.hingeZ ?? pod.hinge[1]);
  group.add(barrel);
  const onSphere = (r: number, elevDeg: number, azDeg: number) => {
    const e = THREE.MathUtils.degToRad(elevDeg), a = THREE.MathUtils.degToRad(azDeg);
    return new THREE.Vector3(r * Math.cos(e) * Math.sin(a), r * Math.sin(e), r * Math.cos(e) * Math.cos(a)).add(c);
  };
  const turn = (p: THREE.Vector3) => {
    const h = new THREE.Vector3(0, pod.hinge[0], pod.hinge[1]);
    return p.clone().sub(h).applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(pod.open)).add(h);
  };
  for (const side of [-1, 1]) {
    const a = onSphere(look.armR ?? 0.96, look.armBodyElev ?? -46, side * (look.armBodyAz ?? 43));
    const b = turn(onSphere(look.armR ?? 0.96, look.armDoorElev ?? -30, side * (look.armDoorAz ?? 33)));
    const len = a.distanceTo(b);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(look.armT ?? 0.07, len, look.armT ?? 0.07), metal);
    arm.position.copy(a).add(b).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    group.add(arm);
  }
  return group;
}
