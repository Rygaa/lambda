// The people who do not fight (recipe "npcs", assets/character/npc/npcs.json, lib/npc.js). Each one stands at its
// place playing its idle clip, its name over its head, and stops walkers. When the human comes near (TALK), it turns
// to the human and its name says "E: talk"; the E key (or a click on its name) opens the talk (systems/quests.js).
// When the look changes, it gets the meshes of the new look once they are made.
import * as THREE from 'three';
import { query, getComponent, getResource, spawn } from '../ecs/world.js';
import { Npc, Player, Blocker } from '../components.js';
import { Settings, Time, Gpu, Tops, Input, Npcs, Quests } from '../resources.js';
import { groundAt } from '../lib/walk.js';
import { showFrame } from '../lib/bake.js';
import { bakeNpc, npcLook, FPS } from '../lib/npc.js';
import { lookOf } from '../lib/voxels.js';
import { toScreen } from '../lib/screen.js';

const TALK = 1.8;      // world units: the human talks to a person this close
const TURN = 6;        // how fast it turns (per second)

export function npcSystem(world) {
  const npcs = getResource(world, Npcs), gpu = getResource(world, Gpu), settings = getResource(world, Settings);
  // the people of the world recipe, once each is baked and drawn (none without the human: its fine pass draws them)
  if (gpu.fine) {
    npcs.waiting ??= [...settings.land.npcs];
    npcs.waiting = npcs.waiting.filter((spot) => {
      const bake = bakeNpc(world, spot.id), drawn = bake.baked && npcLook(world, bake);
      if (drawn) place(world, spot, bake.baked, drawn);
      return !drawn && !bake.error;
    });
  }
  const dt = getResource(world, Time).dt, tops = getResource(world, Tops), input = getResource(world, Input);
  const human = query(world, [Player])[0], p = human === undefined ? null : getComponent(world, human, Player);
  const look = lookOf(world)?.human.key ?? null;
  for (const e of query(world, [Npc])) {
    const n = getComponent(world, e, Npc);
    if (n.look !== look) restyle(world, n);
    n.t += dt;
    const frames = n.clips.idle;
    showFrame(n.meshes, frames[Math.floor(n.t * n.fps) % frames.length]);
    const dist = p ? Math.hypot(p.x - n.x, p.z - n.z) : Infinity;
    n.near = dist < TALK && p.dead <= 0;
    // it turns to the human when it is near, else back to where it faces
    const goal = dist < TALK * 2 ? Math.atan2(p.x - n.x, p.z - n.z) : n.home;
    n.rot += Math.atan2(Math.sin(goal - n.rot), Math.cos(goal - n.rot)) * Math.min(1, TURN * dt);
    const y = groundAt(settings.land.terrain, tops, n.x, n.z);
    n.group.position.set(n.x, y + n.foot, n.z);
    n.group.rotation.y = n.rot;
    gpu.bodiesDirty = true;
    // its name over its head
    const at = toScreen(world, n.x, y + n.height + 0.25, n.z);
    if (at) n.el.style.transform = `translate(${at[0]}px, ${at[1]}px)`;
    n.el.classList.toggle('near', n.near);
    if (n.near && input.pressed.some(({ key }) => key.toLowerCase() === 'e')) getResource(world, Quests).talk = n.id;
  }
}

function place(world, { id, x, z, rot }, baked, drawn) {
  const gpu = getResource(world, Gpu), { box, k } = baked, who = getResource(world, Npcs).people[id];
  const group = new THREE.Group();
  for (const mesh of drawn.meshes) group.add(mesh);
  group.scale.setScalar(k);
  gpu.scene.add(group);
  gpu.shadowsDirty = true;
  const el = document.createElement('div');
  el.className = 'npc';
  el.innerHTML = `<b>${who.name}</b><span>E: talk</span>`;
  el.addEventListener('click', () => { getResource(world, Quests).talk = id; });
  document.getElementById('hud').append(el);
  spawn(world, [Npc, { id, name: who.name, group, meshes: drawn.meshes, clips: drawn.clips, look: drawn.look, fps: FPS,
    foot: -box.min.y * k, height: (box.max.y - box.min.y) * k, x, z, rot, home: rot, el }],
  [Blocker, { x, z, r: 0.3, h: 1.2 }]);
}

function restyle(world, n) {
  const drawn = npcLook(world, bakeNpc(world, n.id));
  if (!drawn) return;
  for (const mesh of n.meshes) { n.group.remove(mesh); mesh.material.dispose(); }
  for (const mesh of drawn.meshes) n.group.add(mesh);
  Object.assign(n, { meshes: drawn.meshes, clips: drawn.clips, look: drawn.look });
  getResource(world, Gpu).shadowsDirty = true;
}
