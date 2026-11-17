// Makes the 3 shapes of plant/leafy from the 3 leafy plants of FlyFF (obj_macoprgr04, 05, 06 in assets/objects/models):
// the same stems and the same leaves at the same places, so that our plant has exactly their form.
//   node assets/plant/leafy/import-leafy.mjs   -> writes "models" into the sizes of assets/plant/leafy/plant.json
// A FlyFF plant is a few flat pieces with a picture of leaves on them (its texture): a big curved sheet with a fan of
// leaves painted on it, small sheets for the little leaves and the blades of grass at its foot, and thin tubes for its
// stems. Each leaf is given here by where it is in the picture (LEAVES: its base and its tip, in pixels of a 512 x 512
// picture, and how wide it can be at most). The script finds every piece of the model that carries that leaf, and puts
// the leaf on the piece in 3D: so a leaf of the fan lies on the curved sheet exactly where FlyFF shows it. How wide the
// leaf is along its rib comes from the picture (where it stops being opaque), never more than its width. A tube is
// cut in rings (points of the same place along the picture): its stem is the line through their middles.
// The output is in FlyFF units, from the place of the model: the builder (web/gen/builders/leafy.js) brings them to ours.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(HERE, '../../objects/models');
const SAMPLES = 8;     // pieces along a leaf

// the leaves of each picture: [base x, base y, tip x, tip y, most half-width] in pixels of 512, and fan: true for the
// leaves of a fan, which cover each other in the picture (so they narrow to their base, and the ones that cover others
// are lifted a little above them, in this order)
const LEAVES = {
  obj_macoprgr04: [
    [125, 228, 150, 410, 55, true], [125, 205, 178, 10, 60, true], [185, 235, 505, 235, 62, true],   // the fan, from under to over
    [185, 215, 470, 75, 65, true], [145, 205, 290, 10, 62, true], [140, 225, 300, 432, 80, true],
    [35, 100, 35, 6, 32],      // the small leaf (on the stems)
    [42, 335, 45, 122, 28],    // the blade of grass (at the foot)
  ],
  obj_macoprgr06: [
    [500, 160, 4, 140, 150],   // the big leaf
    [462, 436, 238, 437, 22],  // the blade of grass
  ],
};
const STEM = { obj_macoprgr04: [0.86, 1], obj_macoprgr06: [0.6, 0.75] };   // the stripe of the picture the stems use (v)
const PLANTS = [['obj_macoprgr04', 'obj_macoprgr04'], ['obj_macoprgr05', 'obj_macoprgr04'], ['obj_macoprgr06', 'obj_macoprgr06']];

// a .glb file -> { pos (with the place of its node), uv, idx }
function readGlb(file) {
  const glb = fs.readFileSync(file), jl = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jl).toString()), bin = glb.subarray(20 + jl + 8);
  const read = (ai) => {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
    const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = bv.byteStride ?? n * size, out = [];
    for (let i = 0; i < a.count; i++) {
      const row = [];
      for (let k = 0; k < n; k++) {
        const o = off + i * stride + k * size;
        row.push(a.componentType === 5126 ? bin.readFloatLE(o) : size === 2 ? bin.readUInt16LE(o) : bin.readUInt32LE(o));
      }
      out.push(n === 1 ? row[0] : row);
    }
    return out;
  };
  const node = json.nodes.find((n) => n.mesh !== undefined), t = node.translation ?? [0, 0, 0];
  const prim = json.meshes[node.mesh].primitives[0];
  return { pos: read(prim.attributes.POSITION).map((v) => v.map((x, k) => x + t[k])), uv: read(prim.attributes.TEXCOORD_0), idx: read(prim.indices) };
}

// a .png file (8 bit RGBA, as assets/flyff.mjs writes them) -> alpha(u, v): 0 to 1
function readAlpha(file) {
  const png = fs.readFileSync(file), idat = [];
  let w = 0, h = 0;
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8), data = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 4), row = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)];
    for (let x = 0; x < row; x++) {
      const a = x >= 4 ? px[y * row + x - 4] : 0, b = y ? px[(y - 1) * row + x] : 0, c = x >= 4 && y ? px[(y - 1) * row + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * row + x] = (raw[y * (row + 1) + 1 + x] + pred) & 255;
    }
  }
  return (u, v) => {
    const x = Math.floor(u * w), y = Math.floor(v * h);
    return x < 0 || y < 0 || x >= w || y >= h ? 0 : px[(y * w + x) * 4 + 3] / 255;
  };
}

// the pieces of a model: its triangles in groups that share corners
function piecesOf(m) {
  const parent = m.pos.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let k = 0; k < m.idx.length; k += 3) for (const j of [1, 2]) parent[find(m.idx[k + j])] = find(m.idx[k]);
  const groups = new Map();
  for (let k = 0; k < m.idx.length; k += 3) {
    const g = find(m.idx[k]);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([m.idx[k], m.idx[k + 1], m.idx[k + 2]]);
  }
  return [...groups.values()];
}

