import * as THREE from "three";
import { SUN_DIRECTION } from "./constants.ts";
import { GROUND_ROWS, type GroundRow } from "./palette.ts";
import * as S from "./shaders.ts";

// The uniforms every scene material reads: the sun, its shadow map, and the clouds.
export function createSharedUniforms() {
  return {
    uSunL: { value: new THREE.Vector3(...SUN_DIRECTION).normalize() },
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: 1 / 4096 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudScale: { value: 0.23 },
    uCloudLo: { value: -0.05 },
    uCloudHi: { value: 0.02 },
  };
}
export type SharedUniforms = ReturnType<typeof createSharedUniforms>;

export function shaderMaterial(
  shared: SharedUniforms,
  vertexShader: string,
  fragmentShader: string,
  extra: Record<string, THREE.IUniform> = {},
  options: THREE.ShaderMaterialParameters = {},
) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: { ...shared, ...extra },
    ...options,
  });
}

// Pixel textures are never smoothed and never use mipmaps.
export function preparePixelTexture(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

const linear = (color: THREE.ColorRepresentation) => new THREE.Color(color);

// Makes the materials of one renderer. They share its sun, shadow map, and clouds.
export class Materials {
  constructor(private readonly shared: SharedUniforms) {}

  // An asset part: a texture (its repeat is the slot size in meters) or a flat color.
  solid(source: { map?: THREE.Texture; color?: THREE.ColorRepresentation }) {
    return shaderMaterial(this.shared, S.MESH_VERT, S.SOLID_FRAG, {
      uColor: { value: linear(source.color ?? "#ffffff") },
      uMap: { value: source.map ?? null },
      uUseMap: { value: source.map ? 1 : 0 },
      uRepeat: { value: source.map ? source.map.repeat : new THREE.Vector2(1, 1) },
      uChar: { value: 0 },
    });
  }

  // Ground: a palette row, or a ground texture that repeats every `tile` meters.
  // rowMap (game): a texture whose red channel is the ground row of each cell (255 = water), covering
  // rowMapRect = [minX, minZ, sizeX, sizeZ] meters. Outside it, the ground is water.
  ground(source: { row?: GroundRow; map?: THREE.Texture; tile?: number; rowMap?: THREE.Texture; rowMapRect?: [number, number, number, number] }) {
    return shaderMaterial(this.shared, S.MESH_VERT, S.GROUND_FRAG, {
      uRowMap: { value: source.rowMap ?? null },
      uUseRowMap: { value: source.rowMap ? 1 : 0 },
      uRowMapRect: { value: new THREE.Vector4(...(source.rowMapRect ?? [0, 0, 1, 1])) },
      uRow: { value: GROUND_ROWS.indexOf(source.row ?? "grass") },
      uMap: { value: source.map ?? null },
      uUseMap: { value: source.map ? 1 : 0 },
      uTile: { value: source.tile ?? 2 },
    });
  }

  water() {
    return shaderMaterial(this.shared, S.MESH_VERT, S.WATER_FRAG);
  }
}
