// All the game logic. The server runs every system, in SERVER_SYSTEMS order. The client runs the same
// steerPlayers + movement systems on its own player to predict its movement (see client/net.ts).
import type { Components, Entity } from "./components.ts";
import type { GameConfig } from "./config.ts";
import type { System, World } from "./ecs.ts";
import type { Random } from "./noise.ts";
import { spawnItem, spawnMonster } from "./prefabs.ts";
import type { GameMap } from "./worldgen.ts";

export type SimContext = {
  c: Components;
  map: GameMap;
  config: GameConfig;
  dt: number;
  time: number;
  random: Random;
};

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const isAlive = (c: Components, e: Entity) => !c.dead.has(e) && (c.health.get(e)?.hp ?? 1) > 0;

// The stats of each player: the base of character.json plus what the items of its inventory add (with caps).
// They set its attack, its life and its speed.
export const applyStats: System<SimContext> = (world, { c, config }) => {
  const ch = config.character;
  const loot = config.loot;
  for (const e of world.query(c.inventory, c.stats)) {
    const bonus = { damage: 0, maxHp: 0, regen: 0, speed: 0, range: 0, attackSpeed: 0 };
    const counts = c.inventory.get(e)!.counts;
    for (const item of loot.items) bonus[item.stat] += (counts[item.id] ?? 0) * item.amount;
    const stats = c.stats.get(e)!;
    stats.damage = ch.attackDamage + bonus.damage;
    stats.maxHp = ch.hp + Math.floor(bonus.maxHp);
    stats.regen = ch.regenPerSecond + bonus.regen;
    stats.speed = Math.min(loot.caps.speed, ch.speed + bonus.speed);
    stats.range = Math.min(loot.caps.range, ch.attackRange + bonus.range);
    stats.attackPeriod = ch.attackPeriod / (1 + Math.min(loot.caps.attackSpeed, bonus.attackSpeed));
    const melee = c.melee.get(e);
    if (melee) {
      melee.damage = stats.damage;
      melee.range = stats.range;
      melee.period = stats.attackPeriod;
      melee.windup = ch.attackWindup * (stats.attackPeriod / ch.attackPeriod);
    }
    const h = c.health.get(e);
    if (h) {
      // more max life: the new points are given at once
      if (stats.maxHp > h.max && !c.dead.has(e)) h.hp += stats.maxHp - h.max;
      h.max = stats.maxHp;
      h.hp = Math.min(h.hp, h.max);
      h.regen = stats.regen;
    }
  }
};

// An item goes into a player's inventory.
export function collectItem(world: World, c: Components, owner: Entity, item: Entity) {
  const inventory = c.inventory.get(owner);
  const type = c.item.get(item)?.type;
  if (!inventory || !type) return;
  inventory.counts[type] = (inventory.counts[type] ?? 0) + 1;
  world.destroy(item);
}

// The "Ramasser" button: the nearest item within reach goes into the inventory.
export const playerPickup: System<SimContext> = (world, { c, config }) => {
  for (const e of world.query(c.input, c.transform, c.inventory)) {
    if (!c.input.get(e)!.pickup || c.dead.has(e)) continue;
    const t = c.transform.get(e)!;
    let best = 0;
    let bestDist = config.loot.pickupRange;
    for (const item of world.query(c.item, c.transform)) {
      const it = c.transform.get(item)!;
      const d = Math.hypot(it.x - t.x, it.z - t.z);
      if (d <= bestDist) {
        bestDist = d;
        best = item;
      }
    }
    if (best) collectItem(world, c, e, best);
  }
};

