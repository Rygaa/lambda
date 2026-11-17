// The monsters (lib/monsters.js): first the spawns of the admin menu whose model is baked; then each monster.
//   calm: it stands, sometimes looks around (its wander clip), sometimes walks to a place near its home;
//   angry (hit by the human, systems/combat.js): it follows the human and attacks it (its attack clip, the blow on
//   the hit frame of models.json, then attackDelay seconds before the next one). It gives up, goes home and heals
//   when the human dies or when it is more than LEASH from home;
//   dead: its death clip, then it fades out and is removed.
//   stunned (stun > 0, systems/skills.js Shield Bash): it stands in its hit clip, it does not move or hit.
// A monster of the world recipe (spot) comes back at its place RESPAWN seconds after it is gone.
// When the look changes (the Look resource), each monster gets the meshes and clips of the new look once they are made.
// It walks on the ground like the human (lib/walk.js) and does not jump.
// With other players (systems/net.js), only the host runs the monsters: an angry monster follows the player who hit it
// first (target), here or in another page. A guest makes no monster itself: it shows the ones the host sends (sync),
// walks them to where the host says, and plays their clips; it sends the spawns of its admin menu to the host.
import * as THREE from 'three';
import { query, getComponent, getResource, sendEvent, destroyEntity } from '../ecs/world.js';
import { Monster, Player, Health, Peer } from '../components.js';
import { Settings, Time, Gpu, BlockGrid, Tops, Bestiary, Craters, Net, runsMonsters } from '../resources.js';
import { MonsterBlow } from '../events.js';
import { free, groundAt } from '../lib/walk.js';
import { showFrame } from '../lib/bake.js';
import { bakeModel, spawnMonster, monsterLook } from '../lib/monsters.js';
import { lookOf } from '../lib/voxels.js';

const ROAM = 3;       // a calm walk ends at most this far from home
const LEASH = 14;     // an angry monster this far from home gives up
const CALM = 0.5;     // a calm walk goes this fraction of its walk speed
const CHASE = 1.5;    // it follows the human this much faster than it walks
const REACH = 0.3;    // it attacks when this close to the human (between their circles)
const FADE = 1;       // seconds to fade out after its death clip
const HUMAN = 0.2;    // the radius of the human (systems/player.js RADIUS)
const RESPAWN = 15;   // seconds before a monster of the world recipe comes back

