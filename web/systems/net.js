// Play together (web/serve.py, a WebSocket at /net): the pages open on the same world (and seed) are together. Each
// page shows the human it plays and the other players (Peer): their body in their outfit (lib/character.js dress, with
// the cubes of the people), where they walk, their clip, their name, level and HP over their head, and their ki
// blasts (systems/blasts.js: they show and dig here, but hit nothing here).
// In a room (?room, lib/room.js), only the pages of that room and world are together, with the name of the room.
// The monsters are shared: the first page of a world is its host. It runs the monsters (systems/monsters.js) and sends
// them MONSTERS times a second; the others (guests) show them and send their blows to the host (systems/combat.js
// 'hit'). The host strikes the monster, which gets angry at that player and follows it; when it dies, its experience
// and its potions go to the player who killed it ('kill'). When the host goes, the page that came next is the host:
// it runs the monsters it was showing, from where they are.
// No server (or ?solo): the page plays alone, as before. A page alone sends a 'ping' every PING ms, so a tunnel
// (Cloudflare closes a connection that sends nothing for about 100 s) keeps it open. When the connection is lost, the
// page plays alone and tries again every RETRY ms; back with others, it drops its monsters and shows the host's. The
// text at the top right says where it is: online (and how many players, host), connecting, or alone.
// Messages (JSON, "to": only to that player, else to all the others of the world; the server adds "from"):
//   state  a player, SEND times a second: x, y, z, rot, state, t, dead, hp, max, level, act (its skill step), and its
//          outfit when it changed or a player came
//   blast  a player fires a ki blast: skill, step, act
//   mon    the host: list [[number, type id, x, z, rot, state, hp, max, mode, home x, home z, spot (1: of the world
//          recipe), target (the number of the player it is angry at)]], later [[type id, x, z, seconds left]]
//   hit    a guest hit a monster: m (its number), amount (null: a miss), stun
//   kill   the host: the monster m died of your blow       blow   the host: the monster m hits you
//   spawn  a guest asks the host for a monster (its admin menu): type, x, z, rot
//   welcome, join, leave: the server (who is here, who comes and goes, who is the host)
//   state also has light (its flashlight is on); pvp: the monster of Day Night hits you (systems/game.js); game,
//   g-error: the server, the round of the room (server/games.py); g-...: to the server (toServer)
import { params } from '../lib/address.js';
import * as THREE from 'three';
import { query, getComponent, getResource, sendEvent, spawn, destroyEntity, added } from '../ecs/world.js';
import { Player, Peer, Monster, Health, Stats, Skills, Blast } from '../components.js';
import { Net, Gpu, Time, Bestiary, Wardrobe, Skillbook, Settings, Game, runsMonsters } from '../resources.js';
import { MonsterBlow } from '../events.js';
import { strike, killed } from './combat.js';
import { dress, unitScale, ONCE } from '../lib/character.js';
import { showFrame, made } from '../lib/bake.js';
import { lookOf } from '../lib/voxels.js';
import { toScreen } from '../lib/screen.js';

const SEND = 1000 / 15;      // ms between two messages of the player
const MONSTERS = 1000 / 10;  // ms between two messages of the monsters (the host)
const WAIT = 3000;           // ms: no answer of the server, the page plays alone
const PING = 20000;          // ms: a page alone says it is still here
const RETRY = 5000;          // ms between two tries to connect again
const FOLLOW = 12;           // how fast a player goes to where its last message says (per second)
const JUMP = 3;              // farther than this, it is put there at once

