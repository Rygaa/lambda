// Every component type. Components are plain data only; the systems hold all the logic.
import { World, type Entity, type Store } from "./ecs.ts";

export type Transform = { x: number; z: number; rot: number };
export type Velocity = { x: number; z: number };
export type Collider = { radius: number };
export type Player = { name: string };
// What the player asks for: a move direction (world x and z, length <= 1) and the attack button.
export type PlayerInput = { moveX: number; moveZ: number; attack: boolean; pickup: boolean; seq: number };
export type Health = { hp: number; max: number; regen: number };
// A melee attack: cooldown until the next one, windup until the hit lands (-1: no attack under way).
export type Melee = { range: number; arc: number; damage: number; period: number; windup: number; cooldown: number; pending: number; targets: "monsters" | "players" };
export type Monster = { kind: string };
export type MonsterAI = { state: "wander" | "chase"; target: Entity; goalX: number; goalZ: number; timer: number; homeX: number; homeZ: number };
export type AnimState = "idle" | "walk" | "attack" | "hit" | "dead";
export type Anim = { state: AnimState; time: number };
// type: an id of loot-cubes.json items
export type Item = { type: string };
// item type id -> how many
export type Inventory = { counts: Record<string, number> };
// what the player can do now: the base of character.json plus what its items add
export type Stats = { damage: number; maxHp: number; regen: number; speed: number; range: number; attackPeriod: number };
export type Pet = { owner: Entity };
// the item the pet goes to pick up (0: none, it follows its player)
export type PetAI = { target: Entity };
export type Lifetime = { remaining: number };
export type Dead = { timer: number };
// The kind of entity the network sends (only these entities go over the network).
export type NetKind = "player" | "monster" | "item" | "pet";
export type Networked = { kind: NetKind };
export type Spawner = { kind: string; count: number; respawn: number; timers: number[] };
// Client only: the last states received from the server, to draw between them.
export type Interpolated = { samples: { t: number; x: number; z: number; rot: number }[] };
// Client only: this entity is my player (its movement is predicted).
export type LocalPlayer = { history: { seq: number; x: number; z: number }[] };

export function createComponents(world: World) {
  return {
    transform: world.store<Transform>("transform"),
    velocity: world.store<Velocity>("velocity"),
    collider: world.store<Collider>("collider"),
    player: world.store<Player>("player"),
    input: world.store<PlayerInput>("input"),
    health: world.store<Health>("health"),
    melee: world.store<Melee>("melee"),
    monster: world.store<Monster>("monster"),
    ai: world.store<MonsterAI>("ai"),
    anim: world.store<Anim>("anim"),
    item: world.store<Item>("item"),
    inventory: world.store<Inventory>("inventory"),
    stats: world.store<Stats>("stats"),
    pet: world.store<Pet>("pet"),
    petAI: world.store<PetAI>("petAI"),
    lifetime: world.store<Lifetime>("lifetime"),
    dead: world.store<Dead>("dead"),
    net: world.store<Networked>("net"),
    spawner: world.store<Spawner>("spawner"),
    interp: world.store<Interpolated>("interp"),
    local: world.store<LocalPlayer>("local"),
  };
}
export type Components = ReturnType<typeof createComponents>;
export type { Entity, Store };
