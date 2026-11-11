// The voxel converter itself (lib/voxels.js says what it is for): plain numbers in and out, no Three.js, so it runs
// in the page and in the voxel workers (lib/voxelWorker.js) alike.
//   voxelize: each triangle is sampled every half voxel; a voxel is kept when its centre is inside the shape, within
//   one voxel of the surface (so a shape keeps its size and has no hole). When several faces fall in one voxel, the
//   one that faces the camera wins, then the outer one, then the sample nearest to the voxel centre.
//   With normals, each voxel keeps the normal of the surface it comes from, so a slope is lit like before and only
//   its edges become steps; without, each cube face is lit by its own normal.
//   meshArrays: only the faces between a voxel and an empty voxel are kept, and the faces of one direction, colour
//   and normal are merged into the largest rectangles (greedy meshing).

// ------------------------------------------------------------------ normals
// a unit normal in 16 bits (octahedral, 8 bits per axis): equal normals give equal codes, so the voxels of one flat
// face still merge
export function encodeNormal(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = z / l;
  if (y < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  return (Math.round((u * 0.5 + 0.5) * 255) << 8) | Math.round((v * 0.5 + 0.5) * 255);
}

export function decodeNormal(code, out) {
  const u = ((code >> 8) / 255) * 2 - 1, v = ((code & 255) / 255) * 2 - 1;
  let x = u, z = v;
  const y = 1 - Math.abs(u) - Math.abs(v);
  if (y < 0) {
    x = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
    z = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
  }
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

// ------------------------------------------------------------------ voxelize
// sources: [{ tris: { p, nrm, uv } (lib/voxels.js triangles), colorAt: (u, v) -> a colour (the human and the monsters:
//   0xRRGGBB of their texture), color: one colour (default 0) }]
// size: the voxel edge, in the units of the matrices (the grid starts at 0 there).
// opts: normals (keep the surface normals), fill (fill closed shapes, so no face is made inside them),
//   view (toward the camera, in the same units), box ([x0, y0, z0, x1, y1, z1]: only the voxels whose centre is inside)
// -> { size, min, n, data (colour + 1, 0: empty), normals } or null
export function voxelize(sources, size, opts = {}) {
  const view = opts.view ?? [0, 0.545, 0.839];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const tris = sources.map((s) => s.tris);
  for (const { p } of tris) for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) {
    if (p[i + a] < lo[a]) lo[a] = p[i + a];
    if (p[i + a] > hi[a]) hi[a] = p[i + a];
  }
  if (opts.box) for (let a = 0; a < 3; a++) { lo[a] = Math.max(lo[a], opts.box[a]); hi[a] = Math.min(hi[a], opts.box[a + 3]); }
  if (!(lo[0] <= hi[0] && lo[1] <= hi[1] && lo[2] <= hi[2])) return null;
  const min = lo.map((v) => Math.floor(v / size) - 1), n = hi.map((v, a) => Math.floor(v / size) + 2 - min[a]);
  if (opts.box) for (let a = 0; a < 3; a++) {
    // the voxels whose centre is in the box (x0 <= centre < x1), so two boxes side by side share none
    const first = Math.ceil(opts.box[a] / size - 0.5), last = Math.ceil(opts.box[a + 3] / size - 0.5) - 1;
    if (min[a] < first) { n[a] -= first - min[a]; min[a] = first; }
    n[a] = Math.min(n[a], last - min[a] + 1);
    if (n[a] <= 0) return null;
  }
  const [nx, ny, nz] = n, cells = nx * ny * nz;
  const data = new Uint32Array(cells), normals = opts.normals ? new Uint16Array(cells) : null;
  const score = new Float32Array(cells).fill(-9);

  for (let s = 0; s < sources.length; s++) {
    const { p, nrm, uv } = tris[s], colorAt = sources[s].colorAt, color = sources[s].color ?? 0;
    for (let t = 0; t < p.length; t += 9) {
      const ax = p[t], ay = p[t + 1], az = p[t + 2];
      const abx = p[t + 3] - ax, aby = p[t + 4] - ay, abz = p[t + 5] - az;
      const acx = p[t + 6] - ax, acy = p[t + 7] - ay, acz = p[t + 8] - az;
      let Nx = aby * acz - abz * acy, Ny = abz * acx - abx * acz, Nz = abx * acy - aby * acx;
      const nl = Math.hypot(Nx, Ny, Nz);
      if (nl === 0) continue;
      Nx /= nl; Ny /= nl; Nz /= nl;
      const facing = Nx * view[0] + Ny * view[1] + Nz * view[2];
      const ax_ = Math.abs(Nx), ay_ = Math.abs(Ny), az_ = Math.abs(Nz);
      const thin = size * Math.max(ax_, ay_, az_) + 1e-6;
      // one voxel toward the inside along the main axis of the normal
      const sx = ax_ >= ay_ && ax_ >= az_ ? Math.sign(Nx) : 0, sy = !sx && ay_ >= az_ ? Math.sign(Ny) : 0, sz = !sx && !sy ? Math.sign(Nz) : 0;
      const bcx = acx - abx, bcy = acy - aby, bcz = acz - abz;
      const longest = Math.max(Math.hypot(abx, aby, abz), Math.hypot(acx, acy, acz), Math.hypot(bcx, bcy, bcz));
      const steps = Math.max(1, Math.ceil(longest / (size * 0.5)));
      const uvt = uv ? (t / 9) * 6 : -1, nt = t;
      for (let i = 0; i <= steps; i++) for (let j = 0; i + j <= steps; j++) {
        const a = i / steps, b = j / steps;
        const x = ax + abx * a + acx * b, y = ay + aby * a + acy * b, z = az + abz * a + acz * b;
        const bx = Math.floor(x / size) - min[0], by = Math.floor(y / size) - min[1], bz = Math.floor(z / size) - min[2];
        // the voxel of the sample, and the one next to it toward the inside (a thin surface, on its inner side)
        for (let c = 0; c < 2; c++) {
          const vx = bx - (c ? sx : 0), vy = by - (c ? sy : 0), vz = bz - (c ? sz : 0);
          if (vx < 0 || vy < 0 || vz < 0 || vx >= nx || vy >= ny || vz >= nz) continue;
          const cx = (vx + min[0] + 0.5) * size, cy = (vy + min[1] + 0.5) * size, cz = (vz + min[2] + 0.5) * size;
          const depth = (cx - ax) * Nx + (cy - ay) * Ny + (cz - az) * Nz;
          if (depth > 1e-6 || depth < -thin) continue;
          const k = vx + nx * (vy + ny * vz);
          const rank = facing - (0.5 * depth) / size - (0.2 * Math.hypot(x - cx, y - cy, z - cz)) / size;
          if (rank <= score[k]) continue;
          score[k] = rank;
          const w = 1 - a - b;
          data[k] = (colorAt ? colorAt(uv[uvt] * w + uv[uvt + 2] * a + uv[uvt + 4] * b, uv[uvt + 1] * w + uv[uvt + 3] * a + uv[uvt + 5] * b) : color) + 1;
          if (normals) {
            const qx = nrm[nt] * w + nrm[nt + 3] * a + nrm[nt + 6] * b;
            const qy = nrm[nt + 1] * w + nrm[nt + 4] * a + nrm[nt + 7] * b;
            const qz = nrm[nt + 2] * w + nrm[nt + 5] * a + nrm[nt + 8] * b;
            normals[k] = encodeNormal(qx, qy, qz);
          }
        }
      }
    }
  }
  const volume = { size, min, n, data, normals };
  if (opts.fill) fillInside(volume);
  return volume;
}

// fills every empty voxel that cannot be reached from outside the box (6 neighbours); they take the colour of the
// last solid voxel of their row (they are never seen)
function fillInside({ n: [nx, ny, nz], data }) {
  const outside = new Uint8Array(data.length), queue = new Int32Array(data.length);
  let head = 0, tail = 0;
  const seed = (k) => { if (!data[k] && !outside[k]) { outside[k] = 1; queue[tail++] = k; } };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { seed(nx * (y + ny * z)); seed(nx - 1 + nx * (y + ny * z)); }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { seed(x + nx * ny * z); seed(x + nx * (ny - 1 + ny * z)); }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { seed(x + nx * y); seed(x + nx * (y + ny * (nz - 1))); }
  const sz = nx * ny;
  while (head < tail) {
    const k = queue[head++], x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / sz);
    if (x > 0) seed(k - 1);
    if (x < nx - 1) seed(k + 1);
    if (y > 0) seed(k - nx);
    if (y < ny - 1) seed(k + nx);
    if (z > 0) seed(k - sz);
    if (z < nz - 1) seed(k + sz);
  }
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    let last = 0;
    for (let x = 0; x < nx; x++) {
      const k = x + nx * (y + ny * z);
      if (data[k]) last = data[k];
      else if (!outside[k] && last) data[k] = last;
    }
  }
}

