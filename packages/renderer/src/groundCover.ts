import * as THREE from "three";
import { CAMERA_FORWARD, PIXELS_PER_METER } from "./constants.ts";
import { shaderMaterial, type SharedUniforms } from "./materials.ts";
import { GROUND_ROWS, type GroundRow } from "./palette.ts";
import { MID, SPRITE_FRAG, SPRITE_VERT } from "./shaders.ts";

// The atlases of pixel-scene: 4 grass tufts (24×16 px), 8 sprouts and flowers (14×12 px).
const ATLASES = {
  tufts: { url: new URL("../assets/tufts.png", import.meta.url).href, cell: [24, 16], count: 4 },
  decor: { url: new URL("../assets/decor.png", import.meta.url).href, cell: [14, 12], count: 8 },
} as const;
const SPROUTS = [0, 1, 2, 7];
const FLOWERS = [3, 4, 5, 6];

const QUAD = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

export type GroundCoverOptions = {
  // The square to cover, in meters.
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  // The ground at a point, or null where nothing grows (water, under a building).
  groundAt: (x: number, z: number) => GroundRow | null;
  seed?: number;
};

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function spriteMesh(shared: SharedUniforms, atlas: (typeof ATLASES)[keyof typeof ATLASES], items: number[][]) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = QUAD.index;
  geometry.setAttribute("position", QUAD.attributes.position!);
  geometry.setAttribute("uv", QUAD.attributes.uv!);
  geometry.setAttribute("iPos", new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap((item) => item.slice(0, 3))), 3));
  geometry.setAttribute("iParam", new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap((item) => item.slice(3))), 4));
  geometry.instanceCount = items.length;

  const texture = new THREE.TextureLoader().load(atlas.url);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;

  const forward = new THREE.Vector3(...CAMERA_FORWARD);
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const material = shaderMaterial(shared, SPRITE_VERT, SPRITE_FRAG, {
    uAtlas: { value: texture },
    uCells: { value: atlas.count },
    uSize: { value: new THREE.Vector2(atlas.cell[0] / PIXELS_PER_METER, atlas.cell[1] / PIXELS_PER_METER) },
    uCamR: { value: right },
    uCamU: { value: new THREE.Vector3().crossVectors(right, forward).normalize() },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// Grass tufts every 1/8 m, in the color of the ground under them, and sprouts and
// flowers on grass, like pixel-scene (systems/setup.js spawnGroundCoverSystem).
export function createGroundCover(shared: SharedUniforms, options: GroundCoverOptions) {
  const random = createRandom(options.seed ?? 5);
  const toward = new THREE.Vector3(...CAMERA_FORWARD).multiplyScalar(-0.25);
  const grass: number[][] = [];
  for (let x = options.minX; x < options.maxX; x += 0.125) {
    for (let z = options.minZ; z < options.maxZ; z += 0.125) {
      const px = x + random() * 0.125;
      const pz = z + random() * 0.125;
      const cell = Math.floor(random() * 4);
      const ground = options.groundAt(px, pz);
      if (ground && ground !== "road") grass.push([px, 0, pz, cell, MID.ground, GROUND_ROWS.indexOf(ground), 0]);
    }
  }
  const decor: number[][] = [];
  for (let x = options.minX; x < options.maxX; x += 0.75) {
    for (let z = options.minZ; z < options.maxZ; z += 0.75) {
      if (random() > 0.8) continue;
      const px = x + random() * 0.75;
      const pz = z + random() * 0.75;
      const roll = random();
      const pick = (list: number[]) => list[Math.floor(random() * 4)]!;
      const [cell, mid] =
        roll < 0.32
          ? [pick(SPROUTS), MID.sprout]
          : roll < 0.58
            ? [pick(FLOWERS), MID.flowerWhite]
            : roll < 0.68
              ? [pick(FLOWERS), MID.flowerLilac]
              : [pick(SPROUTS), MID.leaf];
      if (options.groundAt(px, pz) !== "grass") continue;
      // decor sits a little in front of its spot
      const lift = mid === MID.leaf ? 0.02 : 0.1;
      decor.push([px + toward.x, lift + toward.y, pz + toward.z, cell, mid, 0, 0]);
    }
  }
  const group = new THREE.Group();
  if (grass.length) group.add(spriteMesh(shared, ATLASES.tufts, grass));
  if (decor.length) group.add(spriteMesh(shared, ATLASES.decor, decor));
  return group;
}
