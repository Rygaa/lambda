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
  // score: the rank of the face kept in each voxel (read only where a face is); first, last: the first and last voxel
  // of each row (y, z) with a face, so the steps after look only between them
  const score = new Float32Array(cells), rows = ny * nz, first = new Int32Array(rows).fill(nx), last = new Int32Array(rows).fill(-1);

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
          const dx = x - cx, dy = y - cy, dz = z - cz;
          const rank = facing - (0.5 * depth) / size - (0.2 * Math.sqrt(dx * dx + dy * dy + dz * dz)) / size;
          if (data[k] && rank <= score[k]) continue;
          score[k] = rank;
          const row = vy + ny * vz;
          if (vx < first[row]) first[row] = vx;
          if (vx > last[row]) last[row] = vx;
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
  const volume = { size, min, n, data, normals, first, last };
  if (opts.fill) fillInside(volume);
  return volume;
}

// fills every empty voxel that cannot be reached from outside the box (6 neighbours); they take the colour of the
// last solid voxel of their row (they are never seen). In a row, the voxels before its first solid one and after its
// last one reach the outside along the row, so only the empty runs between two solid voxels (the middle runs) can be
// inside: one is outside when it is on a side of the box or next to a voxel outside, found row by row (a scanline fill)
function fillInside({ n: [nx, ny, nz], data, first, last }) {
  const outside = new Uint8Array(data.length), sxy = nx * ny;
  let stack = new Int32Array(1024), top = 0;
  // the voxel x of the row (y, z) is outside: before the first solid voxel, after the last, or marked
  const out = (row, r, x) => x < first[r] || x > last[r] || outside[row + x] === 1;
  // a middle run found outside: marked, and its neighbours looked at later
  const mark = (row, x0, x1) => {
    outside.fill(1, row + x0, row + x1 + 1);
    if (top + 2 > stack.length) { const bigger = new Int32Array(stack.length * 2); bigger.set(stack); stack = bigger; }
    stack[top++] = row + x0; stack[top++] = x1;
  };
  // the middle runs of the row (y, z), between x0 and x1, that are not marked; each found one goes to `found`
  const runs = (y, z, x0, x1, found) => {
    const r = y + ny * z, row = nx * r;
    for (let x = Math.max(x0, first[r] + 1), end = Math.min(x1, last[r] - 1); x <= end; x++) {
      if (data[row + x] || outside[row + x]) continue;
      // the whole run, also where it goes past x0 or x1
      let b = x, e = x;
      while (!data[row + b - 1]) b--;
      while (!data[row + e + 1]) e++;
      found(row, r, b, e);
      x = e;
    }
  };
  // the seeds: every middle run on a side of the box, or next to a voxel outside
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const border = y === 0 || z === 0 || y === ny - 1 || z === nz - 1;
    runs(y, z, 0, nx - 1, (row, r, x0, x1) => {
      let free = border;
      for (let x = x0; x <= x1 && !free; x++)
        free = out(row - nx, r - 1, x) || out(row + nx, r + 1, x) || out(row - sxy, r - ny, x) || out(row + sxy, r + ny, x);
      if (free) mark(row, x0, x1);
    });
  }
  // then the middle runs next to the ones found
  const near = (row, r, x0, x1) => mark(row, x0, x1);
  while (top) {
    const x1 = stack[--top], at = stack[--top], r = at / nx | 0, x0 = at - r * nx, y = r % ny, z = (r - y) / ny;
    if (y > 0) runs(y - 1, z, x0, x1, near);
    if (y < ny - 1) runs(y + 1, z, x0, x1, near);
    if (z > 0) runs(y, z - 1, x0, x1, near);
    if (z < nz - 1) runs(y, z + 1, x0, x1, near);
  }
  // the middle runs not found take the colour of the solid voxel before them
  for (let r = 0; r < ny * nz; r++) {
    const row = nx * r;
    for (let x = first[r] + 1; x < last[r]; x++) if (!data[row + x] && !outside[row + x]) data[row + x] = data[row + x - 1];
  }
}

