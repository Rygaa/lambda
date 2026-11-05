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
mark(map.spawn.x, map.spawn.z, [255, 0, 255]);
writeFileSync(process.argv[2] ?? "map.png", encodePng(n, n, rgb));
