// The components each kind of entity starts with (data only).
import type { Components, Entity } from "./components.ts";
import type { GameConfig } from "./config.ts";
import type { World } from "./ecs.ts";

export function spawnPlayer(world: World, c: Components, config: GameConfig, name: string, x: number, z: number): Entity {
  const ch = config.character;
  const e = world.create();
  c.transform.set(e, { x, z, rot: 0 });
  c.velocity.set(e, { x: 0, z: 0 });
  c.collider.set(e, { radius: ch.radius });
  c.player.set(e, { name });
  c.input.set(e, { moveX: 0, moveZ: 0, attack: false, pickup: false, seq: 0 });
  c.inventory.set(e, { counts: {} });
  c.stats.set(e, { damage: ch.attackDamage, maxHp: ch.hp, regen: ch.regenPerSecond, speed: ch.speed, range: ch.attackRange, attackPeriod: ch.attackPeriod });
  c.health.set(e, { hp: ch.hp, max: ch.hp, regen: ch.regenPerSecond });
  c.melee.set(e, { range: ch.attackRange, arc: ch.attackArc, damage: ch.attackDamage, period: ch.attackPeriod, windup: ch.attackWindup, cooldown: 0, pending: -1, targets: "monsters" });
  c.anim.set(e, { state: "idle", time: 0 });
  c.net.set(e, { kind: "player" });
  return e;
}

export function spawnMonster(world: World, c: Components, config: GameConfig, x: number, z: number): Entity {
  const m = config.monster;
  const e = world.create();
  c.transform.set(e, { x, z, rot: 0 });
  c.velocity.set(e, { x: 0, z: 0 });
  c.collider.set(e, { radius: m.radius });
  c.monster.set(e, { kind: "red-cube" });
  c.ai.set(e, { state: "wander", target: 0, goalX: x, goalZ: z, timer: 0, homeX: x, homeZ: z });
  c.health.set(e, { hp: m.hp, max: m.hp, regen: 0 });
  c.melee.set(e, { range: m.attackRange, arc: 120, damage: m.attackDamage, period: m.attackPeriod, windup: m.attackWindup, cooldown: 0, pending: -1, targets: "players" });
  c.anim.set(e, { state: "idle", time: 0 });
  c.net.set(e, { kind: "monster" });
  return e;
}

export function spawnItem(world: World, c: Components, config: GameConfig, x: number, z: number, type: string, rot: number): Entity {
  const e = world.create();
  c.transform.set(e, { x, z, rot });
  c.item.set(e, { type });
  c.lifetime.set(e, { remaining: config.loot.lifetimeSeconds });
  c.anim.set(e, { state: "idle", time: 0 });
  c.net.set(e, { kind: "item" });
  return e;
}

export function spawnMonsterSpawner(world: World, c: Components, config: GameConfig): Entity {
  const e = world.create();
  // the first monsters come at once (timers at 0), later ones after `respawn` seconds
  c.spawner.set(e, { kind: "red-cube", count: config.monster.count, respawn: config.monster.respawnSeconds, timers: new Array(config.monster.count).fill(0) });
  return e;
}

// The pet cube of a player: it follows it and picks up the items it finds.
export function spawnPet(world: World, c: Components, config: GameConfig, owner: Entity, x: number, z: number): Entity {
  const e = world.create();
  c.transform.set(e, { x, z, rot: 0 });
  c.velocity.set(e, { x: 0, z: 0 });
  c.collider.set(e, { radius: config.pet.radius });
  c.pet.set(e, { owner });
  c.petAI.set(e, { target: 0 });
  c.anim.set(e, { state: "idle", time: 0 });
  c.net.set(e, { kind: "pet" });
  return e;
}