// ------------------------------------------------------------------ mesh
// the visible faces of a volume, merged (greedy meshing) -> { position, normal, color (with `colors`: the colour of
// each corner), index } or null. only: the faces of the voxels of this colour only (the others still hide
// the faces next to them)
export function meshArrays(volume, { colors: withColor = false, only = -1 } = {}) {
  const { size, min, n, data, normals } = volume;
  // the faces merge where both the colour and the surface normal (if any) are the same
  const keyOf = (k) => (normals ? data[k] * 65536 + normals[k] : data[k]);
  const { first, counts, faces, cells } = (volume.faces ??= facesOf(volume));
  // at most one rectangle a face: the arrays are made that big, then cut
  let most = 0;
  for (let i = 0; i < cells.length; i++) if (only < 0 || data[cells[i]] === only + 1) most++;
  if (!most) return null;
  const positions = new Float32Array(most * 12), nrms = new Float32Array(most * 12), colors = withColor ? new Uint32Array(most * 4) : null;
  const indices = new Uint32Array(most * 6);
  let quads = 0;
  const decoded = [0, 0, 0], p = [0, 0, 0];
  const corner = (d, u, v, plane, a, b, q) => {
    p[d] = plane; p[u] = a; p[v] = b;
    positions[q] = (p[0] + min[0]) * size; positions[q + 1] = (p[1] + min[1]) * size; positions[q + 2] = (p[2] + min[2]) * size;
  };
  // the masks of the slices, one per axis, kept for the other colours (each slice leaves its mask empty)
  volume.masks ??= [0, 1, 2].map((d) => new Float64Array(n[(d + 1) % 3] * n[(d + 2) % 3]));
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3, du = n[u], mask = volume.masks[d];
    for (const sign of [1, -1]) {
      const s = d * 2 + (sign < 0 ? 1 : 0), axis = [0, 0, 0];
      axis[d] = sign;
      for (let slice = 0; slice < n[d]; slice++) {
        const lo = counts[first[s] + slice], hi = counts[first[s] + slice + 1];
        if (lo === hi) continue;
        for (let i = lo; i < hi; i++) if (only < 0 || data[cells[i]] === only + 1) mask[faces[i]] = keyOf(cells[i]);
        const plane = slice + (sign > 0 ? 1 : 0);
        for (let i = lo; i < hi; i++) {
          const at = faces[i], c = mask[at];
          if (!c) continue;
          const a = at % du, b = (at - a) / du;
          let w = 1;
          while (a + w < du && mask[at + w] === c) w++;
          let h = 1;
          grow: while (b + h < n[v]) {
            for (let k = 0; k < w; k++) if (mask[at + k + du * h] !== c) break grow;
            h++;
          }
          for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[at + k + du * hh] = 0;
          const base = quads * 4, q = quads * 12;
          if (sign > 0) { corner(d, u, v, plane, a, b, q); corner(d, u, v, plane, a + w, b, q + 3); corner(d, u, v, plane, a + w, b + h, q + 6); corner(d, u, v, plane, a, b + h, q + 9); } else { corner(d, u, v, plane, a, b, q); corner(d, u, v, plane, a, b + h, q + 3); corner(d, u, v, plane, a + w, b + h, q + 6); corner(d, u, v, plane, a + w, b, q + 9); }
          const normal = normals ? decodeNormal(c % 65536, decoded) : axis;
          const color = (normals ? Math.floor(c / 65536) : c) - 1;
          for (let k = 0; k < 4; k++) {
            nrms[q + k * 3] = normal[0]; nrms[q + k * 3 + 1] = normal[1]; nrms[q + k * 3 + 2] = normal[2];
            if (withColor) colors[base + k] = color;
          }
          indices.set([base, base + 1, base + 2, base, base + 2, base + 3], quads * 6);
          quads++;
        }
      }
    }
  }
  const n4 = quads * 4;
  return { position: positions.slice(0, quads * 12), normal: nrms.slice(0, quads * 12), color: withColor ? colors.slice(0, n4) : null,
    index: n4 > 65535 ? indices.slice(0, quads * 6) : Uint16Array.from(indices.subarray(0, quads * 6)) };
}

// the visible faces of a volume (between a voxel and an empty one), of all colours, found in one pass over it and
// sorted by side (d, sign), slice, then place a + du * b in the slice: so the merging (meshArrays) visits only them, in
// the order a full scan of each slice would (b then a), and makes the same rectangles. Made once for all the colours.
// 6 sides: d * 2 + (sign < 0); counts[first[side] + slice] is where the faces of that slice start in faces (their
// place in the slice) and cells (their voxel)
function facesOf({ n, data, first: from = null, last: to = null }) {
  const [nx, ny, nz] = n, sxy = nx * ny;
  // a volume not from voxelize: its rows from end to end
  if (!from) { from = new Int32Array(ny * nz); to = new Int32Array(ny * nz).fill(nx - 1); }
  const first = [0, 0, 0, 0, 0, 0, 0];
  for (let s = 0; s < 6; s++) first[s + 1] = first[s] + n[s >> 1];
  const counts = new Int32Array(first[6] + 1);
  const pass = (put) => {
    for (let z = 0, r = 0; z < nz; z++) for (let y = 0; y < ny; y++, r++) for (let x = from[r], k = nx * r + x; x <= to[r]; x++, k++) {
      if (!data[k]) continue;
      if (x === nx - 1 || !data[k + 1]) put(0, x, y, z, k);
      if (x === 0 || !data[k - 1]) put(1, x, y, z, k);
      if (y === ny - 1 || !data[k + nx]) put(2, y, z, x, k);
      if (y === 0 || !data[k - nx]) put(3, y, z, x, k);
      if (z === nz - 1 || !data[k + sxy]) put(4, z, x, y, k);
      if (z === 0 || !data[k - sxy]) put(5, z, x, y, k);
    }
  };
  pass((s, slice) => { counts[first[s] + slice + 1]++; });
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const faces = new Int32Array(counts[counts.length - 1]), cells = new Int32Array(faces.length), fill = counts.slice();
  pass((s, slice, a, b, k) => {
    const at = fill[first[s] + slice]++;
    faces[at] = a + n[((s >> 1) + 1) % 3] * b;
    cells[at] = k;
  });
  // the faces of y (d = 1) came a before b: sorted by their place
  for (let slice = 0; slice < ny; slice++) for (const s of [2, 3]) {
    const lo = counts[first[s] + slice], hi = counts[first[s] + slice + 1];
    if (hi - lo < 2) continue;
    const order = Array.from({ length: hi - lo }, (_, i) => lo + i).sort((i, j) => faces[i] - faces[j]);
    const f = order.map((i) => faces[i]), c = order.map((i) => cells[i]);
    faces.set(f, lo); cells.set(c, lo);
  }
  return { first, counts, faces, cells };
}
