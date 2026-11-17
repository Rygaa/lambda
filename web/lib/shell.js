// The cubes of a body (lib/voxelBody.js), made away from the page in a worker (lib/shellWorker.js), so the game does not
// wait for them: plain arrays in, plain arrays out, nothing of three.js.
//   parts: [{ cut, tex: { width, height, data (RGBA) } }]; frame: one entry per part { p (positions), index, uv (2 a
//   vertex, as BufferAttribute getX and getY give them) }

// (u, v) -> 0xRRGGBB of a texture (repeated, nearest texel, flipY false like lib/bake.js); .alpha(u, v): its opacity,
// 0 to 255
const readers = new WeakMap();
function reader(tex) {
  if (readers.has(tex)) return readers.get(tex);
  const { width, height, data } = tex;
  const texel = (u, v) => Math.min(height - 1, Math.floor((v - Math.floor(v)) * height)) * width + Math.min(width - 1, Math.floor((u - Math.floor(u)) * width));
  const at = (u, v) => {
    const k = texel(u, v);
    return (data[k * 4] << 16) | (data[k * 4 + 1] << 8) | data[k * 4 + 2];
  };
  at.alpha = (u, v) => data[texel(u, v) * 4 + 3];
  readers.set(tex, at);
  return at;
}

// the outside cubes of one frame (one geometry per part), with where each comes from. size: the cube edge, in the
// units of the body. A part with `cut` has holes where its texture is clear (no cube there); all: every cube, not
// only those of the outside (the hair of the gold form opens: lib/form.js). -> { count, part, tri (3 vertex indices a
// cube), bary (2), local (3: the centre from its place, along the triangle edge, across it, along its normal), rgb }
// the cells one part fills, alone: for each cell the sample that wins it (the outer face, then the nearest to the
// centre), in absolute cells of `size`. A part is made again only when it changed (its posed positions, triangles,
// texture, cube size): partCells keeps the last ones, so a new weapon makes only the weapon again.
// Two parts merge as if all their samples were tried one after the other (shellOf): a later part takes a cell only
// if one of its winners on the way beat the score there, so each cell keeps `max`: the best score on its way
const KEEP = 64;
const partCells = new Map();
function hashOf(arrays) {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const w = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
    h = Math.imul(h ^ w.length, 0x01000193);
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193);
  }
  return h >>> 0;
}
function cellsOf(part, g, size) {
  const key = `${size} ${part.cut ? part.texId : '-'} ${hashOf(part.cut ? [g.p, g.index, g.uv] : [g.p, g.index])} ${g.p.length} ${g.index.length}`;
  const found = partCells.get(key);
  if (found) { partCells.delete(key); partCells.set(key, found); return found; }
  const p = g.p, index = g.index, uvs = g.uv;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[i + a]); hi[a] = Math.max(hi[a], p[i + a]); }
  const min = lo.map((v) => Math.floor(v / size) - 1), n = hi.map((v, a) => Math.floor(v / size) + 2 - min[a]);
  const [nx, ny, nz] = n, cells = p.length ? nx * ny * nz : 0;
  const score = new Float32Array(cells).fill(-9), best = new Float64Array(cells).fill(-Infinity), won = new Uint8Array(cells);
  const triOf = new Int32Array(cells), ba = new Float32Array(cells), bb = new Float32Array(cells);
  const clear = part.cut && reader(part.tex).alpha;
  for (let t = 0; t < index.length; t += 3) {
    const i0 = index[t] * 3, i1 = index[t + 1] * 3, i2 = index[t + 2] * 3;
    const ax = p[i0], ay = p[i0 + 1], az = p[i0 + 2];
    const abx = p[i1] - ax, aby = p[i1 + 1] - ay, abz = p[i1 + 2] - az;
    const acx = p[i2] - ax, acy = p[i2 + 1] - ay, acz = p[i2 + 2] - az;
    let Nx = aby * acz - abz * acy, Ny = abz * acx - abx * acz, Nz = abx * acy - aby * acx;
    const nl = Math.hypot(Nx, Ny, Nz);
    if (nl === 0) continue;
    Nx /= nl; Ny /= nl; Nz /= nl;
    const axn = Math.abs(Nx), ayn = Math.abs(Ny), azn = Math.abs(Nz);
    const thin = size * Math.max(axn, ayn, azn) + 1e-6;
    const sx = axn >= ayn && axn >= azn ? Math.sign(Nx) : 0, sy = !sx && ayn >= azn ? Math.sign(Ny) : 0, sz = !sx && !sy ? Math.sign(Nz) : 0;
    const longest = Math.max(Math.hypot(abx, aby, abz), Math.hypot(acx, acy, acz), Math.hypot(acx - abx, acy - aby, acz - abz));
    const steps = Math.max(1, Math.ceil(longest / (size * 0.5)));
    for (let i = 0; i <= steps; i++) for (let j = 0; i + j <= steps; j++) {
      const a = i / steps, b = j / steps;
      if (clear) {
        const i0 = index[t], i1 = index[t + 1], i2 = index[t + 2], c = 1 - a - b;
        if (clear(uvs[i0 * 2] * c + uvs[i1 * 2] * a + uvs[i2 * 2] * b, uvs[i0 * 2 + 1] * c + uvs[i1 * 2 + 1] * a + uvs[i2 * 2 + 1] * b) < 128) continue;
      }
      const x = ax + abx * a + acx * b, y = ay + aby * a + acy * b, z = az + abz * a + acz * b;
      const bx = Math.floor(x / size) - min[0], by = Math.floor(y / size) - min[1], bz = Math.floor(z / size) - min[2];
      for (let c = 0; c < 2; c++) {
        const vx = bx - (c ? sx : 0), vy = by - (c ? sy : 0), vz = bz - (c ? sz : 0);
        if (vx < 0 || vy < 0 || vz < 0 || vx >= nx || vy >= ny || vz >= nz) continue;
        const cx = (vx + min[0] + 0.5) * size, cy = (vy + min[1] + 0.5) * size, cz = (vz + min[2] + 0.5) * size;
        const depth = (cx - ax) * Nx + (cy - ay) * Ny + (cz - az) * Nz;
        if (depth > 1e-6 || depth < -thin) continue;
        const k = vx + nx * (vy + ny * vz);
        // the outer face wins (it turns, so no side faces the camera), then the sample nearest to the centre
        const rank = -(0.5 * depth) / size - (0.2 * Math.hypot(x - cx, y - cy, z - cz)) / size;
        if (rank <= score[k]) continue;
        score[k] = rank; won[k] = 1; triOf[k] = t; ba[k] = a; bb[k] = b;
        if (rank > best[k]) best[k] = rank;
      }
    }
  }
  let count = 0;
  for (let k = 0; k < cells; k++) count += won[k];
  const out = { count, cell: new Int32Array(count * 3), tri: new Int32Array(count), a: new Float32Array(count), b: new Float32Array(count),
    score: new Float32Array(count), max: new Float64Array(count) };
  for (let z = 0, k = 0, q = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, k++) {
    if (!won[k]) continue;
    out.cell[q * 3] = x + min[0]; out.cell[q * 3 + 1] = y + min[1]; out.cell[q * 3 + 2] = z + min[2];
    out.tri[q] = triOf[k]; out.a[q] = ba[k]; out.b[q] = bb[k]; out.score[q] = score[k]; out.max[q] = best[k];
    q++;
  }
  partCells.set(key, out);
  while (partCells.size > KEEP) partCells.delete(partCells.keys().next().value);
  return out;
}

