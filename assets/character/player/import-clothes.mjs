// Copies the parts of the FlyFF male (heads, hair, and every piece of clothing) from the FlyFF data folder into
// parts/, turns their textures (.ktx2: BC1, BC2 or BC3 blocks, zstd) into .png in parts/textures/, and writes
// clothes.json: the list of each slot that the admin menu shows (web/systems/admin.js).
//   node assets/character/player/import-clothes.mjs /path/to/data_flyff
// It needs the zstd command (brew install zstd).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node import-clothes.mjs /path/to/data_flyff');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'parts'), TEX = path.join(OUT, 'textures');
fs.mkdirSync(TEX, { recursive: true });

// the "parts" value of an item (data/items.ron) -> its slot; 26 to 29 are the costume pieces
const SLOT = { 2: 'upper', 27: 'upper', 4: 'hand', 28: 'hand', 5: 'foot', 29: 'foot', 6: 'cap', 26: 'cap', 8: 'cloak', 12: 'mask' };
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });   // for the .png files
const IGNORE = { 0: 'head', 1: 'hair' };   // base_parts_ignore: the part of the body a cap hides

const slots = { head: [], hair: [], upper: [], hand: [], foot: [], cap: [], cloak: [], mask: [] };
const files = new Set();
const add = (slot, file, name, extra = {}) => { files.add(file); slots[slot].push({ name, file, ...extra }); };

const models = fs.readdirSync(path.join(SRC, 'models'));
for (const m of models.filter((f) => /^part_malehead\d+\.glb$/.test(f)).sort()) add('head', m.slice(0, -4), 'Head ' + m.match(/\d+/)[0]);
for (const m of models.filter((f) => /^part_malehair\d+\.glb$/.test(f)).sort()) add('hair', m.slice(0, -4), 'Hair ' + m.match(/\d+/)[0]);
for (const f of ['part_maleupper', 'part_malelower', 'part_malehand', 'part_malefoot']) files.add(f);   // the bare body

const items = fs.readFileSync(path.join(SRC, 'data/items.ron'), 'utf8');
for (const [, body] of items.matchAll(/\(\s*id: \d+,(.*?)\n    \)/gs)) {
  const model = body.match(/part_models: Some\(\("models\/([^"]+)\.glb"/)?.[1];
  const slot = SLOT[body.match(/parts: (\d+)/)?.[1]];
  if (!model || !slot || body.match(/sex: (\d+)/)[1] === '1' || files.has(model)) continue;
  if (!fs.existsSync(path.join(SRC, 'models', model + '.glb'))) continue;
  const hides = IGNORE[body.match(/base_parts_ignore: (\d+)/)[1]];
  add(slot, model, body.match(/name: "([^"]*)"/)[1] || model, hides ? { hides } : {});
}

// the .glb files and their textures
let n = 0;
for (const file of files) {
  const glb = fs.readFileSync(path.join(SRC, 'models', file + '.glb'));
  fs.writeFileSync(path.join(OUT, file + '.glb'), glb);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  for (const { uri } of json.images ?? []) {
    const name = path.basename(uri, path.extname(uri));
    const png = path.join(TEX, name + '.png');
    if (!fs.existsSync(png)) fs.writeFileSync(png, ktx2ToPng(fs.readFileSync(path.join(SRC, 'textures/model', name + '.ktx2'))));
  }
  if (++n % 100 === 0) console.log(n, '/', files.size);
}
fs.writeFileSync(path.join(HERE, 'clothes.json'), JSON.stringify({ source: 'FlyFF data/items.ron (import-clothes.mjs)', slots }, null, 1) + '\n');
console.log(files.size, 'parts;', Object.entries(slots).map(([k, v]) => `${k} ${v.length}`).join(', '));

// ------------------------------------------------------------------ textures
// the first (largest) level of a .ktx2 file, as RGBA pixels, then as a .png
function ktx2ToPng(buf) {
  const vk = buf.readUInt32LE(12), w = buf.readUInt32LE(20), h = buf.readUInt32LE(24), scheme = buf.readUInt32LE(44);
  const off = Number(buf.readBigUInt64LE(80)), len = Number(buf.readBigUInt64LE(88));
  let data = buf.subarray(off, off + len);
  if (scheme === 2) {   // through a file: zstd can hang on a pipe
    const tmp = path.join(os.tmpdir(), 'import-clothes.zst');
    fs.writeFileSync(tmp, data);
    data = execFileSync('zstd', ['-d', '-c', '-q', tmp], { maxBuffer: 1 << 28 });
  }
  else if (scheme !== 0) throw new Error('ktx2: supercompression ' + scheme);
  const kind = { 131: 1, 132: 1, 133: 1, 134: 1, 135: 2, 136: 2, 137: 3, 138: 3 }[vk];
  if (!kind) throw new Error('ktx2: format ' + vk);
  return png(w, h, decodeBC(data, w, h, kind));
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
