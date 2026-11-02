import * as THREE from "three";
import { buildShapeGeometry, type Asset } from "@lambda/asset-format";
import { CAMERA_FORWARD, FALLBACK_COLOR, SUN_DIRECTION } from "@lambda/renderer";

// Pictures of the shapes for an Infer check: flat slot colors with simple light,
// black edges, and a 1 m grid on the ground. No textures and no game effects,
// so Infer sees only the forms.
const SIZE = 768;

function buildFlatModel(asset: Asset) {
  const colors = new Map(asset.textures.map((slot) => [slot.name, slot.color]));
  const materials = new Map<string, THREE.Material>();
  const materialFor = (slot: string | null | undefined) => {
    const color = (slot && colors.get(slot)) ?? FALLBACK_COLOR;
    let material = materials.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      materials.set(color, material);
    }
    return material;
  };
  const edgeMaterial = new THREE.LineBasicMaterial({ color: "#000000" });

  const group = new THREE.Group();
  for (const shape of asset.shapes) {
    const { geometry, groups } = buildShapeGeometry(shape);
    const meshMaterials: THREE.Material[] = [];
    for (const part of groups) {
      geometry.addGroup(part.start, part.count, meshMaterials.length);
      meshMaterials.push(materialFor(shape.faces[part.face]));
    }
    const mesh = new THREE.Mesh(geometry, meshMaterials);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), edgeMaterial));
    mesh.position.set(...shape.position);
    // Turn first, then tilt in the turned frame, like the game model.
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(THREE.MathUtils.degToRad(shape.tilt), THREE.MathUtils.degToRad(shape.rotationY), 0);
    group.add(mesh);
  }
  return group;
}

// A grid centered on the origin, so its center lines are x = 0 and z = 0.
function buildGrid(halfMeters: number) {
  const grid = new THREE.GridHelper(halfMeters * 2, halfMeters * 2, "#404040", "#c8c8c8");
  grid.position.y = 0.002;
  return grid;
}

async function toPng(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The shapes could not be saved as an image.");
  return blob;
}

// Two PNGs of the asset: from the game camera, and from straight above with +z at the bottom.
export async function captureShapes(asset: Asset) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f4f4f4");
    scene.add(new THREE.HemisphereLight("#ffffff", "#9a9a9a", 2.2));
    const sun = new THREE.DirectionalLight("#ffffff", 1.4);
    sun.position.set(...SUN_DIRECTION);
    scene.add(sun);

    const model = buildFlatModel(asset);
    scene.add(model);
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const center = bounds.getCenter(new THREE.Vector3());
    const reach = Math.max(1, ...[bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z].map(Math.abs));
    const half = Math.ceil(reach + 1);
    scene.add(buildGrid(half));

    // Half the view in meters for the game camera: the model with a margin.
    const size = bounds.getSize(new THREE.Vector3());
    const view = Math.max(size.x, size.z, size.y) * 0.6 + 0.5;
    const camera = new THREE.OrthographicCamera(-view, view, view, -view, 0.1, 400);
    const forward = new THREE.Vector3(...CAMERA_FORWARD).normalize();

    camera.position.copy(center).addScaledVector(forward, -100);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    renderer.render(scene, camera);
    const game = await toPng(renderer.domElement);

    camera.position.set(0, 100, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    Object.assign(camera, { left: -half, right: half, top: half, bottom: -half });
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const top = await toPng(renderer.domElement);

    return { game, top };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
