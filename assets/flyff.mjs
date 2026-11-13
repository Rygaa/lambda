// Helpers shared by the scripts that copy FlyFF data (character/player/import-items.mjs, monsters/import-monsters.mjs):
// the blocks of a .ron list, and the textures (.ktx2: BC1, BC2 or BC3 blocks, zstd) turned into .png files.
// ktx2ToPng needs the zstd command (brew install zstd).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });   // for the .png files

// the blocks `(\n ... \n    ),` of a .ron list at the first level (movers.ron, models.ron, items.ron): their texts
export const ronBlocks = (text) => [...text.matchAll(/\n    \((\n.*?)\n    \),?/gs)].map((m) => m[1] + '\n');
// one field of a block: its raw text (a number, a "string", Some(...)), or undefined
export const ronField = (block, name) => block.match(new RegExp(`\\n\\s*${name}: ([^\\n]*?),?\\n`))?.[1];

// the .png of the .ktx2 texture `name` of the FlyFF data folder, written once to `dir`; opaque: its alpha is not a
// cut-out (the material of the part is opaque), so every texel gets alpha 255
export function copyTexture(src, name, dir, opaque = false) {
  const out = path.join(dir, name + '.png');
  if (!fs.existsSync(out)) fs.writeFileSync(out, ktx2ToPng(fs.readFileSync(path.join(src, 'textures/model', name + '.ktx2')), opaque));
  return out;
}

// the texture names of a .glb file (its images, without folder and extension)
export function texturesOf(glb) {
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  return (json.images ?? []).map(({ uri }) => path.basename(uri, path.extname(uri)));
}

// the box of a .glb file (all its meshes, through its node tree), in FlyFF units: [x0, y0, z0, x1, y1, z1], or null
// (no mesh). Each mesh counts for the box of its POSITION accessor, so it can be a little larger than the shape
export function boxOf(glb) {
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  const local = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const walk = (i, parent) => {
    const node = json.nodes[i], m = mul(parent, local(node));
    if (node.mesh !== undefined) for (const prim of json.meshes[node.mesh].primitives) {
      const a = json.accessors[prim.attributes.POSITION];
      for (let c = 0; c < 8; c++) {
        const v = [0, 1, 2].map((k) => ((c >> k) & 1 ? a.max[k] : a.min[k]));
        for (let r = 0; r < 3; r++) {
          const x = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r];
          lo[r] = Math.min(lo[r], x); hi[r] = Math.max(hi[r], x);
        }
      }
    }
    for (const child of node.children ?? []) walk(child, m);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return lo[0] > hi[0] ? null : [...lo, ...hi];
}

// the first (largest) level of a .ktx2 file, as RGBA pixels, then as a .png (opaque: every alpha 255)
export function ktx2ToPng(buf, opaque = false) {
  const vk = buf.readUInt32LE(12), w = buf.readUInt32LE(20), h = buf.readUInt32LE(24), scheme = buf.readUInt32LE(44);
  const off = Number(buf.readBigUInt64LE(80)), len = Number(buf.readBigUInt64LE(88));
  let data = buf.subarray(off, off + len);
  if (scheme === 2) {   // through a file: zstd can hang on a pipe
    const tmp = path.join(os.tmpdir(), 'flyff-texture.zst');
    fs.writeFileSync(tmp, data);
    data = execFileSync('zstd', ['-d', '-c', '-q', tmp], { maxBuffer: 1 << 28 });
  }
  else if (scheme !== 0) throw new Error('ktx2: supercompression ' + scheme);
  const kind = { 131: 1, 132: 1, 133: 1, 134: 1, 135: 2, 136: 2, 137: 3, 138: 3 }[vk];
  if (!kind) throw new Error('ktx2: format ' + vk);
  const rgba = decodeBC(data, w, h, kind);
  if (opaque) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return png(w, h, rgba);
}

function decodeBC(data, w, h, kind) {
  const out = new Uint8Array(w * h * 4), size = kind === 1 ? 8 : 16;
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  const rgb = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const b = (by * bw + bx) * size, cb = b + size - 8;
    const c0 = data[cb] | (data[cb + 1] << 8), c1 = data[cb + 2] | (data[cb + 3] << 8);
    const p0 = rgb(c0), p1 = rgb(c1), four = kind !== 1 || c0 > c1;
    const pal = four
      ? [[...p0, 255], [...p1, 255], [...p0.map((v, i) => (2 * v + p1[i]) / 3), 255], [...p0.map((v, i) => (v + 2 * p1[i]) / 3), 255]]
      : [[...p0, 255], [...p1, 255], [...p0.map((v, i) => (v + p1[i]) / 2), 255], [0, 0, 0, 0]];
    const bits = data[cb + 4] | (data[cb + 5] << 8) | (data[cb + 6] << 16) | (data[cb + 7] << 24);
    // BC3 alpha: two ends and 3-bit indices
    let alphas = null, abits = 0n;
    if (kind === 3) {
      const a0 = data[b], a1 = data[b + 1];
      alphas = a0 > a1 ? [a0, a1, ...[1, 2, 3, 4, 5, 6].map((k) => ((7 - k) * a0 + k * a1) / 7)]
        : [a0, a1, ...[1, 2, 3, 4].map((k) => ((5 - k) * a0 + k * a1) / 5), 0, 255];
      for (let k = 0; k < 6; k++) abits |= BigInt(data[b + 2 + k]) << BigInt(8 * k);
    }
    for (let k = 0; k < 16; k++) {
      const x = bx * 4 + (k & 3), y = by * 4 + (k >> 2);
      if (x >= w || y >= h) continue;
      const c = pal[(bits >>> (2 * k)) & 3], o = (y * w + x) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
      out[o + 3] = kind === 1 ? c[3] : kind === 2 ? ((data[b + (k >> 1)] >> (4 * (k & 1))) & 15) * 17 : alphas[Number((abits >> BigInt(3 * k)) & 7n)];
    }
  }
  return out;
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (type, body) => {
    const t = Buffer.concat([Buffer.from(type), body]), c = Buffer.alloc(4), l = Buffer.alloc(4);
    l.writeUInt32BE(body.length); c.writeUInt32BE(crc(t));
    return Buffer.concat([l, t, c]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function crc(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
