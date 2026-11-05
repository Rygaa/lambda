// Two views of a building plan (the JSON format of documentation/building/example/*.json):
// - gameView: the real game renderer (PixelRenderer), like the asset studio shows an asset.
// - angleView: plain three.js from any direction, to compare with a reference photo taken from the side.
import * as THREE from "three";
import { buildAssetObject, buildGroundPatch } from "../vendor/packages/asset-format/src/build.ts";
import { buildShapeGeometry } from "../vendor/packages/asset-format/src/geometry.ts";
import { assetFootprint } from "../vendor/packages/asset-format/src/schema.ts";
import { PixelRenderer } from "../vendor/packages/renderer/src/index.ts";

// A plan lists faces as [{face, texture}]; an asset maps face -> slot.
function toAsset(plan: any): any {
  return {
    ...plan,
    id: "preview",
    kind: "building",
    shapes: plan.shapes.map((s: any) => ({ tilt: 0, role: null, ...s, faces: Object.fromEntries(s.faces.map((f: any) => [f.face, f.texture])) })),
    textures: plan.textures.map((t: any) => ({ ...t, file: null, prompt: null, updatedAt: "" })),
  };
}

const PATCH = 24;

// rotation: degrees. The game camera never turns, so the model turns to show its other sides.
async function gameView(plan: any, rotation = 0, targetY: number | null = null, wait = 1500): Promise<string> {
  const asset = toAsset(plan);
  const container = document.getElementById("view")!;
  container.innerHTML = "";
  const renderer = new PixelRenderer(container, { shadowRadius: 14 });
  const holder = new THREE.Group();
  holder.rotation.y = THREE.MathUtils.degToRad(rotation);
  renderer.scene.add(holder);
  const model = renderer.castShadows(buildAssetObject(asset, new Map(), renderer.materials));
  const box = assetFootprint(asset);
  const half = PATCH / 2;
  const under = (x: number, z: number) => x > box.minX - 0.1 && x < box.maxX + 0.1 && z > box.minZ - 0.1 && z < box.maxZ + 0.1;
  holder.add(
    buildGroundPatch(renderer.materials.ground({ row: "grass" }), PATCH),
    renderer.createGroundCover({ minX: -half, maxX: half, minZ: -half, maxZ: half, groundAt: (x, z) => (under(x, z) ? null : "grass") }),
    model,
  );
  renderer.setTarget({ x: 0, y: targetY ?? new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()).y, z: 0 });
  await new Promise((r) => setTimeout(r, wait));
  const blob = await renderer.capture();
  renderer.dispose();
  return await new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(f.result as string); f.readAsDataURL(blob); });
}

// from: direction from the target toward the camera. halfWidth: half the view width in meters. Output is 800 × 600.
function angleView(plan: any, from: number[], target: number[], halfWidth: number): string {
  const W = 800, H = 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#9cc8f0");
  scene.add(new THREE.HemisphereLight("#ffffff", "#8080a0", 2.0));
  const sun = new THREE.DirectionalLight("#ffffff", 1.5);
  sun.position.set(-0.4, 1, 0.6);
  scene.add(sun);
  const colors = new Map(plan.textures.map((s: any) => [s.name, s.color]));
  for (const shape of plan.shapes) {
    const faces = Object.fromEntries(shape.faces.map((f: any) => [f.face, f.texture]));
    const { geometry, groups } = buildShapeGeometry({ tilt: 0, ...shape });
    const materials: THREE.Material[] = [];
    for (const g of groups) {
      geometry.addGroup(g.start, g.count, materials.length);
      materials.push(new THREE.MeshLambertMaterial({ color: (colors.get(faces[g.face]) as string) ?? "#ff00ff" }));
    }
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: "#404060" })));
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

Object.assign(window, { gameView, angleView });