export function setupNetSystem(world) {
  const net = getResource(world, Net), settings = getResource(world, Settings);
  if (params.has('solo') || !/^https?:$/.test(location.protocol)) return;
  const room = (settings.room ? settings.room.id + '/' : '') + settings.worldName + (params.has('seed') ? '#' + params.get('seed') : '');
  // next to the page (../net), so a server under a path (game.aissabenfodda.ca/game_01/) gets it too
  const path = new URL('../net', location.href).pathname;
  net.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}?room=${encodeURIComponent(room)}`
    + `&name=${encodeURIComponent(settings.room?.name ?? params.get('name') ?? '')}&who=${tabId()}`;
  net.el = document.createElement('div');
  net.el.id = 'net';
  document.body.append(net.el);
  net.role = 'wait';
  connect(net);
}

// the player of this tab for the game modes when it has no account (server/games.py): kept while the tab lives, so it
// is the same player after a reload into another world
function tabId() {
  try {
    let id = sessionStorage.getItem('lambda-who');
    if (!id) sessionStorage.setItem('lambda-who', id = Math.random().toString(36).slice(2, 12));
    return id;
  } catch { return Math.random().toString(36).slice(2, 12); }
}

// a message to the server itself (the game modes: g-...), even when this page is alone in its world
export function toServer(net, msg) {
  if (net.ws?.readyState === WebSocket.OPEN && net.id) net.ws.send(JSON.stringify(msg));
}

// a new connection; until the server says who is here, a page that plays alone goes on alone
function connect(net) {
  let ws;
  try { ws = new WebSocket(net.url); } catch { net.inbox.push({ t: 'closed' }); return; }
  net.ws = ws;
  // the messages of an old connection are not read
  ws.onmessage = (e) => { if (net.ws === ws) net.inbox.push(JSON.parse(e.data)); };
  ws.onclose = () => { if (net.ws === ws) net.inbox.push({ t: 'closed' }); };
  // a server that never says who is here (the answer may wait in the inbox: the game has not run a frame since)
  setTimeout(() => {
    if (net.ws === ws && ws.readyState !== WebSocket.CLOSED && !net.id && !net.inbox.some((m) => m.t === 'welcome')) { ws.close(); net.inbox.push({ t: 'closed' }); }
  }, WAIT);
}

// the messages that came, then the other players on screen; alone, it tries to connect again
export function netSystem(world) {
  const net = getResource(world, Net), now = getResource(world, Time).now;
  for (const msg of net.inbox.splice(0)) receive(world, net, msg);
  if (net.url && !net.ws && now >= net.retryAt) connect(net);
  for (const e of query(world, [Peer])) drawPeer(world, getComponent(world, e, Peer));
  if (net.el) {
    const text = net.role === 'host' || net.role === 'guest' ? `online · ${net.peers.size + 1} player${net.peers.size ? 's' : ''}${net.role === 'host' ? ' · host' : ''}`
      : net.role === 'wait' ? 'connecting' : 'alone · no server';
    if (net.el.textContent !== text) net.el.textContent = text;
  }
}

function receive(world, net, msg) {
  const b = getResource(world, Bestiary), from = msg.from, peer = net.peers.has(from) ? getComponent(world, net.peers.get(from), Peer) : null;
  const monster = (id) => (net.monsters.has(id) && getComponent(world, net.monsters.get(id), Monster) ? net.monsters.get(id) : undefined);
  switch (msg.t) {
    case 'welcome': {
      const was = net.role;
      Object.assign(net, { id: msg.id, name: msg.name, host: msg.host, role: msg.host === msg.id ? 'host' : 'guest', outfitSent: null });
      Object.assign(getResource(world, Game), { who: msg.who, owner: msg.owner, welcomed: getResource(world, Time).now });
      // a guest makes no monster of the world recipe: the host sends them. Back after playing alone, it drops its own
      if (net.role === 'guest') {
        b.requests = [];
        b.later = [];
        if (was !== 'wait') {
          for (const e of query(world, [Monster])) removeMonster(world, net, e, getComponent(world, e, Monster));
          net.monsters.clear(); net.asked.clear(); net.gone.clear();
        }
      }
      for (const { id, name, who } of msg.peers) addPeer(world, net, id, name, who);
      break;
    }
    case 'join': addPeer(world, net, msg.id, msg.name, msg.who); net.outfitSent = null; break;   // it needs the outfit
    // the game modes (systems/game.js): the round of the room, a refused start, a blow of the monster
    case 'game': case 'g-error': case 'pvp': getResource(world, Game).inbox.push(msg); break;
    case 'leave':
      removePeer(world, net, msg.id);
      net.host = msg.host;
      if (msg.host === net.id && net.role === 'guest') promote(world, net, 'host');
      break;
    case 'closed':
      if (net.role === 'solo' && !net.ws) break;
      for (const id of [...net.peers.keys()]) removePeer(world, net, id);
      promote(world, net, 'solo');
      net.ws = null;
      net.id = 0;
      net.retryAt = getResource(world, Time).now + RETRY;
      break;
    case 'state':
      if (!peer) break;
      peer.goal = { x: msg.x, y: msg.y, z: msg.z, rot: msg.rot };
      if (peer.state !== msg.state || Math.abs(peer.t - msg.tt) > 0.25) peer.t = msg.tt;
      Object.assign(peer, { state: msg.state, dead: msg.dead, hp: msg.hp, max: msg.max, level: msg.level, act: msg.act, light: !!msg.light });
      if (msg.outfit) peer.outfit = msg.outfit;
      break;
    case 'blast': {
      const skill = getResource(world, Skillbook).skills.find((s) => s.id === msg.skill), st = skill?.steps[msg.step];
      if (!peer || !st?.blast) break;
      peer.act = msg.act;
      spawn(world, [Blast, { spec: st.blast, rate: st.rate ?? 1, owner: net.peers.get(from), act: msg.act }]);
      break;
    }
    case 'mon': {
      if (net.role !== 'guest') break;
      const seen = new Set();
      for (const [id, typeId, x, z, rot, state, hp, max, mode, hx, hz, spot, target] of msg.list) {
        seen.add(id);
        const sync = { x, z, rot, state, hp, max, mode, target: target === net.id || !target ? null : target }, e = monster(id);
        if (e !== undefined) {
          const m = getComponent(world, e, Monster), health = getComponent(world, e, Health), last = m.sync;
          m.sync = sync;
          // its HP: what the host says, once it changes (a blow of this page took it down already)
          if (!last?.seen || last.hp !== hp) { health.hp = hp; health.max = max; }
          sync.seen = true;
          continue;
        }
        const type = b.types.find((t) => t.id === typeId);
        if (!type || mode === 'dead' || net.gone.has(id) || net.asked.has(id)) continue;
        net.asked.add(id);
        b.requests.push({ type, x, z, rot, net: id, home: [hx, hz], spot: spot ? { type, x: hx, z: hz } : null, sync });
      }
      // a monster the host no longer has (its admin menu removed it) is gone here too; a dead one fades out
      for (const [id, e] of net.monsters) {
        const m = getComponent(world, e, Monster);
        if (!m) { net.monsters.delete(id); continue; }
        if (!seen.has(id) && m.mode !== 'dead') removeMonster(world, net, e, m);
      }
      b.requests = b.requests.filter((r) => !r.net || seen.has(r.net) || (net.asked.delete(r.net), false));
      net.later = msg.later;
      break;
    }
    case 'hit': {
      const e = monster(msg.m);
      if (runsMonsters(net) && e !== undefined && strike(world, e, msg.amount, msg.stun, from)) net.outbox.push({ t: 'kill', to: from, m: msg.m });
      break;
    }
    case 'kill': { const e = monster(msg.m); if (e !== undefined) killed(world, e); break; }
    case 'blow': { const e = monster(msg.m); if (e !== undefined) sendEvent(world, MonsterBlow, { monster: e }); break; }
    case 'spawn': {
      const type = b.types.find((t) => t.id === msg.type);
      if (runsMonsters(net) && type) b.requests.push({ type, x: msg.x, z: msg.z, rot: msg.rot });
      break;
    }
  }
}

// this page runs the monsters now (the host went, or the server): the monsters it shows go on from where they are
function promote(world, net, role) {
  const b = getResource(world, Bestiary), guest = net.role === 'guest';
  net.role = role;
  for (const e of query(world, [Monster])) {
    const m = getComponent(world, e, Monster);
    m.sync = null;
    m.goal = null;
    if (m.target !== null && !net.peers.has(m.target)) m.target = null;
    net.next = Math.max(net.next, m.net + 1);
  }
  for (const r of b.requests) if (r.net) net.next = Math.max(net.next, r.net + 1);
  // the monsters of the world recipe that come back, as the host sent them (a guest only: a host has its own)
  if (guest) b.later = net.later.map(([id, x, z, left]) => b.types.find((t) => t.id === id) && { spot: { type: b.types.find((t) => t.id === id), x, z }, left }).filter(Boolean);
}

function removeMonster(world, net, e, m) {
  const gpu = getResource(world, Gpu);
  gpu.scene.remove(m.group);
  for (const mesh of m.meshes) mesh.material.dispose();
  gpu.shadowsDirty = true;
  net.monsters.delete(m.net);
  destroyEntity(world, e);
}

// ------------------------------------------------------------------ the other players
function addPeer(world, net, id, name, who = '') {
  if (net.peers.has(id)) return;
  const el = document.createElement('div');
  el.className = 'mbar peer';
  el.innerHTML = '<span></span><div class="bar"><i></i></div>';
  document.getElementById('hud').append(el);
  const group = new THREE.Group();
  getResource(world, Gpu).scene.add(group);
  const e = spawn(world, [Peer, { id, name, group, el, who }]);
  net.peers.set(id, e);
  unitScale(world).then(({ k, box }) => {
    const p = getComponent(world, e, Peer);
    if (!p) return;
    group.scale.setScalar(k);
    p.foot = -box.min.y * k;
  });
}

function removePeer(world, net, id) {
  const e = net.peers.get(id), p = e === undefined ? null : getComponent(world, e, Peer);
  net.peers.delete(id);
  if (!p) return;
  getResource(world, Gpu).scene.remove(p.group);
  forget(p.meshes, p.clips);
  p.el.remove();
  getResource(world, Gpu).shadowsDirty = true;
  destroyEntity(world, e);
}

// frees a body: its meshes, and only the frames it has made (lib/bake.js lazyFrames: going over all of them would make
// them all)
const forget = (meshes, clips) => {
  for (const mesh of meshes) mesh.material.dispose();
  for (const frames of Object.values(clips ?? {})) for (const frame of made(frames)) for (const g of frame) g.dispose?.();
};

function drawPeer(world, p) {
  const gpu = getResource(world, Gpu), dt = getResource(world, Time).dt, look = lookOf(world)?.human.key ?? null;
  // its body in its outfit and the look now, made again when one of them changes (it keeps the old one meanwhile)
  const worn = p.outfit && JSON.stringify(p.outfit) + '|' + look;
  if (gpu.fine && worn && worn !== p.worn && !p.busy) {
    p.busy = true;
    p.worn = worn;
    dress(world, { ...p.outfit }, 'human').then((d) => { p.next = d; }, (err) => { console.error(err); p.busy = false; });
  }
  if (p.next) {
    for (const mesh of p.meshes) p.group.remove(mesh);
    forget(p.meshes, p.clips);
    for (const mesh of p.next.meshes) p.group.add(mesh);
    Object.assign(p, { meshes: p.next.meshes, clips: p.next.clips, next: null, busy: false, fps: getResource(world, Wardrobe).config.bakeFps });
    gpu.shadowsDirty = true;
  }
  // it goes to where its last message says
  const g = p.goal;
  if (!g) { p.group.visible = false; p.el.hidden = true; return; }
  const far = Math.hypot(g.x - p.x, g.z - p.z) > JUMP || !p.group.visible, k = far ? 1 : Math.min(1, dt * FOLLOW);
  p.x += (g.x - p.x) * k; p.y += (g.y - p.y) * k; p.z += (g.z - p.z) * k;
  p.rot += Math.atan2(Math.sin(g.rot - p.rot), Math.cos(g.rot - p.rot)) * k;
  p.group.visible = true;
  p.t += dt;
  const frames = p.clips?.[p.state] ?? p.clips?.idle;
  if (frames) {
    const n = Math.floor(p.t * p.fps);
    showFrame(p.meshes, frames[ONCE(p.state) ? Math.min(n, frames.length - 1) : n % frames.length]);
  }
  p.group.position.set(p.x, p.y + p.foot, p.z);
  p.group.rotation.y = p.rot;
  gpu.bodiesDirty = true;
  // its name, level and HP over its head (not at night: it would show where it hides)
  const at = getResource(world, Settings).land.night ? null : toScreen(world, p.x, p.y + 1.35, p.z);
  p.el.hidden = !at;
  if (!at) return;
  p.el.style.transform = `translate(${at[0]}px, ${at[1]}px)`;
  p.el.querySelector('span').textContent = `${p.name} · ${p.level}`;
  p.el.querySelector('i').style.width = `${(100 * p.hp) / Math.max(1, p.max)}%`;
}

// ------------------------------------------------------------------ send
// the player of this page, its new ki blasts, the monsters (the host), and the messages of the other systems
export function netSendSystem(world) {
  const net = getResource(world, Net), now = getResource(world, Time).now;
  if (net.ws?.readyState !== WebSocket.OPEN || net.role === 'wait' || net.role === 'solo') { net.outbox.length = 0; return; }
  // alone: only a ping now and then, so the connection stays open
  if (!net.peers.size) {
    net.outbox.length = 0;
    if (now - net.sentAt >= PING) { net.sentAt = now; net.ws.send('{"t":"ping"}'); }
    return;
  }
  const human = query(world, [Player, Health, Stats, Skills])[0];
  if (human !== undefined) {
    const p = getComponent(world, human, Player), a = getComponent(world, human, Skills).active, act = a ? `${a.skill.id}:${a.step}` : null;
    for (const e of added(world, Blast)) {
      if (getComponent(world, e, Blast).owner === null && a) net.outbox.push({ t: 'blast', skill: a.skill.id, step: a.step, act });
    }
    if (now - net.sentAt >= SEND) {
      net.sentAt = now;
      const h = getComponent(world, human, Health), outfit = getResource(world, Wardrobe).outfit, worn = JSON.stringify(outfit);
      const msg = { t: 'state', x: round(p.x), y: round(p.y ?? 0), z: round(p.z), rot: round(p.rot), state: p.state, tt: round(p.t),
        dead: p.dead > 0, hp: Math.ceil(h.hp), max: h.max, level: getComponent(world, human, Stats).level, act, light: getResource(world, Game).light };
      // the outfit only when it changed, or for a player who came
      if (worn !== net.outfitSent) { msg.outfit = outfit; net.outfitSent = worn; }
      net.outbox.push(msg);
    }
  }
  if (net.role === 'host' && now - net.monstersAt >= MONSTERS) {
    net.monstersAt = now;
    const list = [];
    for (const e of query(world, [Monster, Health])) {
      const m = getComponent(world, e, Monster), h = getComponent(world, e, Health);
      list.push([m.net, m.type.id, round(m.x), round(m.z), round(m.rot), m.state, Math.ceil(h.hp), h.max, m.mode, round(m.home[0]), round(m.home[1]),
        m.spot ? 1 : 0, m.mode === 'angry' ? (m.target ?? net.id) : 0]);
    }
    const later = getResource(world, Bestiary).later.map((l) => [l.spot.type.id, l.spot.x, l.spot.z, round(l.left)]);
    net.outbox.push({ t: 'mon', list, later });
  }
  for (const msg of net.outbox.splice(0)) net.ws.send(JSON.stringify(msg));
}

const round = (v) => Math.round(v * 100) / 100;