// ------------------------------------------------------------------ mesh
// the visible faces of a volume, merged (greedy meshing) -> { position, normal, color (with `colors`: the colour of
// each corner), index } or null. only: the faces of the voxels of this colour only (the others still hide
// the faces next to them)
export function meshArrays(volume, { colors: withColor = false, only = -1 } = {}) {
  const { size, min, n, data, normals } = volume;
  const [nx, ny, nz] = n;
  const positions = [], nrms = [], colors = [], indices = [];
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : data[x + nx * (y + ny * z)]);
  // the faces merge where both the colour and the surface normal (if any) are the same
  const keyOf = (k) => (normals ? data[k] * 65536 + normals[k] : data[k]);
  const decoded = [0, 0, 0], pos = [0, 0, 0], p = [0, 0, 0];
  const corner = (d, u, v, plane, a, b) => {
    p[d] = plane; p[u] = a; p[v] = b;
    positions.push((p[0] + min[0]) * size, (p[1] + min[1]) * size, (p[2] + min[2]) * size);
  };
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3, du = n[u], dv = n[v];
    const mask = new Float64Array(du * dv);
    for (const sign of [1, -1]) {
      const axis = [0, 0, 0];
      axis[d] = sign;
      for (let slice = 0; slice < n[d]; slice++) {
        let any = false;
        for (let b = 0; b < dv; b++) for (let a = 0; a < du; a++) {
          pos[d] = slice; pos[u] = a; pos[v] = b;
          let m = 0;
          const here = get(pos[0], pos[1], pos[2]);
          if (here && (only < 0 || here === only + 1)) {
            const key = keyOf(pos[0] + nx * (pos[1] + ny * pos[2]));
            pos[d] = slice + sign;
            if (!get(pos[0], pos[1], pos[2])) m = key;
          }
          mask[a + du * b] = m;
          if (m) any = true;
        }
        if (!any) continue;
        const plane = slice + (sign > 0 ? 1 : 0);
        for (let b = 0; b < dv; b++) for (let a = 0; a < du;) {
          const c = mask[a + du * b];
          if (!c) { a++; continue; }
          let w = 1;
          while (a + w < du && mask[a + w + du * b] === c) w++;
          let h = 1;
          grow: while (b + h < dv) {
            for (let k = 0; k < w; k++) if (mask[a + k + du * (b + h)] !== c) break grow;
            h++;
          }
          for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[a + k + du * (b + hh)] = 0;
          const base = positions.length / 3;
          if (sign > 0) { corner(d, u, v, plane, a, b); corner(d, u, v, plane, a + w, b); corner(d, u, v, plane, a + w, b + h); corner(d, u, v, plane, a, b + h); } else { corner(d, u, v, plane, a, b); corner(d, u, v, plane, a, b + h); corner(d, u, v, plane, a + w, b + h); corner(d, u, v, plane, a + w, b); }
          const normal = normals ? decodeNormal(c % 65536, decoded) : axis;
          const color = (normals ? Math.floor(c / 65536) : c) - 1;
          for (let q = 0; q < 4; q++) {
            nrms.push(normal[0], normal[1], normal[2]);
            if (withColor) colors.push(color);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          a += w;
        }
      }
    }
  }
  if (!indices.length) return null;
  const n4 = positions.length / 3;
  return { position: new Float32Array(positions), normal: new Float32Array(nrms), color: withColor ? new Uint32Array(colors) : null,
    index: n4 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices) };
}
