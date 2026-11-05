// Draws the map seen from above, 4 pixels per meter: node dist/map-preview.js <out.png> [seed]
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigFromDisk } from "../src/server/assets.ts";
import { GameMap, ROW_DIRT, ROW_SAND, ROW_WATER } from "../src/shared/worldgen.ts";
import { encodePng } from "./png.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await loadConfigFromDisk(root);
const seed = Number(process.argv[3] ?? config.terrain.seed);
const t0 = Date.now();
const map = new GameMap(seed, config);
console.log(`map ${map.size} m, seed ${seed}, made in ${Date.now() - t0} ms: ${map.rocks.length} rocks, ${map.stones.length} stones`);
for (const b of map.buildings) console.log(b.id, b.x.toFixed(1), b.z.toFixed(1), JSON.stringify(b.footprint));
const n = map.n;
const rgb = new Uint8Array(n * n * 3);
for (let k = 0; k < n * n; k++) {
  const ci = k % n, cj = Math.floor(k / n);
  const x = -map.half + (ci + 0.5) * map.cell, z = -map.half + (cj + 0.5) * map.cell;
  const row = map.rows[k];
  let c = row === ROW_WATER ? [58, 140, 200] : row === ROW_SAND ? [226, 200, 160] : row === ROW_DIRT ? [168, 134, 106] : [134, 192, 88];
  const h = map.heightAt(x, z);
  if (h > 0.05) { const s = Math.min(1, h / config.terrain.mountains.height); c = h > config.terrain.mountains.snowAbove ? [244, 246, 248] : [160 - 40 * s, 145 - 40 * s, 130 - 40 * s]; }
  if (map.blocked[k] && row !== ROW_WATER && h <= 0.35) c = [70, 60, 60];
  rgb.set(c, k * 3);
}
const mark = (x: number, z: number, c: number[]) => { const ci = Math.floor((x + map.half) / map.cell), cj = Math.floor((z + map.half) / map.cell); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const k = (cj + dy) * n + ci + dx; if (k >= 0 && k < n * n) rgb.set(c, k * 3); } };
mark(map.spawn.x, map.spawn.z, [255, 255, 255]);
// each building: its footprint in its own color, with a black frame
const COLORS: Record<string, number[]> = { "chichi-house": [230, 60, 50], "buu-house": [250, 200, 40], "capsule-ship": [60, 90, 230], "raditz-pod": [200, 40, 200] };
for (const b of map.buildings) {
  const f = b.footprint, c = COLORS[b.id] ?? [255, 255, 255];
  for (let z = f.minZ - 1.5; z <= f.maxZ + 1.5; z += map.cell) for (let x = f.minX - 1.5; x <= f.maxX + 1.5; x += map.cell) {
    const ci = Math.floor((x + map.half) / map.cell), cj = Math.floor((z + map.half) / map.cell);
    const inside = x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ;
    rgb.set(inside ? c : [20, 20, 20], (cj * n + ci) * 3);
  }
}
// SCALE=2: each cell drawn 2 x 2
const k = Number(process.env.SCALE ?? 1);
const big = new Uint8Array(n * k * n * k * 3);
for (let y = 0; y < n * k; y++) for (let x = 0; x < n * k; x++) big.set(rgb.subarray(((Math.floor(y / k)) * n + Math.floor(x / k)) * 3, ((Math.floor(y / k)) * n + Math.floor(x / k)) * 3 + 3), (y * n * k + x) * 3);
writeFileSync(process.argv[2] ?? "map.png", encodePng(n * k, n * k, big));