// The pet cube: it goes to the items it sees and picks them up for its player, and otherwise follows it.
export const petAI: System<SimContext> = (world, { c, config, map }) => {
  const p = config.pet;
  for (const e of world.query(c.pet, c.petAI, c.transform, c.velocity)) {
    const owner = c.pet.get(e)!.owner;
    const ot = c.transform.get(owner);
    if (!ot) {
      world.destroy(e);
      continue;
    }
    const ai = c.petAI.get(e)!;
    const t = c.transform.get(e)!;
    const v = c.velocity.get(e)!;
    // too far from its player (a respawn, a teleport): it jumps back next to it
    if (Math.hypot(ot.x - t.x, ot.z - t.z) > p.teleportDistance) {
      for (let a = 0; a < 8; a++) {
        const x = ot.x + Math.cos((a * Math.PI) / 4) * p.followDistance;
        const z = ot.z + Math.sin((a * Math.PI) / 4) * p.followDistance;
        if (map.isFree(x, z, p.radius)) {
          t.x = x;
          t.z = z;
          break;
        }
      }
      ai.target = 0;
    }
    // its item: still there, and not too far from its player?
    const near = (x: number, z: number) => Math.hypot(x - ot.x, z - ot.z) <= p.maxDistanceFromOwner;
    if (ai.target) {
      const it = c.transform.get(ai.target);
      if (!it || !c.item.has(ai.target) || !near(it.x, it.z)) ai.target = 0;
    }
    if (!ai.target) {
      let bestDist = p.searchRadius;
      for (const item of world.query(c.item, c.transform)) {
        // an item that just fell is left to land first
        if ((c.anim.get(item)?.time ?? 1) < 0.5) continue;
        const it = c.transform.get(item)!;
        const d = Math.hypot(it.x - t.x, it.z - t.z);
        if (d < bestDist && near(it.x, it.z)) {
          bestDist = d;
          ai.target = item;
        }
      }
    }
    let gx: number;
    let gz: number;
    let stop: number;
    if (ai.target) {
      const it = c.transform.get(ai.target)!;
      if (Math.hypot(it.x - t.x, it.z - t.z) <= p.pickupDistance) {
        collectItem(world, c, owner, ai.target);
        ai.target = 0;
        v.x = v.z = 0;
        continue;
      }
      gx = it.x;
      gz = it.z;
      stop = 0;
    } else {
      // a place behind its player
      gx = ot.x - Math.sin(ot.rot) * p.followDistance;
      gz = ot.z - Math.cos(ot.rot) * p.followDistance;
      stop = 0.4;
    }
    const dx = gx - t.x;
    const dz = gz - t.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop || d < 1e-3) {
      v.x = v.z = 0;
      continue;
    }
    // faster when far behind
    const speed = p.speed * (d > 4 ? 1.4 : 1);
    v.x = (dx / d) * speed;
    v.z = (dz / d) * speed;
    t.rot = Math.atan2(dx, dz);
  }
};

// Input -> velocity and facing of the players (slower while an attack is under way).
export const steerPlayers: System<SimContext> = (world, { c, config }) => {
  for (const e of world.query(c.input, c.velocity, c.transform)) {
    const input = c.input.get(e)!;
    const v = c.velocity.get(e)!;
    if (c.dead.has(e)) {
      v.x = v.z = 0;
      continue;
    }
    const len = Math.hypot(input.moveX, input.moveZ);
    const speed = c.stats.get(e)?.speed ?? config.character.speed;
    const k = len > 1e-3 ? (speed / Math.max(1, len)) * ((c.melee.get(e)?.pending ?? -1) >= 0 ? 0.35 : 1) : 0;
    v.x = input.moveX * k;
    v.z = input.moveZ * k;
    if (len > 1e-3) c.transform.get(e)!.rot = Math.atan2(input.moveX, input.moveZ);
  }
};

// The attack button starts an attack when the last one is over.
export const playerAttacks: System<SimContext> = (world, { c }) => {
  for (const e of world.query(c.input, c.melee, c.anim)) {
    const melee = c.melee.get(e)!;
    if (!c.input.get(e)!.attack || melee.cooldown > 0 || c.dead.has(e)) continue;
    melee.cooldown = melee.period;
    melee.pending = melee.windup;
    c.anim.set(e, { state: "attack", time: 0 });
  }
};

