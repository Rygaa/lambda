// The game modes (server/games.py keeps the round of the room; documentation/worlds.md "Game modes").
// Near a person with "modes" (Chichi, npcs.json), E opens the Game modes window (Game.menu, systems/npcs.js): the modes,
// a Start button (only the owner of the room: the server says so), and a button for her talk (systems/quests.js).
// Start: the server picks the players of the room (any of its worlds) and one monster, and sends the round to every
// page of the room. A page in the round goes to the world of the mode (portals.js goTo): it keeps where it was and its
// player (BACK, in the session) and goes back there after the round, as it was.
// Day Night, in its world (recipe "game", worlds/night-forest.json; the world is dark: recipe "night"):
//   the monster starts at "monster", the players at "players" (their spot of the round). The monster has a sword
//   (SWORD) and hits players (F or a click): each blow takes a third of their HP ('pvp', to that player). It sees a
//   small circle around itself, and a dot at the side of the screen for each flashlight that is on out of sight;
//   a player cannot attack: F turns its flashlight on and off (a lamp in front of it, which every page shows), and it
//   holds E HOLD seconds near a crate ("checks") to check it. Dead, it lies there and watches until the end;
//   a trap ("traps", a red ring when it works) stops whoever walks on it (the server: TRAP_STUCK s, then it works again);
//   no skills, transformation or potions there (only the keys of PLAY count).
//   The monster burns a tree (B, near it, every BURN_EVERY s): it burns BURN s for every page (a flickering lamp and
//   flames), then it is gone (its entity: its body, what stops a walker, its shadow) until the end of the round. Each
//   player it kills gives it one disguise (R): for DISGUISE s it wears the outfit of that player, with no sword and no
//   circle of its own; a blow or a burn ends it.
//   The players win when every crate is checked, the monster when every player is dead: the banner says who, and
//   OVER ms later every page goes back.
// A page in the world of a mode with no round for it (the round is over, or it was not in it) goes back.
import { query, getComponent, getResource, readEvents, sendEvent, destroyEntity } from '../ecs/world.js';
import { Player, Peer, Health } from '../components.js';
import { Settings, Time, Net, Gpu, Input, Wardrobe, Quests, Npcs, Game, Tops } from '../resources.js';
import { Swing, Damage } from '../events.js';
import { toServer } from './net.js';
import { goTo, playerData } from './portals.js';
import { groundAt } from '../lib/walk.js';
import { toScreen } from '../lib/screen.js';
import { flames } from './blasts.js';
import * as THREE from 'three';

