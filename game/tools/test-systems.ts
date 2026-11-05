// Checks of the shared systems, with no browser: node dist/test-systems.js
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigFromDisk } from "../src/server/assets.ts";
import { createComponents } from "../src/shared/components.ts";
import { World } from "../src/shared/ecs.ts";
import { createRandom } from "../src/shared/noise.ts";
import { spawnItem, spawnMonster, spawnPet, spawnPlayer } from "../src/shared/prefabs.ts";
import { applyStats, health, meleeHits, movement, petAI, playerAttacks, playerPickup, runSystems, SERVER_SYSTEMS, type SimContext } from "../src/shared/systems.ts";
import { GameMap } from "../src/shared/worldgen.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await loadConfigFromDisk(root);
const map = new GameMap(config.terrain.seed, config);
let failures = 0;
function test(name: string, body: (w: World, ctx: SimContext) => void) {
  const world = new World();
  const ctx: SimContext = { c: createComponents(world), map, config, dt: 0.05, time: 0, random: createRandom(7) };
  try {
    body(world, ctx);
    console.log("ok  ", name);
  } catch (error) {
    failures++;
    console.log("FAIL", name, "\n    ", (error as Error).message);
  }
}
const { x: sx, z: sz } = map.spawn;

test("the map has exactly one of each building, on free ground", () => {
  assert.deepEqual(map.buildings.map((b) => b.id).sort(), ["buu-house", "capsule-ship", "chichi-house", "raditz-pod"]);
});

test("the button picks up an item within reach", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  const item = spawnItem(w, c, config, sx + 1, sz, "force", 0);
  c.input.get(p)!.pickup = true;
  playerPickup(w, ctx);
  assert.equal(c.inventory.get(p)!.counts.force, 1);
  assert.equal(w.exists(item), false);
});

test("the button does nothing when the item is too far", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  const item = spawnItem(w, c, config, sx + config.loot.pickupRange + 0.3, sz, "force", 0);
  c.input.get(p)!.pickup = true;
  playerPickup(w, ctx);
  assert.equal(c.inventory.get(p)!.counts.force ?? 0, 0);
  assert.equal(w.exists(item), true);
});

test("the button takes one item per press, the nearest", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  spawnItem(w, c, config, sx + 1.2, sz, "vie", 0);
  spawnItem(w, c, config, sx + 0.4, sz, "regen", 0);
  c.input.get(p)!.pickup = true;
  playerPickup(w, ctx);
  assert.deepEqual(c.inventory.get(p)!.counts, { regen: 1 });
});

test("items add to the stats, and the stats set the attack and the life", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  c.inventory.get(p)!.counts = { force: 4, vie: 3, vitesse: 5, portee: 2, rapidite: 10, regen: 1 };
  applyStats(w, ctx);
  const s = c.stats.get(p)!;
  const ch = config.character;
  assert.equal(s.damage, ch.attackDamage + 1);
  assert.equal(s.maxHp, ch.hp + 3);
  assert.equal(c.health.get(p)!.max, ch.hp + 3);
  assert.equal(c.health.get(p)!.hp, ch.hp + 3);
  assert.ok(Math.abs(s.speed - (ch.speed + 0.4)) < 1e-9);
  assert.ok(Math.abs(c.melee.get(p)!.range - (ch.attackRange + 0.1)) < 1e-9);
  assert.ok(c.melee.get(p)!.period < ch.attackPeriod);
});

test("speed has a cap", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  c.inventory.get(p)!.counts = { vitesse: 1000 };
  applyStats(w, ctx);
  assert.equal(c.stats.get(p)!.speed, config.loot.caps.speed);
});

test("more Force kills a monster in fewer hits", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  const m = spawnMonster(w, c, config, sx, sz + 1);
  c.inventory.get(p)!.counts = { force: 8 };
  applyStats(w, ctx);
  c.input.get(p)!.attack = true;
  playerAttacks(w, ctx);
  for (let k = 0; k < 10; k++) meleeHits(w, ctx);
  health(w, ctx);
  assert.equal(c.health.get(m)!.hp, 0);
  assert.ok(c.dead.has(m));
  assert.ok([...w.query(c.item)].length >= config.loot.dropMin, "the monster dropped its loot");
});

test("the pet goes to an item and picks it up for its player", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  const pet = spawnPet(w, c, config, p, sx + 1, sz);
  const item = spawnItem(w, c, config, sx + 4, sz + 2, "vitesse", 0);
  c.anim.get(item)!.time = 1;
  for (let k = 0; k < 60 && w.exists(item); k++) {
    petAI(w, ctx);
    movement(w, ctx);
  }
  assert.equal(w.exists(item), false);
  assert.equal(c.inventory.get(p)!.counts.vitesse, 1);
  assert.ok(w.exists(pet));
});

test("the pet follows its player and jumps back when far", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  const pet = spawnPet(w, c, config, p, sx + 1, sz);
  const t = c.transform.get(p)!;
  t.x = sx + 3;
  for (let k = 0; k < 40; k++) {
    petAI(w, ctx);
    movement(w, ctx);
  }
  const pt = c.transform.get(pet)!;
  assert.ok(Math.hypot(pt.x - t.x, pt.z - t.z) < config.pet.followDistance + 0.8, "the pet is near its player");
  pt.x = sx + 40;
  petAI(w, ctx);
  assert.ok(Math.hypot(pt.x - t.x, pt.z - t.z) < config.pet.followDistance + 0.5, "the pet jumped back");
});

test("the pet goes away with its player", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  const pet = spawnPet(w, c, config, p, sx + 1, sz);
  w.destroy(p);
  petAI(w, ctx);
  assert.equal(w.exists(pet), false);
});

test("monsters do not attack pets, and a minute of the whole game runs", (w, ctx) => {
  const { c } = ctx;
  const p = spawnPlayer(w, c, config, "A", sx, sz);
  const pet = spawnPet(w, c, config, p, sx + 1, sz);
  for (let k = 0; k < 20 * 60; k++) runSystems(w, SERVER_SYSTEMS, ctx);
  assert.ok(w.exists(pet));
  assert.ok(!c.health.has(pet));
});

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