// Monsters wander around their home, chase the nearest player they see, and attack when close.
export const monsterAI: System<SimContext> = (world, { c, config, dt, random, map }) => {
  const m = config.monster;
  const players = [...world.query(c.player, c.transform)].filter((p) => isAlive(c, p));
  for (const e of world.query(c.ai, c.transform, c.velocity)) {
    const ai = c.ai.get(e)!;
    const t = c.transform.get(e)!;
    const v = c.velocity.get(e)!;
    if (c.dead.has(e)) {
      v.x = v.z = 0;
      continue;
    }
    const inSafeZone = (x: number, z: number) => Math.hypot(x - map.spawn.x, z - map.spawn.z) < m.safeZoneRadius;
    if (ai.state === "chase") {
      const tt = c.transform.get(ai.target);
      if (!tt || !isAlive(c, ai.target) || Math.hypot(tt.x - t.x, tt.z - t.z) > m.leashRange || inSafeZone(tt.x, tt.z)) {
        ai.state = "wander";
        ai.homeX = t.x;
        ai.homeZ = t.z;
        ai.timer = 0;
      }
    }
    if (ai.state === "wander") {
      let best = 0;
      let bestDist = m.aggroRange;
      for (const p of players) {
        const pt = c.transform.get(p)!;
        const d = Math.hypot(pt.x - t.x, pt.z - t.z);
        if (d < bestDist && !inSafeZone(pt.x, pt.z)) {
          bestDist = d;
          best = p;
        }
      }
      if (best) {
        ai.state = "chase";
        ai.target = best;
      }
    }
    const melee = c.melee.get(e);
    if (ai.state === "chase") {
      const tt = c.transform.get(ai.target)!;
      const dx = tt.x - t.x;
      const dz = tt.z - t.z;
      const d = Math.hypot(dx, dz);
      t.rot = Math.atan2(dx, dz);
      const busy = (melee?.pending ?? -1) >= 0;
      if (d > m.attackRange * 0.8 && !busy) {
        v.x = (dx / d) * m.speed;
        v.z = (dz / d) * m.speed;
      } else {
        v.x = v.z = 0;
        if (melee && melee.cooldown <= 0 && d <= m.attackRange) {
          melee.cooldown = melee.period;
          melee.pending = melee.windup;
          c.anim.set(e, { state: "attack", time: 0 });
        }
      }
      continue;
    }
    // wander: walk to a goal near home, wait, pick another one
    ai.timer -= dt;
    if (inSafeZone(t.x, t.z) && inSafeZone(ai.goalX, ai.goalZ)) {
      const a = Math.atan2(t.z - map.spawn.z, t.x - map.spawn.x);
      ai.homeX = ai.goalX = map.spawn.x + Math.cos(a) * (m.safeZoneRadius + 4);
      ai.homeZ = ai.goalZ = map.spawn.z + Math.sin(a) * (m.safeZoneRadius + 4);
      ai.timer = 4;
    }
    const dx = ai.goalX - t.x;
    const dz = ai.goalZ - t.z;
    const d = Math.hypot(dx, dz);
    if (ai.timer <= 0) {
      const a = random() * Math.PI * 2;
      const r = 2 + random() * 7;
      const gx = ai.homeX + Math.cos(a) * r;
      const gz = ai.homeZ + Math.sin(a) * r;
      if (map.isFree(gx, gz, m.radius) && !inSafeZone(gx, gz)) {
        ai.goalX = gx;
        ai.goalZ = gz;
      }
      ai.timer = 2 + random() * 4;
    }
    if (d > 0.3) {
      v.x = (dx / d) * m.wanderSpeed;
      v.z = (dz / d) * m.wanderSpeed;
      t.rot = Math.atan2(dx, dz);
    } else v.x = v.z = 0;
  }
};

// Moves every entity by its velocity, sliding along what blocks the way.
export const movement: System<SimContext> = (world, { c, map, dt }) => {
  for (const e of world.query(c.transform, c.velocity, c.collider)) {
    moveEntity(c, map, e, dt);
  }
};

