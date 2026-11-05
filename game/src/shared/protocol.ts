// Messages between the clients and the server (JSON over a WebSocket at /ws).
import type { AnimState, NetKind } from "./components.ts";

export const TICK_RATE = 20;
// Entities farther than this from a player are not sent to that player (players are always sent).
export const VIEW_RADIUS = 45;

export type ClientMessage =
  | { t: "hello"; name: string }
  // the held move direction, and attack: true once for each press
  | { t: "input"; seq: number; moveX: number; moveZ: number; attack: boolean }
  // tests only: the server accepts it when started with LAMBDA_DEBUG=1
  | { t: "teleport"; x: number; z: number };

export const NET_KINDS: NetKind[] = ["player", "monster", "item"];
export const ANIM_STATES: AnimState[] = ["idle", "walk", "attack", "hit", "dead"];

// One entity: [id, kind, x, z, rot, anim, animTime, hp, maxHp, label (player name or item color)]
export type NetEntity = [number, number, number, number, number, number, number, number, number, string];

export type ServerMessage =
  | { t: "welcome"; id: number; seed: number; tickRate: number }
  // every entity near the player; an entity missing from it is gone (or too far)
  | { t: "snap"; tick: number; time: number; ack: number; ents: NetEntity[] }
  | { t: "full"; reason: string };

export const round2 = (v: number) => Math.round(v * 100) / 100;
