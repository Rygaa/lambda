// The skills of the human (assets/character/player/skills.json, lib/skills.js), like the spells of League of Legends:
// keys 1 to 4 start them, the bar at the bottom shows them, the window of the K key (or its button) opens or raises
// them with skill points (one each level, lib/combat.js gainXp).
//   A skill starts when it is learned, the human holds what it needs (a sword, a shield), it has the MP and its
//   cooldown is over; else a short text says why. While it plays, the human does not walk, jump or attack
//   (systems/player.js): it plays the clip of the step (faster by its rate), rushes during `rush` (behind its target,
//   or `distance` forward, stopped by the first monster on its way; what stops a walker stops it too), and on each of
//   its hits sends a Swing (systems/combat.js).
//   Dash Strike needs a monster under the mouse (lib/screen.js monsterAt), within its range: the human rushes to
//   `behind` past it, turns to it and hits only it. A combo (Triple Slash) has several steps: press the key again
//   during a step or within `window` seconds after it for the next one; its cooldown starts when the combo ends.
//   A skill turns the human to the monster under the mouse, if there is one.
// MP comes back by MP_REGEN a second. The `Level +1` button of the bar gives the experience of the next level, to test.
import * as THREE from 'three';
import { query, getComponent, getResource, sendEvent } from '../ecs/world.js';
import { Player, Skills, Mana, Stats, Monster } from '../components.js';
import { Input, Time, Wardrobe, Skillbook, Inventory, BlockGrid, Tops, Settings, Gpu, Bestiary } from '../resources.js';
import { Swing, Damage } from '../events.js';
import { whyNot, powerOf, holds } from '../lib/skills.js';
import { monsterAt } from '../lib/screen.js';
import { MP_REGEN, gainXp } from '../lib/combat.js';
import { leveled } from './combat.js';
import { free } from '../lib/walk.js';

const RADIUS = 0.2;   // the radius of the human (systems/player.js)
const SAY = 0.6;      // seconds between two texts that say why a skill cannot start

let ui = null;        // the skill bar and the skills window (setupSkillsSystem)

export function setupSkillsSystem(world) {
  const book = getResource(world, Skillbook), potions = getResource(world, Inventory).potions;
  const bar = document.createElement('div');
  bar.id = 'skillbar';
  bar.innerHTML = book.skills.map((s) => `<div class="sk" data-id="${s.id}"><b>${s.key}</b><span>${s.name}</span><small></small><i></i></div>`).join('')
    + Object.entries(potions).map(([id, p]) => `<div class="sk pot ${id}" data-potion="${id}"><b>${p.key}</b><span>${p.name}</span><small></small></div>`).join('')
    + '<button data-open="inventory">Bag (I)</button><button data-open="skills">Skills (K)</button><button data-level>Level +1</button>';
  const win = document.createElement('div');
  win.id = 'skills';
  win.hidden = true;
  win.innerHTML = `<header><b>Vagabond</b><span class="pts"></span><button data-close>×</button></header>`
    + book.skills.map((s) => `<div class="row" data-id="${s.id}"><b>${s.key}</b><div><strong>${s.name}</strong><small>needs a ${s.needs} · ${s.mp} MP · ${s.cooldown} s`
      + `${s.steps.length > 1 ? ` · combo of ${s.steps.length}` : ''}${s.target ? ` · a monster under the mouse, ${s.target.range} m` : ''}</small></div><output></output><button data-learn="${s.id}">+</button></div>`).join('');
  document.body.append(bar, win);
  ui = { bar, win, learn: [], levelUp: 0, said: 0 };
  bar.querySelector('[data-level]').addEventListener('click', (e) => { ui.levelUp++; e.currentTarget.blur(); });
  win.querySelector('[data-close]').addEventListener('click', () => { win.hidden = true; });
  for (const b of win.querySelectorAll('[data-learn]')) b.addEventListener('click', (e) => { ui.learn.push(b.dataset.learn); e.currentTarget.blur(); });
  for (const b of bar.querySelectorAll('[data-open]')) b.addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (b.dataset.open === 'skills') win.hidden = !win.hidden;
    else getResource(world, Inventory).open = !getResource(world, Inventory).open;
  });
}