export const MODES = [{
  id: 'daynight', name: 'Day Night',
  text: 'Night falls on a small forest. One player becomes the monster, with a sword. The others only have a flashlight: '
    + 'they must check the 5 crates before the monster gets them all. Traps stop anyone who walks on them.',
}];
const SWORD = 'item_weaswowooden';   // the weapon of the monster
const HOLD = 3;          // seconds holding E to check a crate
const NEAR = 1.6;        // world units: a crate this close can be checked
const TRAP = 0.6;        // world units: on a trap
const OVER = 6000;       // ms the banner shows before the pages go back
const NO_ROUND = 4000;   // ms after the server said hello: no round for this page, it goes back
const BACK = 'lambda-game-back';
const BURN = 5;          // seconds a tree burns before it is gone
const BURN_EVERY = 10;   // seconds between two trees the monster burns (server/games.py BURN_EVERY)
const BURN_NEAR = 2;     // world units: a tree this close can be burnt
const DISGUISE = 20;     // seconds
const TREE = /^plant\/(?!bush|leafy)/;   // the props that burn: trees, not bushes
const PLAY = new Set(['click', 'f', 'e', 'escape', ' ', 'shift', 'w', 'a', 's', 'd', 'z', 'q', 'c', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const COLORS = { flash: new THREE.Color('#fff2c0'), self: new THREE.Color('#8090ff'), trap: new THREE.Color('#ff3020'),
  crate: new THREE.Color('#50c0ff'), done: new THREE.Color('#50ff70'), fire: new THREE.Color('#ff8a30') };

let ui = null;
const local = { placed: null, hold: null, asked: {}, traps: {}, overAt: 0, gone: false, stuckUntil: 0,
  fires: {}, burnt: new Set(), burnAt: -1e9, dead: new Set(), charges: 0, victim: null, disguise: null, own: null };

export function setupGameSystem(world) {
  const modes = document.createElement('div');
  modes.id = 'modes';
  modes.hidden = true;
  modes.innerHTML = '<header><b>Game modes</b><button data-close>×</button></header>'
    + MODES.map((m) => `<div class="mode"><b>${m.name}</b><p>${m.text}</p><button data-start="${m.id}">Start</button></div>`).join('')
    + '<p class="note"></p><footer><button data-talk></button></footer>';
  const hud = document.createElement('div');
  hud.id = 'game';
  hud.hidden = true;
  const banner = document.createElement('div');
  banner.id = 'game-banner';
  banner.hidden = true;
  const hint = document.createElement('div');
  hint.id = 'game-hint';
  hint.hidden = true;
  const dots = document.createElement('div');
  dots.id = 'game-dots';
  document.body.append(modes, hud, banner, hint, dots);
  ui = { modes, hud, banner, hint, dots, note: modes.querySelector('.note'), open: null };
  modes.querySelector('[data-close]').addEventListener('click', () => close(world));
  modes.querySelector('[data-talk]').addEventListener('click', () => {
    const who = getResource(world, Game).menu;
    close(world);
    getResource(world, Quests).talk = who;
  });
  for (const b of modes.querySelectorAll('[data-start]')) b.addEventListener('click', () => start(world, b.dataset.start));
  if (getResource(world, Settings).land.game) document.body.classList.add('in-game');
}

// where this page goes back after the round: { world, char, data } (kept when it left), else the "back" of the recipe
export function backFrom(world) {
  try {
    const kept = JSON.parse(sessionStorage.getItem(BACK));
    if (kept?.world) return kept;
  } catch { /* none */ }
  const rec = getResource(world, Settings).land.game, human = query(world, [Player])[0];
  return { world: rec?.back?.world ?? 'beach', char: rec?.back?.char ?? null, data: human === undefined ? null : playerData(world, human) };
}

// before the player and the skills: the messages, the window, and the round in the world of the mode
export function gameSystem(world) {
  const g = getResource(world, Game), settings = getResource(world, Settings), input = getResource(world, Input);
  for (const msg of g.inbox.splice(0)) {
    if (msg.t === 'g-error') ui.note.textContent = msg.text;
    else if (msg.t === 'game') round(world, msg);
    else if (msg.t === 'pvp') hit(world, msg);
  }
  if (g.menu && ui.open !== g.menu) open(world);
  if (ui.open && input.pressed.some(({ key }) => key === 'Escape')) close(world);
  const rec = settings.land.game;
  if (!rec) return;
  // only the keys of the game (no skills, transformation or potions)
  const raw = input.pressed.map(({ key }) => key.toLowerCase());
  input.pressed = input.pressed.filter(({ key }) => PLAY.has(key.toLowerCase()));
  play(world, g, rec, raw);
}

// after the player and the fights: the blows of the monster on the players
export function gameHitSystem(world) {
  const g = getResource(world, Game), r = g.round, net = getResource(world, Net);
  if (!getResource(world, Settings).land.game || r?.phase !== 'play' || r.monster !== g.who) return;
  if (readEvents(world, Swing).length && local.disguise) undisguise(world);
  for (const { x, z, rot, range, arc } of readEvents(world, Swing)) {
    for (const e of query(world, [Peer])) {
      const p = getComponent(world, e, Peer);
      if (p.dead || !p.goal) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - rot), Math.cos(Math.atan2(dx, dz) - rot)));
      if (d > range + 0.3 || (d > 0.3 && off > (arc * Math.PI) / 360)) continue;
      net.outbox.push({ t: 'pvp', to: p.id });
    }
  }
}

// ------------------------------------------------------------------ the window
function open(world) {
  const g = getResource(world, Game), net = getResource(world, Net), who = g.menu;
  ui.open = who;
  ui.modes.querySelector('[data-talk]').textContent = `Talk to ${getResource(world, Npcs).people[who].name}`;
  const online = net.role === 'host' || net.role === 'guest';
  for (const b of ui.modes.querySelectorAll('[data-start]')) b.disabled = !g.owner || !net.id;
  ui.note.textContent = !net.id ? 'No server: a game needs the other players of the room.'
    : !g.owner ? 'Only the owner of the room can start a game.' : online ? '' : 'You are alone here: the other players of the room come too.';
  ui.modes.hidden = false;
}

