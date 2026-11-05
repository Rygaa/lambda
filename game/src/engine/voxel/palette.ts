import * as THREE from "three";
import { preparePixelTexture } from "../renderer/materials.ts";

// Every surface a voxel can have, in one small texture: surface i is texel (i % SIDE, i / SIDE).
// A voxel face takes the UV of the center of its texel, so the game's solid material (uMap) shows its
// color with no change to the renderer. The texels hold the sRGB color in the sun, like any texture.
// A surface is a color, and optionally a normal: then the faces of the voxel are lit with that normal (the
// normal of the surface the voxel was made from) instead of the normal of each cube face.
const SIDE = 512;

export class VoxelPalette {
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(SIDE * SIDE * 4);
  private readonly index = new Map<string, number>();
  private normals = new Float32Array(1024 * 3);
  private hasNormal = new Uint8Array(1024);
  private dirty = false;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, SIDE, SIDE, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.flipY = false;
    preparePixelTexture(this.texture);
  }

  get size() {
    return this.index.size;
  }

  // The palette index of an sRGB color 0xRRGGBB (added if new), with a normal or not. Voxels store index + 1
  // (0 = empty). Normals are rounded to 1/32, so the voxels of one flat face share one surface.
  add(rgb: number, nx?: number, ny?: number, nz?: number) {
    let key: string;
    let q: [number, number, number] | null = null;
    if (nx === undefined) key = String(rgb);
    else {
      const qx = Math.round(nx * 32), qy = Math.round(ny! * 32), qz = Math.round(nz! * 32);
      key = `${rgb},${qx},${qy},${qz}`;
      q = [qx, qy, qz];
    }
    let i = this.index.get(key);
    if (i !== undefined) return i;
    i = this.index.size;
    if (i >= SIDE * SIDE) return this.nearest(rgb);
    this.index.set(key, i);
    this.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
    if (i >= this.hasNormal.length) {
      const normals = new Float32Array(this.normals.length * 2);
      normals.set(this.normals);
      this.normals = normals;
      const has = new Uint8Array(this.hasNormal.length * 2);
      has.set(this.hasNormal);
      this.hasNormal = has;
    }
    if (q) {
      const len = Math.hypot(q[0], q[1], q[2]) || 1;
      this.normals.set([q[0] / len, q[1] / len, q[2] / len], i * 3);
      this.hasNormal[i] = 1;
    }
    this.dirty = true;
    return i;
  }

  // The normal of surface i, or null when its faces keep their own normals.
  normalOf(i: number): [number, number, number] | null {
    return this.hasNormal[i] ? [this.normals[i * 3]!, this.normals[i * 3 + 1]!, this.normals[i * 3 + 2]!] : null;
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
