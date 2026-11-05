import * as THREE from "three";
import type { VoxelPalette } from "./palette.ts";
import type { VoxelVolume } from "./voxelize.ts";

// Collects merged voxel faces (quads) into one geometry: position, normal (one of the 6 axes), uv (the texel of
// the color in the palette texture).
export class QuadBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  constructor(private readonly palette: VoxelPalette) {}

  get quads() {
    return this.indices.length / 6;
  }

  // 4 corners counter-clockwise seen from the side the normal points to.
  quad(corners: number[], normal: [number, number, number], color: number) {
    const base = this.positions.length / 3;
    const u = this.palette.u(color), v = this.palette.v(color);
    for (let c = 0; c < 4; c++) {
      this.positions.push(corners[c * 3]!, corners[c * 3 + 1]!, corners[c * 3 + 2]!);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(u, v);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.indices.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.palette.flush();
    return g;
  }
}

export type MeshOptions = {
  // no face looks down from the ground (y = 0): nobody sees under the ground
  cullGround?: boolean;
};

// Greedy meshing: only the faces between a voxel and an empty voxel are kept (hidden faces removed), and the
// faces of one direction, slice and color are merged into the largest rectangles.
export function meshVolume(volume: VoxelVolume, palette: VoxelPalette, options: MeshOptions = {}, into?: QuadBuilder) {
  const builder = into ?? new QuadBuilder(palette);
  const { size, min, n, data } = volume;
  const [nx, ny, nz] = n;
  const get = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : data[x + nx * (y + ny * z)]!);
  const pos = [0, 0, 0];
  const corner = (d: number, u: number, v: number, plane: number, a: number, b: number, out: number[]) => {
    const p = [0, 0, 0];
    p[d] = plane;
    p[u] = a;
    p[v] = b;
    out.push((p[0]! + min[0]) * size, (p[1]! + min[1]) * size, (p[2]! + min[2]) * size);
  };
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const du = n[u]!, dv = n[v]!;
    const mask = new Int32Array(du * dv);
    for (const sign of [1, -1]) {
      const normal: [number, number, number] = [0, 0, 0];
      normal[d] = sign;
      for (let slice = 0; slice < n[d]!; slice++) {
        // the faces of this slice that look toward `sign`
        if (options.cullGround && d === 1 && sign === -1 && slice + min[1] <= 0) continue;
        let any = false;
        for (let b = 0; b < dv; b++) {
          for (let a = 0; a < du; a++) {
            pos[d] = slice;
            pos[u] = a;
            pos[v] = b;
            const c = get(pos[0]!, pos[1]!, pos[2]!);
            let m = 0;
            if (c) {
              pos[d] = slice + sign;
              if (!get(pos[0]!, pos[1]!, pos[2]!)) m = c;
            }
            mask[a + du * b] = m;
            if (m) any = true;
          }
        }
        if (!any) continue;
        const plane = slice + (sign > 0 ? 1 : 0);
        for (let b = 0; b < dv; b++) {
          for (let a = 0; a < du; ) {
            const c = mask[a + du * b]!;
            if (!c) {
              a++;
              continue;
            }
            let w = 1;
            while (a + w < du && mask[a + w + du * b] === c) w++;
            let h = 1;
            grow: while (b + h < dv) {
              for (let k = 0; k < w; k++) if (mask[a + k + du * (b + h)] !== c) break grow;
              h++;
            }
            for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[a + k + du * (b + hh)] = 0;
            const corners: number[] = [];
            if (sign > 0) {
              corner(d, u, v, plane, a, b, corners);
              corner(d, u, v, plane, a + w, b, corners);
              corner(d, u, v, plane, a + w, b + h, corners);
              corner(d, u, v, plane, a, b + h, corners);
            } else {
              corner(d, u, v, plane, a, b, corners);
              corner(d, u, v, plane, a, b + h, corners);
              corner(d, u, v, plane, a + w, b + h, corners);
              corner(d, u, v, plane, a + w, b, corners);
            }
            builder.quad(corners, normal, c - 1);
            a += w;
          }
        }
      }
    }
  }
  return into ? null : builder.build();
}

