// The client side of the network, as ECS systems on the client world:
// - applySnapshots: the server state becomes the client entities (same ids as on the server).
// - interpolate: other entities are drawn INTERP_DELAY behind the server, between two received states.
// - predict: my player moves at once with the shared steerPlayers + movement systems, and is pulled back
//   toward the server position when they differ (the server has the authority).
import type { Components, Entity } from "../shared/components.ts";
import type { GameConfig } from "../shared/config.ts";
import type { System, World } from "../shared/ecs.ts";
import { ANIM_STATES, NET_KINDS, type ServerMessage } from "../shared/protocol.ts";
import { movement, steerPlayers, type SimContext } from "../shared/systems.ts";

export const INTERP_DELAY = 0.12;

export type ClientContext = SimContext & {
  localId: Entity;
  inbox: Extract<ServerMessage, { t: "snap" }>[];
  // estimated server time now (seconds), updated from the snapshots
  serverClock: { offset: number; ready: boolean };
  now: number;
  // real seconds since the last frame (ctx.dt is capped at 0.1 s by the renderer, for movement)
  realDt: number;
};

export const applySnapshots: System<ClientContext> = (world, ctx) => {
  const { c, config } = ctx;
  for (const snap of ctx.inbox) {
    const offset = snap.time - ctx.now;
    if (!ctx.serverClock.ready) ctx.serverClock = { offset, ready: true };
    // follow the server clock slowly, jump only when far off
    else ctx.serverClock.offset += Math.abs(offset - ctx.serverClock.offset) > 0.5 ? offset - ctx.serverClock.offset : (offset - ctx.serverClock.offset) * 0.05;
    const seen = new Set<Entity>();
    for (const [id, kindIndex, x, z, rot, animIndex, animTime, hp, max, label] of snap.ents) {
      seen.add(id);
      const kind = NET_KINDS[kindIndex]!;
      if (!world.exists(id)) createMirror(world, c, config, id, kind, x, z, rot, label, id === ctx.localId);
      const state = ANIM_STATES[animIndex]!;
      const anim = c.anim.get(id)!;
      if (anim.state !== state || Math.abs(anim.time - animTime) > 0.4) c.anim.set(id, { state, time: animTime });
      c.health.set(id, { hp, max, regen: 0 });
      if (state === "dead") c.dead.set(id, { timer: 1 });
      else c.dead.delete(id);
      if (kind === "player") c.player.set(id, { name: label });
      const local = c.local.get(id);
      if (local) reconcile(c, id, local, snap.ack, x, z);
      else c.interp.get(id)!.samples.push({ t: snap.time, x, z, rot });
    }
    for (const e of [...world.query(c.net)]) if (!seen.has(e)) world.destroy(e);
  }
  ctx.inbox.length = 0;
};

function createMirror(world: World, c: Components, config: GameConfig, id: Entity, kind: (typeof NET_KINDS)[number], x: number, z: number, rot: number, label: string, isLocal: boolean) {
  world.create(id);
  c.net.set(id, { kind });
  c.transform.set(id, { x, z, rot });
  c.anim.set(id, { state: "idle", time: 0 });
  if (kind === "item") c.item.set(id, { color: label });
  if (kind === "monster") c.monster.set(id, { kind: "red-cube" });
  if (isLocal) {
    c.local.set(id, { history: [] });
    c.velocity.set(id, { x: 0, z: 0 });
    c.collider.set(id, { radius: config.character.radius });
    c.input.set(id, { moveX: 0, moveZ: 0, attack: false, seq: 0 });
  } else c.interp.set(id, { samples: [{ t: -1, x, z, rot }] });
}

// The server says where my player was after my input `ack`. Compare with where I predicted it then.
function reconcile(c: Components, e: Entity, local: { history: { seq: number; x: number; z: number }[] }, ack: number, sx: number, sz: number) {
  const t = c.transform.get(e)!;
  const at = local.history.find((h) => h.seq === ack);
  local.history = local.history.filter((h) => h.seq > ack);
  const ex = sx - (at?.x ?? t.x);
  const ez = sz - (at?.z ?? t.z);
  if (Math.hypot(ex, ez) > 2) {
    // too far (respawn, or a long hiccup): take the server position
    t.x = sx;
    t.z = sz;
    local.history = [];
    return;
  }
  const k = 0.25;
  t.x += ex * k;
  t.z += ez * k;
  for (const h of local.history) {
    h.x += ex * k;
    h.z += ez * k;
  }
}

export const interpolate: System<ClientContext> = (world, ctx) => {
  const { c } = ctx;
  const renderTime = ctx.now + ctx.serverClock.offset - INTERP_DELAY;
  for (const e of world.query(c.interp, c.transform)) {
    const s = c.interp.get(e)!.samples;
    while (s.length > 2 && s[1]!.t <= renderTime) s.shift();
    const t = c.transform.get(e)!;
    const a = s[0]!;
    const b = s[1];
    if (!b || a.t < 0) {
      const last = s[s.length - 1]!;
      t.x = last.x;
      t.z = last.z;
      t.rot = last.rot;
      if (a.t < 0 && b) s.shift();
      continue;
    }
    const k = Math.min(1, Math.max(0, (renderTime - a.t) / (b.t - a.t || 1)));
    t.x = a.x + (b.x - a.x) * k;
    t.z = a.z + (b.z - a.z) * k;
    t.rot = a.rot + Math.atan2(Math.sin(b.rot - a.rot), Math.cos(b.rot - a.rot)) * k;
  }
};

// Animation clocks run on between snapshots.
export const advanceAnims: System<ClientContext> = (world, { c, realDt }) => {
  for (const e of world.query(c.anim)) c.anim.get(e)!.time += realDt;
};

// My player: the shared systems move it at once from my input.
export const predict: System<ClientContext> = (world, ctx) => {
  steerPlayers(world, ctx);
  movement(world, ctx);
};