// where the picture point (u, v) is on a piece in 3D: on the triangle that holds it (or the nearest one, carried on)
function placeOn(m, tris, u, v) {
  let best = null, score = -Infinity;
  for (const [a, b, c] of tris) {
    const [ua, va] = m.uv[a], [ub, vb] = m.uv[b], [uc, vc] = m.uv[c];
    const d = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (Math.abs(d) < 1e-9) continue;
    const wb = ((u - ua) * (vc - va) - (uc - ua) * (v - va)) / d, wc = ((ub - ua) * (v - va) - (u - ua) * (vb - va)) / d;
    const s = Math.min(1 - wb - wc, wb, wc);
    if (s > score) { score = s; best = [a, b, c, 1 - wb - wc, wb, wc]; }
  }
  const [a, b, c, wa, wb, wc] = best;
  return { at: [0, 1, 2].map((k) => m.pos[a][k] * wa + m.pos[b][k] * wb + m.pos[c][k] * wc), inside: score > -0.02 };
}

const round = (v) => v.map((x) => Math.round(x * 100) / 100);
const lerp = (a, b, t) => a + (b - a) * t;

function modelOf(name, picture) {
  const m = readGlb(path.join(MODELS, name + '.glb')), alpha = readAlpha(path.join(MODELS, 'textures', picture + '.png'));
  const [s0, s1] = STEM[picture], stems = [], leaves = [];
  for (const tris of piecesOf(m)) {
    const corners = [...new Set(tris.flat())];
    if (corners.every((i) => m.uv[i][1] >= s0 - 0.01 && m.uv[i][1] <= s1 + 0.01)) {
      // a stem: its rings are the corners at the same place along the picture (u)
      const rings = new Map();
      for (const i of corners) {
        const key = Math.round(m.uv[i][0] * 10);
        if (!rings.has(key)) rings.set(key, []);
        rings.get(key).push(m.pos[i]);
      }
      stems.push([...rings.entries()].sort((a, b) => a[0] - b[0]).map(([, ps]) => {
        const mid = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length);
        return round([...mid, Math.max(0.03, ps.reduce((s, p) => s + Math.hypot(p[0] - mid[0], p[2] - mid[2]), 0) / ps.length)]);
      }));
      continue;
    }
    LEAVES[picture].forEach(([bx, by, tx, ty, most, fan], layer) => {
      const [bu, bv, tu, tv, wmax] = [bx, by, tx, ty, most].map((x) => x / 512);
      if (!placeOn(m, tris, bu, bv).inside) return;
      const len = Math.hypot(tu - bu, tv - bv), su = -(tv - bv) / len, sv = (tu - bu) / len, lift = fan ? layer * 0.015 : 0;
      const rows = [];
      for (let i = 0; i <= SAMPLES; i++) {
        const t = i / SAMPLES, u = lerp(bu, tu, t), v = lerp(bv, tv, t);
        // how wide on each side: up to where the picture stops being opaque, at most its width (a leaf of a fan: narrow
        // at both ends)
        const most = fan ? wmax * Math.sin(Math.PI * Math.min(0.97, Math.max(0.03, t))) ** 0.6 : wmax;
        const half = (side) => {
          let e = 0;
          while (e < most && alpha(u + su * side * (e + 0.004), v + sv * side * (e + 0.004)) > 0.5) e += 0.004;
          return Math.min(e, most);
        };
        const ends = [-1, 1].map((side) => { const e = half(side); return placeOn(m, tris, u + su * side * e, v + sv * side * e).at; });
        const rib = placeOn(m, tris, u, v).at;
        rows.push(round([rib, ...ends].flatMap(([x, y, z]) => [x, y + lift, z])));
      }
      leaves.push(rows);
    });
  }
  return { stems, leaves };
}

const file = path.join(HERE, 'plant.json'), type = JSON.parse(fs.readFileSync(file, 'utf8'));
const models = PLANTS.map(([name, picture]) => modelOf(name, picture));
// one stem or one leaf per line
const list = (rows, pad) => '[\n' + rows.map((r) => pad + '  ' + JSON.stringify(r)).join(',\n') + '\n' + pad + ']';
const modelsText = '[\n' + models.map((m) => `    {\n     "stems": ${list(m.stems, '     ')},\n     "leaves": ${list(m.leaves, '     ')}\n    }`).join(',\n') + '\n   ]';
const sizes = Object.entries(type.sizes).map(([size, values]) => {
  const { models: _, ...rest } = values;
  return `  "${size}": {${Object.entries(rest).map(([k, v]) => `"${k}": ${JSON.stringify(v).replace(/,/g, ', ')}, `).join('')}"models": ${modelsText}}`;
});
const head = '{\n' + Object.entries(type).filter(([k]) => k !== 'sizes').map(([k, v]) => ` "${k}": ${JSON.stringify(v)}`).join(',\n');
fs.writeFileSync(file, `${head},\n "sizes": {\n${sizes.join(',\n')}\n }\n}\n`);
console.log(models.map((m, i) => `${PLANTS[i][0]}: ${m.stems.length} stems, ${m.leaves.length} leaves`).join('; '));