// A height field of voxel columns: column (x, z) is solid from the ground up to height[x, z] voxels, with the color
// color[x, z]. The arrays have a border of 1 column on each side (the neighbours, for the side faces), so they are
// (nx + 2) × (nz + 2). Column (x, z) of the chunk is voxel column (i0 + x, k0 + z) of the world.
export type HeightField = { size: number; i0: number; k0: number; nx: number; nz: number; height: Int32Array; color: Uint32Array };

export function meshHeightField(field: HeightField, builder: QuadBuilder) {
  const { size, i0, k0, nx, nz, height, color } = field;
  const W = nx + 2;
  const at = (x: number, z: number) => x + 1 + W * (z + 1);
  // tops: merged where the height and the color are the same
  const done = new Uint8Array(nx * nz);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; ) {
      const k = at(x, z);
      const h = height[k]!, c = color[k]!;
      if (h <= 0 || done[x + nx * z]) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < nx && !done[x + w + nx * z] && height[at(x + w, z)] === h && color[at(x + w, z)] === c) w++;
      let d = 1;
      grow: while (z + d < nz) {
        for (let q = 0; q < w; q++) {
          const kk = at(x + q, z + d);
          if (done[x + q + nx * (z + d)] || height[kk] !== h || color[kk] !== c) break grow;
        }
        d++;
      }
      for (let dd = 0; dd < d; dd++) for (let q = 0; q < w; q++) done[x + q + nx * (z + dd)] = 1;
      const X0 = (i0 + x) * size, X1 = (i0 + x + w) * size, Z0 = (k0 + z) * size, Z1 = (k0 + z + d) * size, Y = h * size;
      builder.quad([X0, Y, Z1, X1, Y, Z1, X1, Y, Z0, X0, Y, Z0], [0, 1, 0], c);
      x += w;
    }
  }
  // sides: where a column is higher than its neighbour, from the neighbour's height up; merged along the side
  const sides: [number, number, [number, number, number]][] = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
  for (const [dx, dz, normal] of sides) {
    const alongX = dx === 0;
    const rows = alongX ? nz : nx;
    const len = alongX ? nx : nz;
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < len; ) {
        const x = alongX ? s : r, z = alongX ? r : s;
        const k = at(x, z);
        const h = height[k]!, lo = Math.max(0, height[at(x + dx, z + dz)]!), c = color[k]!;
        if (h <= lo) {
          s++;
          continue;
        }
        let w = 1;
        while (s + w < len) {
          const kk = alongX ? at(s + w, r) : at(r, s + w);
          const nk = alongX ? at(s + w + dx, r + dz) : at(r + dx, s + w + dz);
          if (height[kk] !== h || Math.max(0, height[nk]!) !== lo || color[kk] !== c) break;
          w++;
        }
        const Y0 = lo * size, Y1 = h * size;
        if (alongX) {
          const Z = (k0 + z + (dz > 0 ? 1 : 0)) * size, X0 = (i0 + s) * size, X1 = (i0 + s + w) * size;
          if (dz > 0) builder.quad([X0, Y0, Z, X1, Y0, Z, X1, Y1, Z, X0, Y1, Z], normal, c);
          else builder.quad([X1, Y0, Z, X0, Y0, Z, X0, Y1, Z, X1, Y1, Z], normal, c);
        } else {
          const X = (i0 + x + (dx > 0 ? 1 : 0)) * size, Z0 = (k0 + s) * size, Z1 = (k0 + s + w) * size;
          if (dx > 0) builder.quad([X, Y0, Z1, X, Y0, Z0, X, Y1, Z0, X, Y1, Z1], normal, c);
          else builder.quad([X, Y0, Z0, X, Y0, Z1, X, Y1, Z1, X, Y1, Z0], normal, c);
        }
        s += w;
      }
    }
  }
}