// the outside cubes of one frame (one geometry per part), with where each comes from. size: the cube edge, in the
// units of the body. A part with `cut` has holes where its texture is clear (no cube there); all: every cube, not
// only those of the outside (the hair of the gold form opens: lib/form.js). -> { count, part, tri (3 vertex indices a
// cube), bary (2), local (3: the centre from its place, along the triangle edge, across it, along its normal), rgb }
export function shellOf(parts, frame, size, all = false) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const g of frame) {
    const p = g.p;
    for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[i + a]); hi[a] = Math.max(hi[a], p[i + a]); }
  }
  const min = lo.map((v) => Math.floor(v / size) - 1), n = hi.map((v, a) => Math.floor(v / size) + 2 - min[a]);
  const [nx, ny, nz] = n, cells = nx * ny * nz;
  const score = new Float32Array(cells).fill(-9), src = new Int32Array(cells).fill(-1);
  const triOf = new Int32Array(cells), ba = new Float32Array(cells), bb = new Float32Array(cells);
  for (const [m, g] of frame.entries()) {
    const c = cellsOf(parts[m], g, size);
    for (let q = 0; q < c.count; q++) {
      const k = c.cell[q * 3] - min[0] + nx * (c.cell[q * 3 + 1] - min[1] + ny * (c.cell[q * 3 + 2] - min[2]));
      if (c.max[q] <= score[k]) continue;
      score[k] = c.score[q]; src[k] = m; triOf[k] = c.tri[q]; ba[k] = c.a[q]; bb[k] = c.b[q];
    }
  }
  // the outside: the empty cells reached from the border of the box (side by side, not across corners); a cube is
  // kept if it touches one. Each row along x is cut into runs of empty cells; two runs touch when they are in rows
  // next to each other (above, below, in front, behind) and share an x. The runs that touch, one through the other,
  // a run at the border are outside
  const sxy = nx * ny, rows = ny * nz;
  const first = new Int32Array(rows + 1);
  let start = new Int32Array(1024), end = new Int32Array(1024), runs = 0;
  for (let r = 0; r < rows; r++) {
    first[r] = runs;
    const row = r * nx;
    for (let x = 0; x < nx; x++) {
      if (src[row + x] >= 0) continue;
      const x0 = x;
      while (x + 1 < nx && src[row + x + 1] < 0) x++;
      if (runs === start.length) {
        const s2 = new Int32Array(runs * 2), e2 = new Int32Array(runs * 2);
        s2.set(start); e2.set(end); start = s2; end = e2;
      }
      start[runs] = x0; end[runs] = x; runs++;
    }
  }
  first[rows] = runs;
  const up = new Int32Array(runs);
  for (let i = 0; i < runs; i++) up[i] = i;
  const root = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  const join = (r1, r2) => {
    let i = first[r1], j = first[r2];
    const iEnd = first[r1 + 1], jEnd = first[r2 + 1];
    while (i < iEnd && j < jEnd) {
      if (start[i] <= end[j] && start[j] <= end[i]) { const a = root(i), b = root(j); if (a !== b) up[a] = b; }
      if (end[i] < end[j]) i++; else j++;
    }
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const r = y + ny * z;
    if (y > 0) join(r, r - 1);
    if (z > 0) join(r, r - ny);
  }
  const open = new Uint8Array(runs);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const r = y + ny * z, edge = y === 0 || z === 0 || y === ny - 1 || z === nz - 1;
    for (let i = first[r]; i < first[r + 1]; i++) if (edge || start[i] === 0 || end[i] === nx - 1) open[root(i)] = 1;
  }
  const outside = new Uint8Array(cells);
  for (let r = 0; r < rows; r++) for (let i = first[r]; i < first[r + 1]; i++) if (open[root(i)]) outside.fill(1, r * nx + start[i], r * nx + end[i] + 1);
  const kept = [];
  for (let z = 0, k = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, k++) {
      if (src[k] < 0) continue;
      if (all || x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1 ||
        outside[k - 1] || outside[k + 1] || outside[k - nx] || outside[k + nx] || outside[k - sxy] || outside[k + sxy]) kept.push(k);
    }
  }
  const count = kept.length, part = new Uint8Array(count), tri = new Uint32Array(count * 3), bary = new Float32Array(count * 2);
  const local = new Float32Array(count * 3), rgb = new Uint32Array(count);
  const colors = parts.map((pt) => reader(pt.tex)), P = [0, 0, 0], E = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [q, k] of kept.entries()) {
    const m = src[k], g = frame[m], index = g.index, t = triOf[k];
    part[q] = m;
    tri.set([index[t], index[t + 1], index[t + 2]], q * 3);
    bary[q * 2] = ba[k]; bary[q * 2 + 1] = bb[k];
    placeOn(g.p, index[t], index[t + 1], index[t + 2], ba[k], bb[k], P, E);
    const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / sxy);
    const d = [(x + min[0] + 0.5) * size - P[0], (y + min[1] + 0.5) * size - P[1], (z + min[2] + 0.5) * size - P[2]];
    for (let e = 0; e < 3; e++) local[q * 3 + e] = d[0] * E[e][0] + d[1] * E[e][1] + d[2] * E[e][2];
    const uv = g.uv, w = 1 - ba[k] - bb[k];
    const u = uv[index[t] * 2] * w + uv[index[t + 1] * 2] * ba[k] + uv[index[t + 2] * 2] * bb[k];
    const v = uv[index[t] * 2 + 1] * w + uv[index[t + 1] * 2 + 1] * ba[k] + uv[index[t + 2] * 2 + 1] * bb[k];
    rgb[q] = colors[m](u, v);
  }
  return { count, part, tri, bary, local, rgb };
}

// the place (a, b) on a triangle of positions p (vertex indices i, j, k) -> P, and its frame E: along its first edge,
// across it, its normal
export function placeOn(p, i, j, k, a, b, P, E) {
  i *= 3; j *= 3; k *= 3;
  const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
  const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
  P[0] = p[i] + ux * a + vx * b; P[1] = p[i + 1] + uy * a + vy * b; P[2] = p[i + 2] + uz * a + vz * b;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  E[0][0] = ux / ul; E[0][1] = uy / ul; E[0][2] = uz / ul;
  E[2][0] = nx; E[2][1] = ny; E[2][2] = nz;
  E[1][0] = ny * E[0][2] - nz * E[0][1]; E[1][1] = nz * E[0][0] - nx * E[0][2]; E[1][2] = nx * E[0][1] - ny * E[0][0];
}