function close(world) {
  ui.modes.hidden = true;
  ui.open = null;
  getResource(world, Game).menu = false;
}

function start(world, mode) {
  ui.note.textContent = 'Starting...';
  toServer(getResource(world, Net), { t: 'g-start', mode });
}

// ------------------------------------------------------------------ the round
// a round from the server: a page in it goes to the world of the mode
function round(world, r) {
  const g = getResource(world, Game), settings = getResource(world, Settings), now = getResource(world, Time).now;
  g.round = r;
  const mine = r.players.find((p) => p.who === g.who);
  // the traps: when each one holds and works again, in the clock of this page
  local.traps = Object.fromEntries(Object.entries(r.traps).map(([i, t]) => [i, { who: t.who, until: now + t.stuck * 1000, ready: now + t.ready * 1000 }]));
  for (const [i, t] of Object.entries(r.traps)) {
    // this page walked on it, and the server says it holds this player
    if (t.who === g.who && t.stuck > 0 && local.asked[i] && now - local.asked[i] < 3000) { local.stuckUntil = now + t.stuck * 1000; delete local.asked[i]; }
  }
  // the trees that burn: each burns until BURN s after it caught fire (one that burnt before this page came: gone now)
  for (const [i, since] of Object.entries(r.burns ?? {})) {
    if (!local.fires[i] && !local.burnt.has(+i)) local.fires[i] = { until: now + Math.max(0, BURN - since) * 1000 };
  }
  // the monster: each player it killed since it came gives it a disguise, in the outfit of that player
  for (const q of r.players) {
    if (!q.dead || local.dead.has(q.who)) continue;
    local.dead.add(q.who);
    if (r.monster !== g.who || local.placed !== r.id || q.who === g.who) continue;
    const e = query(world, [Peer]).find((pe) => getComponent(world, pe, Peer).who === q.who), peer = e === undefined ? null : getComponent(world, e, Peer);
    if (!peer?.outfit) continue;
    local.charges++;
    local.victim = { name: q.name, outfit: { ...peer.outfit } };
  }
  if (!mine) return;
  if (r.phase === 'play' && settings.worldName !== r.world && !local.gone) {
    const human = query(world, [Player])[0];
    if (human === undefined) return;
    local.gone = true;
    close(world);
    const p = getComponent(world, human, Player), data = playerData(world, human);
    try { sessionStorage.setItem(BACK, JSON.stringify({ world: settings.worldName, char: [p.x, p.z], data, round: r.id })); } catch { /* none */ }
    goTo(r.world, null, data);
  }
  if (r.phase === 'over' && settings.land.game && !local.overAt) local.overAt = now;
}

// a blow of the monster on this player: a third of its HP; dead, it lies there until the end
function hit(world, msg) {
  const g = getResource(world, Game), r = g.round, net = getResource(world, Net);
  const from = net.peers.has(msg.from) ? getComponent(world, net.peers.get(msg.from), Peer) : null;
  const human = query(world, [Player, Health])[0];
  if (r?.phase !== 'play' || !from || from.who !== r.monster || g.who === r.monster || human === undefined) return;
  const p = getComponent(world, human, Player), h = getComponent(world, human, Health);
  if (p.dead > 0) return;
  const amount = Math.ceil(h.max / 3);
  h.hp = Math.max(0, h.hp - amount);
  sendEvent(world, Damage, { x: p.x, y: (p.y ?? 0) + 1.1, z: p.z, amount, human: true });
  if (h.hp > 0) { p.hurt = 0.4; return; }
  p.dead = Infinity;
  g.light = false;
  toServer(net, { t: 'g-dead' });
}

