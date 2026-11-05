// What the client needs to draw voxels: the voxel size, the palette of colors and the two materials (the game's
// solid material reading the palette texture; the character one has no fold lines, as before).
import * as THREE from "three";
import type { PixelRenderer } from "../engine/renderer/index.ts";
import { boxVolume, meshVolume, VoxelPalette } from "../engine/voxel/index.ts";

export type Voxels = {
  // meters per voxel
  size: number;
  palette: VoxelPalette;
  material: THREE.ShaderMaterial;
  characterMaterial: THREE.ShaderMaterial;
  // each voxel is lit with the normal of the surface it comes from (true), or with the normal of each cube face
  surfaceNormals: boolean;
};

// The voxel size in meters, from voxels.json (voxelsPerMeter). For tests the address can change it:
// ?voxel=16 is 1/16 m, ?voxel=0 draws the meshes of the game branch (no voxels).
export function voxelSizeFrom(params: URLSearchParams, voxelsPerMeter: number) {
  const value = params.get("voxel");
  const n = value === null ? voxelsPerMeter : Number(value);
  return n > 0 ? 1 / n : 0;
}

export function createVoxels(renderer: PixelRenderer, size: number, surfaceNormals = false): Voxels {
  const palette = new VoxelPalette();
  const material = renderer.materials.solid({ map: palette.texture });
  const characterMaterial = renderer.materials.solid({ map: palette.texture });
  characterMaterial.uniforms.uChar!.value = 1;
  return { size, palette, material, characterMaterial, surfaceNormals };
}

// A cube of voxels of one color, about `meters` wide, its base centered on the origin (monsters, pets, items).
export function voxelCube(voxels: Voxels, meters: number, color: THREE.ColorRepresentation) {
  const n = Math.max(1, Math.round(meters / voxels.size));
  const geometry = meshVolume(boxVolume(voxels.size, n, n, n, voxels.palette.addColor(color)), voxels.palette)!;
  const half = (n * voxels.size) / 2;
  geometry.translate(-half, 0, -half);
  // scaled to 1 m: the render system scales it to the size of the asset, as with the box before
  geometry.scale(1 / (n * voxels.size), 1 / (n * voxels.size), 1 / (n * voxels.size));
  return geometry;
}