export function moveEntity(c: Components, map: GameMap, e: Entity, dt: number) {
  const t = c.transform.get(e)!;
  const v = c.velocity.get(e)!;
  if (v.x === 0 && v.z === 0) return;
  const r = c.collider.get(e)!.radius;
  const nx = t.x + v.x * dt;
  const nz = t.z + v.z * dt;
  if (map.isFree(nx, nz, r)) {
    t.x = nx;
    t.z = nz;
  } else if (map.isFree(nx, t.z, r)) t.x = nx;
  else if (map.isFree(t.x, nz, r)) t.z = nz;
}

// Monsters do not stand inside each other or inside a player.
export const separation: System<SimContext> = (world, { c, map }) => {
  const monsters = [...world.query(c.monster, c.transform, c.collider)];
  const players = [...world.query(c.player, c.transform, c.collider)];
  for (const a of monsters) {
    const ta = c.transform.get(a)!;
    const ra = c.collider.get(a)!.radius;
    for (const b of [...monsters, ...players]) {
      if (a === b) continue;
      const tb = c.transform.get(b)!;
      const dx = ta.x - tb.x;
      const dz = ta.z - tb.z;
      const d = Math.hypot(dx, dz);
      const min = ra + c.collider.get(b)!.radius;
      if (d >= min || d < 1e-4) continue;
      const push = (min - d) * (c.player.has(b) ? 1 : 0.5);
      const nx = ta.x + (dx / d) * push;
      const nz = ta.z + (dz / d) * push;
      if (map.isFree(nx, nz, ra)) {
        ta.x = nx;
        ta.z = nz;
      }
    }
  }
};

// Attacks land at the end of their windup: every living target in range and in front takes the damage.
export const meleeHits: System<SimContext> = (world, { c, dt, map }) => {
  for (const e of world.query(c.melee, c.transform)) {
    const melee = c.melee.get(e)!;
    melee.cooldown = Math.max(0, melee.cooldown - dt);
    if (melee.pending < 0) continue;
    if (c.dead.has(e)) {
      melee.pending = -1;
      continue;
    }
    melee.pending -= dt;
    if (melee.pending >= 0) continue;
    melee.pending = -1;
    const t = c.transform.get(e)!;
    const targets = melee.targets === "monsters" ? c.monster : c.player;
    for (const target of world.query(targets, c.transform, c.health)) {
      if (!isAlive(c, target)) continue;
      const tt = c.transform.get(target)!;
      const dx = tt.x - t.x;
      const dz = tt.z - t.z;
      const d = Math.hypot(dx, dz);
      const reach = melee.range + (c.collider.get(target)?.radius ?? 0);
      if (d > reach) continue;
      if (d > 0.2 && Math.abs(angleDiff(Math.atan2(dx, dz), t.rot)) > ((melee.arc / 2) * Math.PI) / 180) continue;
      c.health.get(target)!.hp -= melee.damage;
      const anim = c.anim.get(target);
      if (anim && anim.state !== "attack") c.anim.set(target, { state: "hit", time: 0 });
      // a monster that is hit turns on its attacker and is pushed back a little
      const ai = c.ai.get(target);
      if (ai) {
        ai.state = "chase";
        ai.target = e;
        if (d > 1e-3) {
          const nx = tt.x + (dx / d) * 0.45;
          const nz = tt.z + (dz / d) * 0.45;
          if (map.isFree(nx, nz, c.collider.get(target)?.radius ?? 0.3)) {
            tt.x = nx;
            tt.z = nz;
          }
        }
      }
    }
  }
};

// Players heal slowly. At 0 hp an entity dies; a monster drops its loot.
export const health: System<SimContext> = (world, { c, config, dt, random }) => {
  for (const e of world.query(c.health)) {
    const h = c.health.get(e)!;
    if (c.dead.has(e)) continue;
    if (h.hp > 0) {
      h.hp = Math.min(h.max, h.hp + h.regen * dt);
      continue;
    }
    h.hp = 0;
    const v = c.velocity.get(e);
    if (v) v.x = v.z = 0;
    c.anim.set(e, { state: "dead", time: 0 });
    if (c.monster.has(e)) {
      c.dead.set(e, { timer: 0.7 });
      const t = c.transform.get(e)!;
      const loot = config.loot;
      const count = loot.dropMin + Math.floor(random() * (loot.dropMax - loot.dropMin + 1));
      for (let k = 0; k < count; k++) {
        const a = random() * Math.PI * 2;
        const r = 0.25 + random() * loot.spread;
        spawnItem(world, c, config, t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, loot.items[Math.floor(random() * loot.items.length)]!.id, random() * Math.PI * 2);
      }
    } else c.dead.set(e, { timer: config.character.respawnSeconds });
  }
};

