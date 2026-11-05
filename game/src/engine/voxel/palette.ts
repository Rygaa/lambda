import * as THREE from "three";
import { preparePixelTexture } from "../renderer/materials.ts";

// Every color a voxel can have, in one small texture: color i is texel (i % SIDE, i / SIDE).
// A voxel face takes the UV of the center of its texel, so the game's solid material (uMap) shows its
// color with no change to the renderer. The texels hold the sRGB color in the sun, like any texture.
const SIDE = 512;

export class VoxelPalette {
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(SIDE * SIDE * 4);
  private readonly index = new Map<number, number>();
  private dirty = false;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, SIDE, SIDE, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.flipY = false;
    preparePixelTexture(this.texture);
  }

  get size() {
    return this.index.size;
  }

  // The palette index of an sRGB color 0xRRGGBB (added if new). Voxels store index + 1 (0 = empty).
  add(rgb: number) {
    let i = this.index.get(rgb);
    if (i !== undefined) return i;
    i = this.index.size;
    if (i >= SIDE * SIDE) return this.nearest(rgb);
    this.index.set(rgb, i);
    this.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
    this.dirty = true;
    return i;
  }

  addColor(color: THREE.ColorRepresentation) {
    return this.add(new THREE.Color(color).getHex());
  }

  rgbOf(i: number) {
    return (this.data[i * 4]! << 16) | (this.data[i * 4 + 1]! << 8) | this.data[i * 4 + 2]!;
  }

  // The UV of the center of the texel of color i.
  u(i: number) {
    return ((i % SIDE) + 0.5) / SIDE;
  }
  v(i: number) {
    return (Math.floor(i / SIDE) + 0.5) / SIDE;
  }

  // Sends the new colors to the GPU (call after making geometries).
  flush() {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  private nearest(rgb: number) {
    let best = 0;
    let bestD = Infinity;
    for (const i of this.index.values()) {
      const c = this.rgbOf(i);
      const d = (((c >> 16) & 255) - ((rgb >> 16) & 255)) ** 2 + (((c >> 8) & 255) - ((rgb >> 8) & 255)) ** 2 + ((c & 255) - (rgb & 255)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
