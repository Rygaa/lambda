// Messages between the clients and the server (JSON over a WebSocket at /ws).
import type { AnimState, NetKind, Stats } from "./components.ts";
import type { RockHole } from "./worldgen.ts";

export const TICK_RATE = 20;
// Entities farther than this from a player are not sent to that player (players are always sent).
export const VIEW_RADIUS = 45;

export type ClientMessage =
  | { t: "hello"; name: string }
  // the held move direction, and attack: true once for each press
  // pickup: true once for each press of the "Ramasser" button (or E)
  | { t: "input"; seq: number; moveX: number; moveZ: number; attack: boolean; pickup: boolean }
  // blow up a rock or stone (its index: see GameMap.propAt)
  | { t: "blast"; rock: number }
  // fire the Kikoha, from where my player stands and the way it faces
  | { t: "kikoha" }
  // tests only: the server accepts it when started with LAMBDA_DEBUG=1
  | { t: "teleport"; x: number; z: number };

// How near the edge of a rock or stone a player must be to blow it up (meters).
export const BLAST_RANGE = 3;

// The Kikoha: how far the beam goes (meters), and the seconds between two shots of one player.
export const KIKOHA_RANGE = 20;
export const KIKOHA_PERIOD = 1;

export const NET_KINDS: NetKind[] = ["player", "monster", "item", "pet"];
export const ANIM_STATES: AnimState[] = ["idle", "walk", "attack", "hit", "dead"];

// One entity: [id, kind, x, z, rot, anim, animTime, hp, maxHp, label (player name, item type, pet: owner id)]
export type NetEntity = [number, number, number, number, number, number, number, number, number, string];

export type ServerMessage =
  // gone: the rocks and stones that were already blown up; holes: the tunnels the Kikoha already cut
  | { t: "welcome"; id: number; seed: number; tickRate: number; gone: number[]; holes: RockHole[] }
  // a rock or stone blew up: every player gets this
  | { t: "blast"; rock: number }
  // a Kikoha was fired: every player gets this. rock: the rock or stone it goes through, or null.
  | { t: "kikoha"; x: number; z: number; dx: number; dz: number; length: number; rock: number | null }
  // every entity near the player; an entity missing from it is gone (or too far)
  | { t: "snap"; tick: number; time: number; ack: number; ents: NetEntity[]; me: MyState | null }
  | { t: "full"; reason: string };

// Only for the player who gets the snapshot: its inventory and its stats.
export type MyState = { inv: Record<string, number>; stats: Stats };

export const round2 = (v: number) => Math.round(v * 100) / 100;