export function skillSystem(world) {
  const e = query(world, [Player, Skills, Mana, Stats])[0];
  if (e === undefined || !ui) return;
  const input = getResource(world, Input), dt = getResource(world, Time).dt, book = getResource(world, Skillbook);
  const { outfit, slots } = getResource(world, Wardrobe);
  const p = getComponent(world, e, Player), sk = getComponent(world, e, Skills), mana = getComponent(world, e, Mana), s = getComponent(world, e, Stats);
  const pressed = (k) => input.pressed.some(({ key }) => key.toLowerCase() === k);
  const say = (text) => {
    if (performance.now() - ui.said < SAY * 1000) return;
    ui.said = performance.now();
    sendEvent(world, Damage, { x: p.x, y: (p.y ?? 0) + 1.3, z: p.z, text, human: true, kind: 'note' });
  };

  mana.mp = Math.min(mana.max, mana.mp + MP_REGEN * dt);
  for (const id in sk.cooldowns) sk.cooldowns[id] = Math.max(0, sk.cooldowns[id] - dt);
  sk.aim = monsterAt(world, input.mouse);

  // skill points: open a skill or raise it
  for (const id of ui.learn.splice(0)) {
    if (s.skillPoints <= 0 || (sk.levels[id] ?? 0) >= book.maxLevel) continue;
    s.skillPoints--;
    sk.levels[id] = (sk.levels[id] ?? 0) + 1;
  }
  if (pressed('k')) ui.win.hidden = !ui.win.hidden;

  // the test button: the experience missing to the next level
  for (; ui.levelUp > 0; ui.levelUp--) {
    const levels = getResource(world, Bestiary).levels, need = levels.need[s.level - 1];
    if (need === undefined) { say('max level'); continue; }
    gainXp(s, need - s.xp, levels);
    leveled(world, e);
  }

  // a combo waits for its next press; when the time is over, its cooldown starts
  if (sk.combo && !sk.active && (sk.combo.left -= dt) <= 0) { sk.cooldowns[sk.combo.id] = byId(book, sk.combo.id).cooldown; sk.combo = null; }

  if (p.dead > 0) { sk.active = null; sk.combo = null; }
  else for (const skill of book.skills) {
    if (!pressed(skill.key)) continue;
    const a = sk.active;
    if (a) { if (a.skill === skill && a.step + 1 < skill.steps.length) a.queued = true; break; }
    if (p.jump.air || p.jump.crouch) break;
    if (sk.combo?.id === skill.id) { begin(world, p, sk, skill, sk.combo.step, null); sk.combo = null; break; }
    const why = whyNot(skill, sk, outfit, slots, mana.mp);
    if (why) { say(why); break; }
    let target = null;
    if (skill.target) {
      target = sk.aim;
      if (target === null) { say('no target'); break; }
      const m = getComponent(world, target, Monster);
      if (Math.hypot(m.x - p.x, m.z - p.z) > skill.target.range + m.radius) { say('too far'); break; }
    }
    mana.mp -= skill.mp;
    if (skill.steps.length === 1) sk.cooldowns[skill.id] = skill.cooldown;
    begin(world, p, sk, skill, 0, target);
    break;
  }

  if (sk.active) play(world, p, sk, book, dt);
  drawUi(world, sk, mana, s, book, outfit, slots);
}

const byId = (book, id) => book.skills.find((s) => s.id === id);

// a step of a skill starts: the human turns to its target (or the monster under the mouse) and its rush is set
function begin(world, p, sk, skill, step, target) {
  const st = skill.steps[step], clips = p.clips[st.clip];
  const a = { skill, step, clip: st.clip, rate: st.rate ?? 1, t: 0, end: (clips.length - 1) / p.fps, struck: 0, target, queued: false, rush: null };
  const look = target ?? sk.aim;
  if (look !== null) {
    const m = getComponent(world, look, Monster);
    if (m) p.rot = Math.atan2(m.x - p.x, m.z - p.z);
  }
  if (st.rush) {
    let to;
    if (target !== null) {
      const m = getComponent(world, target, Monster), d = Math.hypot(m.x - p.x, m.z - p.z) || 1;
      const past = d + m.radius + skill.target.behind;
      to = [p.x + ((m.x - p.x) / d) * past, p.z + ((m.z - p.z) / d) * past];
    } else to = forward(world, p, st.distance);
    a.rush = { from: [p.x, p.z], to: reach(world, p, to), rot: p.rot };
  }
  sk.active = a;
}

// the end of a rush `distance` forward: it stops in front of the first monster on its way
function forward(world, p, distance) {
  const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
  let d = distance;
  for (const e of query(world, [Monster])) {
    const m = getComponent(world, e, Monster), along = (m.x - p.x) * fx + (m.z - p.z) * fz;
    if (m.mode === 'dead' || along <= 0) continue;
    const side = Math.abs((m.x - p.x) * fz - (m.z - p.z) * fx);
    if (side < m.radius + RADIUS) d = Math.min(d, Math.max(0, along - m.radius - RADIUS - 0.1));
  }
  return [p.x + fx * d, p.z + fz * d];
}