// After death: a monster goes away (the spawner brings a new one), a player comes back at the spawn.
export const deaths: System<SimContext> = (world, { c, dt, map, random, config }) => {
  for (const e of world.query(c.dead)) {
    const dead = c.dead.get(e)!;
    dead.timer -= dt;
    if (dead.timer > 0) continue;
    if (!c.player.has(e)) {
      world.destroy(e);
      continue;
    }
    c.dead.delete(e);
    const h = c.health.get(e)!;
    h.hp = h.max;
    const t = c.transform.get(e)!;
    const p = playerSpawnPoint(map, random, config.character.radius);
    t.x = p.x;
    t.z = p.z;
    c.anim.set(e, { state: "idle", time: 0 });
  }
};

export function playerSpawnPoint(map: GameMap, random: Random, radius: number) {
  for (let k = 0; k < 50; k++) {
    const x = map.spawn.x + (random() * 2 - 1) * 3;
    const z = map.spawn.z + (random() * 2 - 1) * 3;
    if (map.isFree(x, z, radius)) return { x, z };
  }
  return { ...map.spawn };
}

// Loot disappears after a while, so the ground does not fill up.
export const lifetimes: System<SimContext> = (world, { c, dt }) => {
  for (const e of world.query(c.lifetime)) {
    const l = c.lifetime.get(e)!;
    l.remaining -= dt;
    if (l.remaining <= 0) world.destroy(e);
  }
};

// Keeps the number of monsters: a dead one comes back after a delay, far from the players.
export const spawners: System<SimContext> = (world, { c, dt, map, random, config }) => {
  for (const e of world.query(c.spawner)) {
    const s = c.spawner.get(e)!;
    let alive = 0;
    for (const m of world.query(c.monster)) if (c.monster.get(m)!.kind === s.kind) alive++;
    while (alive + s.timers.length < s.count) s.timers.push(s.respawn);
    s.timers = s.timers.map((t) => t - dt);
    const players = [...world.query(c.player, c.transform)].map((p) => c.transform.get(p)!);
    const far = (x: number, z: number) =>
      players.every((p) => Math.hypot(p.x - x, p.z - z) > config.monster.minSpawnDistanceFromPlayers) &&
      Math.hypot(x - map.spawn.x, z - map.spawn.z) > 12;
    while (s.timers.length && s.timers[0]! <= 0) {
      s.timers.shift();
      const p = map.randomFreePoint(random, config.monster.radius, far);
      spawnMonster(world, c, config, p.x, p.z);
    }
  }
};

// Animation state: attack and hit play once, then idle or walk from the velocity.
export const animations: System<SimContext> = (world, { c, dt }) => {
  for (const e of world.query(c.anim)) {
    const anim = c.anim.get(e)!;
    anim.time += dt;
    if (anim.state === "dead") continue;
    const melee = c.melee.get(e);
    const busy = (anim.state === "attack" && anim.time < (melee?.period ?? 0.6)) || (anim.state === "hit" && anim.time < 0.35);
    if (busy) continue;
    const v = c.velocity.get(e);
    const next = v && Math.hypot(v.x, v.z) > 0.1 ? "walk" : "idle";
    if (anim.state !== next) c.anim.set(e, { state: next, time: 0 });
  }
};

export const SERVER_SYSTEMS: System<SimContext>[] = [
  spawners,
  applyStats,
  steerPlayers,
  playerAttacks,
  playerPickup,
  monsterAI,
  petAI,
  meleeHits,
  movement,
  separation,
  health,
  deaths,
  lifetimes,
  animations,
];

export function runSystems<C extends SimContext>(world: World, systems: System<C>[], context: C) {
  for (const system of systems) system(world, context);
}
