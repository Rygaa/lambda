import * as THREE from "three";
import { FALLBACK_COLOR, preparePixelTexture, type GroundRow, type Materials } from "../renderer/index.ts";
import { buildShapeGeometry } from "./geometry.ts";
import { assetFolder, GROUND_TILE_METERS, type Asset, type TextureSlot } from "./schema.ts";

// Loads the textures of an asset. libraryUrl is where the assets/ folder is served, such as "/library".
export async function loadAssetTextures(asset: Asset, libraryUrl: string) {
  const loader = new THREE.TextureLoader();
  const textures = new Map<string, THREE.Texture>();
  await Promise.all(
    asset.textures.map(async (slot) => {
      if (!slot.file) return;
      const url = `${libraryUrl}/${assetFolder(asset)}/${slot.file}?v=${encodeURIComponent(slot.updatedAt)}`;
      // A missing file shows the main color of its slot, not a blank view.
      const image = await loader.loadAsync(url).catch(() => null);
      if (!image) return;
      const texture = preparePixelTexture(image);
      texture.repeat.set(1 / slot.widthM, 1 / slot.heightM);
      textures.set(slot.name, texture);
    }),
  );
  return textures;
}

// The flat color of a slot is its color in the sun; the post pass makes its shade tones.
function slotMaterial(slot: TextureSlot | undefined, textures: Map<string, THREE.Texture>, materials: Materials) {
  const texture = slot ? textures.get(slot.name) : undefined;
  if (texture) return materials.solid({ map: texture });
  return materials.solid({ color: slot?.color ?? FALLBACK_COLOR });
}

// One 3D object from an asset. Faces with no texture yet show the main color of their slot.
export function buildAssetObject(asset: Asset, textures: Map<string, THREE.Texture>, materials: Materials) {
  const group = new THREE.Group();
  group.name = asset.id;
  const slots = new Map(asset.textures.map((slot) => [slot.name, slot]));
  const byName = new Map<string, THREE.Material>();
  const materialFor = (name: string | null | undefined) => {
    const key = name ?? "";
    let material = byName.get(key);
    if (!material) {
      material = slotMaterial(name ? slots.get(name) : undefined, textures, materials);
      byName.set(key, material);
    }
    return material;
  };

  for (const shape of asset.shapes) {
    const { geometry, groups } = buildShapeGeometry(shape);
    const meshMaterials: THREE.Material[] = [];
    for (const group of groups) {
      geometry.addGroup(group.start, group.count, meshMaterials.length);
      meshMaterials.push(materialFor(shape.faces[group.face]));
    }
    const mesh = new THREE.Mesh(geometry, meshMaterials);
    mesh.name = shape.id;
    mesh.position.set(...shape.position);
    // Turn first, then tilt in the turned frame.
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(THREE.MathUtils.degToRad(shape.tilt), THREE.MathUtils.degToRad(shape.rotationY), 0);
    group.add(mesh);
  }
  return group;
}

// A flat square of ground, size × size meters, centered on the origin.
export function buildGroundPatch(material: THREE.Material, size: number) {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, material);
}

// The material of a ground asset, or a palette row when it has no texture yet.
export function groundMaterial(asset: Asset | null, textures: Map<string, THREE.Texture>, row: GroundRow, materials: Materials) {
  const slot = asset?.textures[0];
  const texture = slot ? textures.get(slot.name) : undefined;
  return texture ? materials.ground({ map: texture, tile: GROUND_TILE_METERS }) : materials.ground({ row });
}
