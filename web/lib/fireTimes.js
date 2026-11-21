// When each voxel of an object on fire catches fire, and when each leaf voxel goes (systems/fire.js asks the fire
// worker, lib/fireWorker.js, so the game does not stop when a tree catches fire). Pure: arrays in, arrays out.
//   catching fire: the shortest time from the first voxels (those within `match` cells of `first`), through the 26
//     voxels that touch each: leafStep seconds a cell into leaves, woodStep into wood, `up` times going up, `down` times
//     going down, windWith times with the wind (wx, wz, in the units of the object; windK: how strong, 0..1),
//     windAgainst times against it; never into stone. A bit the fire cannot reach voxel by voxel: by its distance.
//   holders: the shortest way of each leaf voxel to the wood, the stone or the ground, through the 26 voxels that touch
//     it (by a face, an edge or a corner: so the way is about straight, and the leaves go back as a ball, not a diamond). The core
//     (`core` cells around the upright line through the middle of the object, from the top of the wood up to the middle
//     height of the leaves) costs coreCost a step: the leaves go back toward the middle of the tree as a ball that
//     shrinks, and the core goes last, down into the wood. A bit of leaves joined to nothing
//     holds on at its voxel nearest to that line.
//   going: from the leaves farthest from the wood to the nearest; a leaf goes leafMin seconds after it caught fire at
//     the soonest, and after every leaf it holds, the time the leaves take to go back that far (retreat world units a
//     second, a little more or less for each voxel: a ragged edge, like burning paper).
// In:  { n, grid, at, xyz, kind (0 leaf, 1 wood, 2 stone), nx, ny, minY, ax, az (the middle line, in cells), first,
//        match, leafStep, woodStep, up, down, wx, wz, windK, windWith, windAgainst, size, retreat, leafMin, core,
//        coreCost }
// Out: { catchT, goneT (Float64Array; Infinity: never), order (the voxels that burn, by catch time), leafFirst }
const LEAF = 0, STONE = 2;