// the farthest point on the way to `to` that the human can reach (what stops a walker stops the rush)
function reach(world, p, to) {
  const grid = getResource(world, BlockGrid), tops = getResource(world, Tops), settings = getResource(world, Settings);
  const terrain = settings.land.terrain, l = settings.walkLimit;
  const n = Math.ceil(Math.hypot(to[0] - p.x, to[1] - p.z) / 0.1);
  let x = p.x, z = p.z;
  for (let i = 1; i <= n; i++) {
    const nx = THREE.MathUtils.clamp(p.x + ((to[0] - p.x) * i) / n, -l, l), nz = THREE.MathUtils.clamp(p.z + ((to[1] - p.z) * i) / n, -l, l);
    if (!free(grid, tops, terrain, x, z, nx, nz, p.y, RADIUS)) break;
    x = nx; z = nz;
  }
  return [x, z];
}

// one frame of the step playing: its time, its rush, its blows; at its end, the next step of a combo
function play(world, p, sk, book, dt) {
  const a = sk.active, st = a.skill.steps[a.step];
  a.t = Math.min(a.end, a.t + dt * a.rate);
  if (a.rush) {
    const [t0, t1] = st.rush, k = THREE.MathUtils.clamp((a.t - t0) / (t1 - t0), 0, 1);
    p.x = a.rush.from[0] + (a.rush.to[0] - a.rush.from[0]) * k;
    p.z = a.rush.from[1] + (a.rush.to[1] - a.rush.from[1]) * k;
    // past its target, it turns back to it
    const m = a.target !== null && k >= 1 ? getComponent(world, a.target, Monster) : null;
    p.rot = m && m.mode !== 'dead' ? Math.atan2(m.x - p.x, m.z - p.z) : a.rush.rot;
    getResource(world, Gpu).bodiesDirty = true;
  }
  const power = powerOf(book, st, sk.levels[a.skill.id] ?? 1);
  while (a.struck < st.hits.length && a.t >= st.hits[a.struck]) {
    a.struck++;
    sendEvent(world, Swing, { x: p.x, z: p.z, rot: p.rot, range: st.range, arc: st.arc ?? 360, power, target: a.target, around: !!st.around, stun: st.stun ?? 0 });
  }
  if (a.t < a.end) return;
  sk.active = null;
  const next = a.step + 1;
  if (next >= a.skill.steps.length) { if (a.skill.steps.length > 1) sk.cooldowns[a.skill.id] = a.skill.cooldown; return; }
  if (a.queued) begin(world, p, sk, a.skill, next, null);
  else sk.combo = { id: a.skill.id, step: next, left: a.skill.window };
}

// the bar: each skill with its level, cooldown and why it cannot start; the potions with their count; the window
function drawUi(world, sk, mana, s, book, outfit, slots) {
  const inv = getResource(world, Inventory);
  for (const el of ui.bar.querySelectorAll('.sk[data-id]')) {
    const skill = byId(book, el.dataset.id), level = sk.levels[skill.id] ?? 0, cd = sk.cooldowns[skill.id] ?? 0;
    const combo = sk.combo?.id === skill.id;
    el.classList.toggle('off', !combo && whyNot({ ...skill, cooldown: 0 }, { ...sk, cooldowns: {} }, outfit, slots, mana.mp) !== null);
    el.classList.toggle('on', sk.active?.skill === skill || combo);
    el.querySelector('small').textContent = !level ? 'locked' : combo ? `combo ${sk.combo.step + 1}/${skill.steps.length}` : !holds(outfit, slots, skill.needs) ? `needs a ${skill.needs}` : `Lv ${level} · ${skill.mp} MP`;
    el.querySelector('i').style.height = `${(100 * cd) / skill.cooldown}%`;
  }
  for (const el of ui.bar.querySelectorAll('.sk[data-potion]')) {
    const count = inv.bag.find((it) => it.potion === el.dataset.potion)?.count ?? 0;
    el.querySelector('small').textContent = `× ${count}`;
    el.classList.toggle('off', !count);
  }
  if (ui.win.hidden) return;
  ui.win.querySelector('.pts').textContent = `${s.skillPoints} skill point${s.skillPoints === 1 ? '' : 's'}`;
  for (const row of ui.win.querySelectorAll('.row')) {
    const level = sk.levels[row.dataset.id] ?? 0;
    row.querySelector('output').textContent = level ? `Lv ${level} / ${book.maxLevel}` : 'not learned';
    row.querySelector('button').disabled = s.skillPoints <= 0 || level >= book.maxLevel;
  }
}