// each frame in the world of the mode
function play(world, g, rec, raw) {
  const r = g.round, now = getResource(world, Time).now, net = getResource(world, Net);
  const mine = r?.players.find((p) => p.who === g.who);
  const over = r?.phase === 'over' && local.overAt;
  if (over) {
    ui.banner.textContent = r.winner === 'players' ? 'The players win!' : 'The monster wins!';
    ui.banner.hidden = false;
    if (now - local.overAt > OVER) goBack(world);
  } else if ((!r || r.phase !== 'play' || !mine) && g.welcomed && now - g.welcomed > NO_ROUND) {
    goBack(world);
    return;
  }
  const human = query(world, [Player, Health])[0];
  const gpu = getResource(world, Gpu);
  gpu.moving = [];
  if (!mine || human === undefined) return;
  const p = getComponent(world, human, Player), h = getComponent(world, human, Health);
  if (!p.group) return;
  const monster = r.monster === g.who, alive = p.dead <= 0;
  // first frame of the round here: its start, full HP, the sword or the flashlight
  if (local.placed !== r.id) {
    local.placed = r.id;
    const [x, z] = monster ? rec.monster : rec.players[mine.spot % rec.players.length];
    Object.assign(p, { x, z, y: null });
    h.hp = h.max;
    if (mine.dead) p.dead = Infinity;
    const w = getResource(world, Wardrobe);
    if (w.outfit.weapon !== (monster ? SWORD : null)) { w.outfit.weapon = monster ? SWORD : null; w.dirty = true; }
    local.own = { ...w.outfit };
    g.noAttack = !monster;
    g.light = false;
  }
  g.stuck = Math.max(0, (local.stuckUntil - now) / 1000);
  const input = getResource(world, Input), settings = getResource(world, Settings), tops = getResource(world, Tops);
  if (!monster && alive && !over && input.pressed.some(({ key }) => key.toLowerCase() === 'f')) g.light = !g.light;
  if (!alive) g.light = false;

  // the lamps: the flashlights, the circle of the monster, the traps that work, the crates
  const ground = (x, z) => groundAt(settings.land.terrain, tops, x, z) + 0.4;
  const lamp = (x, z, r, color, k, y = ground(x, z)) => gpu.moving.push({ x, y, z, r, color, k, flicker: false, ph: 0 });
  const flash = (x, z, rot, y) => lamp(x + Math.sin(rot) * 1.6, z + Math.cos(rot) * 1.6, 3.4, COLORS.flash, 0.35, y + 0.4);
  if (g.light) flash(p.x, p.z, p.rot, p.y ?? 0);
  const lights = [];
  for (const e of query(world, [Peer])) {
    const q = getComponent(world, e, Peer);
    if (q.light && !q.dead && q.goal) { flash(q.x, q.z, q.rot, q.y); lights.push(q); }
  }
  if (monster && !local.disguise) lamp(p.x, p.z, 2.4, COLORS.self, 0.6);
  // the trees that burn: a flickering lamp and flames, then the tree is gone
  for (const [i, fire] of Object.entries(local.fires)) {
    const tree = settings.land.props[i];
    if (!tree) { delete local.fires[i]; continue; }
    if (now < fire.until) {
      const y = groundAt(settings.land.terrain, tops, tree.x, tree.z);
      gpu.moving.push({ x: tree.x, y: y + 1.2, z: tree.z, r: 3.6, color: COLORS.fire, k: 0.8, flicker: true, ph: +i });
      flames(world, tree.x, y, tree.z, 0.7, 2.6, 8);
      continue;
    }
    delete local.fires[i];
    local.burnt.add(+i);
    if (tree.entity !== undefined) destroyEntity(world, tree.entity);
    gpu.shadowsDirty = true;
  }
  const ready = (i) => !local.traps[i] || local.traps[i].ready <= now;
  rec.traps.forEach(([x, z], i) => { if (ready(i)) lamp(x, z, 1.1, COLORS.trap, 0.9); });
  rec.checks.forEach(([x, z], i) => lamp(x, z, 1.3, r.checked.includes(i) ? COLORS.done : COLORS.crate, 0.5));

  // the monster: B burns the tree next to it, R puts on a disguise; a disguise ends after DISGUISE s
  let near = -1;
  const burnLeft = Math.max(0, BURN_EVERY - (now - local.burnAt) / 1000);
  if (monster && alive && !over) {
    let best = BURN_NEAR;
    settings.land.props.forEach((t, i) => {
      if (!TREE.test(t.name) || local.burnt.has(i) || local.fires[i]) return;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < best) { best = d; near = i; }
    });
    if (raw.includes('b') && near >= 0 && !burnLeft) {
      toServer(net, { t: 'g-burn', i: near });
      local.burnAt = now;
      if (local.disguise) undisguise(world);
    }
    if (raw.includes('r') && local.charges > 0 && !local.disguise) {
      local.charges--;
      local.disguise = { name: local.victim.name, until: now + DISGUISE * 1000 };
      wear(world, local.victim.outfit);
    }
  }
  if (local.disguise && (now > local.disguise.until || !alive || over)) undisguise(world);

  // a trap under this player (once: the server answers who it holds)
  if (alive && !over) {
    rec.traps.forEach(([x, z], i) => {
      if (!ready(i) || Math.hypot(p.x - x, p.z - z) > TRAP || now - (local.asked[i] ?? -1e9) < 2000) return;
      local.asked[i] = now;
      toServer(net, { t: 'g-trap', i });
    });
  }

  // a crate near this player: hold E to check it
  let hint = '';
  if (!monster && alive && !over) {
    const i = rec.checks.findIndex(([x, z], j) => !r.checked.includes(j) && Math.hypot(p.x - x, p.z - z) < NEAR);
    // held since (ms, the clock of the page: the same at any frame rate); let go or away: again from 0
    const held = i >= 0 && input.keys.has('e');
    if (!held) local.hold = null;
    else if (local.hold?.i !== i) local.hold = { i, since: now };
    const t = local.hold ? (now - local.hold.since) / 1000 : 0;
    if (local.hold && t >= HOLD) { toServer(net, { t: 'g-check', i }); local.hold = null; }
    if (i >= 0) hint = local.hold ? `Checking the crate... ${Math.min(100, Math.round((100 * t) / HOLD))}%` : 'Hold E to check the crate';
  }
  if (monster && near >= 0 && !burnLeft) hint = 'Press B to burn the tree';
  if (g.stuck > 0) hint = `Caught in a trap! ${Math.ceil(g.stuck)}`;
  else if (!alive && !over) hint = 'You are dead. Watch the end of the round.';
  if (ui.hint.textContent !== hint) ui.hint.textContent = hint;
  ui.hint.hidden = !hint;

  // the text at the top: who you are, the crates, the players alive
  const left = r.players.filter((q) => q.who !== r.monster && !q.dead).length, all = r.players.length - 1;
  const skills = !monster ? '' : local.disguise ? `<span>Disguised as ${local.disguise.name}: ${Math.ceil((local.disguise.until - now) / 1000)} s</span>`
    : `<span>B burn a tree: ${burnLeft ? Math.ceil(burnLeft) + ' s' : 'ready'} · R disguise: ${local.charges}</span>`;
  const text = `<b>Day Night</b><span>${monster ? 'You are the MONSTER: find them all' : 'You are a player: F flashlight, E check'}</span>${skills}`
    + `<span>Crates ${r.checked.length} / ${r.checks} · Players alive ${left} / ${all}</span>`;
  if (ui.hud.innerHTML !== text) ui.hud.innerHTML = text;
  ui.hud.hidden = false;

  // the monster: a dot at the side of the screen for each flashlight on out of sight
  const dots = [];
  if (monster) {
    const canvas = settings.canvas, W = canvas.clientWidth, H = canvas.clientHeight, M = 14;
    for (const q of lights) {
      const at = toScreen(world, q.x, q.y + 0.8, q.z);
      if (!at || (at[0] > 0 && at[0] < W && at[1] > 0 && at[1] < H)) continue;
      dots.push([Math.min(W - M, Math.max(M, at[0])), Math.min(H - M, Math.max(M, at[1]))]);
    }
  }
  while (ui.dots.children.length < dots.length) ui.dots.append(document.createElement('i'));
  [...ui.dots.children].forEach((el, i) => {
    el.hidden = i >= dots.length;
    if (dots[i]) el.style.transform = `translate(${dots[i][0]}px, ${dots[i][1]}px)`;
  });
}

// the monster takes its own outfit back (with its sword)
function undisguise(world) {
  local.disguise = null;
  if (local.own) wear(world, local.own);
}

// the human wears `outfit` (the same Wardrobe object: every slot it does not name is empty)
function wear(world, outfit) {
  const w = getResource(world, Wardrobe);
  for (const k of Object.keys(w.outfit)) w.outfit[k] = null;
  Object.assign(w.outfit, outfit);
  w.dirty = true;
}

// back where this page was before the round, as it was
function goBack(world) {
  if (local.gone) return;
  local.gone = true;
  const back = backFrom(world);
  try { sessionStorage.removeItem(BACK); } catch { /* none */ }
  goTo(back.world, back.char, back.data);
}