export function fireTimes(p) {
  const { n, grid, at, xyz, kind, nx, ny, first, match, leafStep, woodStep, size, retreat, leafMin, core, coreCost, ax, az } = p;
  // the 26 cells that touch a cell, how far each is, and what a step to it costs (up, down, with or against the wind)
  const near = [], len = [], cost = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue;
    const l = Math.hypot(dx, dy, dz), up = dy / l, along = (dx * p.wx + dz * p.wz) / l;
    let k = up > 0 ? 1 + (p.up - 1) * up : 1 + (p.down - 1) * -up;
    k *= 1 + p.windK * (along > 0 ? (p.windWith - 1) * along : (1 - p.windAgainst) * along);
    near.push(dx + nx * (dy + ny * dz)); len.push(l); cost.push(l * k);
  }
  const catchT = new Float64Array(n).fill(Infinity), goneT = new Float64Array(n).fill(Infinity);
  // catching fire
  const heap = new Heap();
  const fx = xyz[first * 3], fy = xyz[first * 3 + 1], fz = xyz[first * 3 + 2];
  for (let c = 0; c < n; c++) {
    if (kind[c] === STONE) continue;
    const dx = xyz[c * 3] - fx, dy = xyz[c * 3 + 1] - fy, dz = xyz[c * 3 + 2] - fz;
    if (dx * dx + dy * dy + dz * dz <= match * match) { catchT[c] = 0; heap.push(0, c); }
  }
  while (heap.size) {
    const [tc, c] = heap.pop();
    if (tc > catchT[c]) continue;
    const k = at[c];
    for (let o = 0; o < 26; o++) {
      const d = grid[k + near[o]];
      if (d < 0 || kind[d] === STONE) continue;
      const td = tc + cost[o] * (kind[d] === LEAF ? leafStep : woodStep);
      if (td < catchT[d]) { catchT[d] = td; heap.push(td, d); }
    }
  }
  for (let c = 0; c < n; c++) {
    if (kind[c] === STONE || catchT[c] < Infinity) continue;
    catchT[c] = Math.hypot(xyz[c * 3] - fx, xyz[c * 3 + 1] - fy, xyz[c * 3 + 2] - fz) * leafStep * 1.5;
  }
  // holders
  const floor = Math.max(1, Math.ceil(-p.minY - 0.5)), dist = new Float64Array(n).fill(Infinity), holder = new Int32Array(n).fill(-1);
  // the core: from the top of the wood on the middle line (or the ground) up to the middle height of the leaves
  let woodTop = floor, leafY = 0, leafN = 0;
  for (let c = 0; c < n; c++) {
    const y = xyz[c * 3 + 1];
    if (kind[c] === LEAF) { leafY += y; leafN++; } else if ((xyz[c * 3] - ax) ** 2 + (xyz[c * 3 + 2] - az) ** 2 <= 9) woodTop = Math.max(woodTop, y);
  }
  leafY /= leafN || 1;
  const inCore = (c) => xyz[c * 3 + 1] >= woodTop && xyz[c * 3 + 1] <= leafY && (xyz[c * 3] - ax) ** 2 + (xyz[c * 3 + 2] - az) ** 2 <= core * core;
  const hold = (seeds) => {
    const h = new Heap();
    for (const c of seeds) { dist[c] = 0; h.push(0, c); }
    while (h.size) {
      const [dc, c] = h.pop();
      if (dc > dist[c]) continue;
      const k = at[c];
      for (let o = 0; o < near.length; o++) {
        const d = grid[k + near[o]];
        if (d < 0 || kind[d] !== LEAF) continue;
        const dd = dc + len[o] * (inCore(d) ? coreCost : 1);
        if (dd < dist[d]) { dist[d] = dd; holder[d] = kind[c] === LEAF ? c : -1; h.push(dd, d); }
      }
    }
  };
  const seeds = [];
  for (let c = 0; c < n; c++) if (kind[c] !== LEAF || xyz[c * 3 + 1] <= floor) seeds.push(c);
  hold(seeds);
  for (let c = 0; c < n; c++) {
    if (dist[c] < Infinity) continue;
    const bit = [c], seen = new Set(bit);
    for (let i = 0; i < bit.length; i++) for (const o of near) { const d = grid[at[bit[i]] + o]; if (d >= 0 && dist[d] === Infinity && !seen.has(d)) { seen.add(d); bit.push(d); } }
    let root = c, best = Infinity;
    for (const b of bit) { const r = (xyz[b * 3] - ax) ** 2 + (xyz[b * 3 + 2] - az) ** 2; if (r < best) { best = r; root = b; } }
    hold([root]);
  }
  // going
  const leaves = [];
  for (let c = 0; c < n; c++) if (kind[c] === LEAF) leaves.push(c);
  leaves.sort((a, b) => dist[b] - dist[a]);
  const held = new Float64Array(n).fill(-Infinity);   // the latest time a voxel it holds lets it go
  let leafFirst = Infinity;
  for (const c of leaves) {
    goneT[c] = Math.max(catchT[c] + leafMin, held[c]);
    const hc = holder[c];
    if (hc >= 0) held[hc] = Math.max(held[hc], goneT[c] + (dist[c] - dist[hc]) * size / retreat * (0.4 + 1.2 * Math.random()));
    leafFirst = Math.min(leafFirst, catchT[c]);
  }
  const burns = [];
  for (let c = 0; c < n; c++) if (kind[c] !== STONE) burns.push(c);
  burns.sort((a, b) => catchT[a] - catchT[b]);
  return { catchT, goneT, order: Int32Array.from(burns), leafFirst };
}

// a binary heap of [time, cell], the smallest time first
class Heap {
  constructor() { this.t = []; this.c = []; this.size = 0; }
  push(t, c) {
    let i = this.size++;
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (this.t[q] <= t) break;
      this.t[i] = this.t[q]; this.c[i] = this.c[q]; i = q;
    }
    this.t[i] = t; this.c[i] = c;
  }
  pop() {
    const top = [this.t[0], this.c[0]], t = this.t[--this.size], c = this.c[this.size];
    let i = 0;
    for (;;) {
      let k = 2 * i + 1;
      if (k >= this.size) break;
      if (k + 1 < this.size && this.t[k + 1] < this.t[k]) k++;
      if (this.t[k] >= t) break;
      this.t[i] = this.t[k]; this.c[i] = this.c[k]; i = k;
    }
    this.t[i] = t; this.c[i] = c;
    return top;
  }
}