export function monsterSystem(world) {
  const b = getResource(world, Bestiary), time = getResource(world, Time), gpu = getResource(world, Gpu);
  const net = getResource(world, Net), host = runsMonsters(net);
  // the monsters of the world recipe that come back (the host)
  if (host) b.later = b.later.filter((l) => {
    if ((l.left -= time.dt) > 0) return true;
    b.requests.push({ ...l.spot, spot: l.spot });
    return false;
  });
  else b.later = [];
  // a guest makes only the monsters the host sent (net); it sends the spawns of its admin menu to the host
  if (net.role === 'guest') b.requests = b.requests.filter((r) => {
    if (r.net) return true;
    if (!r.spot) net.outbox.push({ t: 'spawn', to: net.host, type: r.type.id, x: r.x, z: r.z, rot: r.rot });
    return false;
  });
  // the spawns waiting for their bake (none without the human: its fine pass draws them; none while the page waits to
  // know who is the host)
  if (gpu.fine && net.role !== 'wait') b.requests = b.requests.filter(({ type, x, z, rot, spot = null, net: id = 0, home = null, sync = null }) => {
    const bake = bakeModel(world, type.model), drawn = bake.baked && monsterLook(world, type, bake.baked);
    if (drawn) {
      const e = spawnMonster(world, type, bake.baked, drawn, x, z, rot), m = getComponent(world, e, Monster);
      m.spot = spot;
      if (home) m.home = home;
      m.sync = sync;
      m.net = id || net.next++;
      net.monsters.set(m.net, e);
      net.asked.delete(m.net);
    }
    return !drawn && !bake.error;
  });
  const look = lookOf(world)?.key ?? null;

  const settings = getResource(world, Settings), grid = getResource(world, BlockGrid), tops = getResource(world, Tops);
  const terrain = settings.land.terrain, dt = time.dt;
  const human = query(world, [Player])[0], p = human === undefined ? null : getComponent(world, human, Player);
  // who an angry monster follows: the human here (null) or another player (its number): { x, z, alive }
  const targetOf = (id) => {
    const q = id === null ? p : net.peers.has(id) ? getComponent(world, net.peers.get(id), Peer) : null;
    return q && { x: q.x, z: q.z, alive: id === null ? q.dead <= 0 : !q.dead };
  };
  for (const e of query(world, [Monster, Health])) {
    const m = getComponent(world, e, Monster), health = getComponent(world, e, Health), type = m.type;
    if (m.look !== look) restyle(world, m);
    const clipTime = (state) => (m.clips[state].length - 1) / m.fps;
    let next = 'idle', goal = null, speed = 0, stopAt = 0.05;
    // a guest: the mode, HP and clip the host sent; it walks to where the host says
    const sync = !host && m.sync;
    if (sync && m.mode !== 'dead') { m.mode = sync.mode; m.target = sync.target; }

    if (m.mode === 'dead') {
      next = 'dead';
      if (m.state === 'dead' && m.t > clipTime('dead')) {
        m.fade = Math.max(0, m.fade - dt / FADE);
        for (const mesh of m.meshes) mesh.material.uniforms.uFade.value = m.fade;
        if (m.fade <= 0) {
          gpu.scene.remove(m.group);
          for (const mesh of m.meshes) mesh.material.dispose();
          gpu.shadowsDirty = true;
          if (m.spot && host) b.later.push({ spot: m.spot, left: RESPAWN });
          net.monsters.delete(m.net);
          net.gone.add(m.net);
          destroyEntity(world, e);
          continue;
        }
      }
    } else if (sync) {
      next = sync.state in m.clips ? sync.state : 'idle';
      m.rot = sync.rot;
      const dx = sync.x - m.x, dz = sync.z - m.z, d = Math.hypot(dx, dz);
      if (d > 3) { m.x = sync.x; m.z = sync.z; }
      else if (d > 0.01) { const k = Math.min(1, dt * 10); m.x += dx * k; m.z += dz * k; }
      if (d > 0.01) gpu.bodiesDirty = true;
      m.shown = Math.max(0, m.shown - dt);
    } else {
      m.cooldown = Math.max(0, m.cooldown - dt);
      m.hurt = Math.max(0, m.hurt - dt);
      m.shown = Math.max(0, m.shown - dt);
      m.stun = Math.max(0, m.stun - dt);
      const foe = m.mode === 'angry' ? targetOf(m.target) : null;
      if (m.mode === 'angry' && (!foe?.alive || Math.hypot(m.x - m.home[0], m.z - m.home[1]) > LEASH)) {
        m.mode = 'calm';
        m.swing = null;
        m.goal = [...m.home];
        health.hp = health.max;
      }
      if (m.stun > 0) {
        m.swing = null;
        next = 'hit';
      } else if (m.mode === 'angry') {
        const dx = foe.x - m.x, dz = foe.z - m.z, d = Math.hypot(dx, dz), reach = m.radius + HUMAN + REACH;
        m.rot = Math.atan2(dx, dz);
        if (m.swing !== null) {
          next = 'attack';
          m.swing += dt;
          // the blow lands if the human is still near
          if (!m.struck && m.swing >= b.models[type.model].hitAt) {
            m.struck = true;
            if (d <= reach + 0.4) sendEvent(world, MonsterBlow, { monster: e });
          }
          if (m.swing >= clipTime('attack')) m.swing = null;
        } else if (d > reach) {
          goal = [foe.x, foe.z]; speed = type.walkSpeed * CHASE; stopAt = reach - 0.1;   // a little inside its reach
        } else if (m.cooldown <= 0) {
          next = 'attack'; m.swing = 0; m.struck = false; m.cooldown = type.attackDelay;
        }
      } else if (m.goal) {
        goal = m.goal; speed = type.walkSpeed * CALM;
      } else if (m.state === 'wander' && m.t < clipTime('wander')) {
        next = 'wander';
      } else if ((m.wait -= dt) <= 0) {
        // the next calm thing: a walk near home, or a look around
        m.wait = 2 + Math.random() * 4;
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * ROAM;
          m.goal = [m.home[0] + Math.cos(a) * r, m.home[1] + Math.sin(a) * r];
        } else next = 'wander';
      }
    }

    // a step towards the goal: the whole step, else only along x, else only along z
    let moved = false;
    if (goal) {
      const dx = goal[0] - m.x, dz = goal[1] - m.z, d = Math.hypot(dx, dz);
      if (d <= stopAt) { if (m.mode === 'calm') m.goal = null; } else {
        m.rot = Math.atan2(dx, dz);
        const step = Math.min(speed * dt, d - stopAt), sx = (dx / d) * step, sz = (dz / d) * step;
        const r = Math.min(m.radius, 0.5), l = settings.walkLimit;
        for (const [ox, oz] of [[sx, sz], [sx, 0], [0, sz]]) {
          const x = THREE.MathUtils.clamp(m.x + ox, -l, l), z = THREE.MathUtils.clamp(m.z + oz, -l, l);
          if ((x === m.x && z === m.z) || !free(grid, tops, terrain, m.x, m.z, x, z, m.y, r)) continue;
          m.x = x; m.z = z; moved = true;
          break;
        }
        if (moved) next = 'walk';
        else if (m.mode === 'calm') m.goal = null;   // something stops it: it stays there
      }
    }
    if (m.hurt > 0 && next === 'idle') next = 'hit';

    if (next !== m.state) { m.state = next; m.t = 0; }
    m.t += dt * (next === 'walk' ? speed / Math.max(0.1, type.walkSpeed) : 1);
    // the frame of its clip: stand and walk loop, the others stop on their last frame
    const frames = m.clips[m.state], k = Math.floor(m.t * m.fps);
    const frame = frames[m.state === 'idle' || m.state === 'walk' ? k % frames.length : Math.min(k, frames.length - 1)];
    showFrame(m.meshes, frame);
    m.y = groundAt(terrain, tops, m.x, m.z, getResource(world, Craters));
    m.group.position.set(m.x, m.y + m.foot, m.z);
    m.group.rotation.y = m.rot;
    if (moved || m.state !== 'idle') gpu.bodiesDirty = true;
  }
}

// the meshes and clips of the look now, once they are made (lib/monsters.js monsterLook)
function restyle(world, m) {
  const drawn = monsterLook(world, m.type, bakeModel(world, m.type.model).baked);
  if (!drawn) return;
  for (const mesh of m.meshes) { m.group.remove(mesh); mesh.material.dispose(); }
  for (const mesh of drawn.meshes) { mesh.material.uniforms.uFade.value = m.fade; m.group.add(mesh); }
  m.meshes = drawn.meshes;
  m.clips = drawn.clips;
  m.look = drawn.look;
  getResource(world, Gpu).shadowsDirty = true;
}
