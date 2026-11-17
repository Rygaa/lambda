// The room (lib/room.js, web/serve.py): at the top right, under the network text, the name of the room, a button that
// copies its link for a friend, and Home (back to the home page, web/home.html). In a room, the page writes the player
// of its account (portals.js playerData, with its world and where it stands) every SAVE ms, when it closes and before
// Home, so it comes back there. In the world of a game mode it saves where the player goes back after the round.
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player } from '../components.js';
import { Settings, Time } from '../resources.js';
import { playerData } from './portals.js';
import { backFrom } from './game.js';
import { roomLink, HOME } from '../lib/room.js';

const SAVE = 10000;   // ms between two saves

const state = { savedAt: 0 };

export function setupRoomSystem(world) {
  const room = getResource(world, Settings).room;
  if (!room || !/^https?:$/.test(location.protocol)) return;
  const el = document.createElement('div');
  el.id = 'room';
  document.body.append(el);
  const title = document.createElement('span'), link = document.createElement('button'), home = document.createElement('button');
  title.textContent = `${room.title} · ${room.name}`;
  link.textContent = 'Copy link';
  link.addEventListener('click', async () => {
    link.blur();
    const url = roomLink(room.id);
    try { await navigator.clipboard.writeText(url); link.textContent = 'Copied'; } catch { prompt('The link of the world:', url); }
    setTimeout(() => { link.textContent = 'Copy link'; }, 1500);
  });
  home.textContent = 'Home';
  // the last save first, then the home page
  home.addEventListener('click', async () => { home.blur(); await save(world, false); location.href = HOME; });
  el.append(title, link, home);
  // when the page closes (or a portal opens the next world): the last save, sent even as the page goes
  addEventListener('pagehide', () => save(world, true));
}

export function roomSystem(world) {
  const now = getResource(world, Time).now;
  if (!getResource(world, Settings).room || now - state.savedAt < SAVE) return;
  state.savedAt = now;
  save(world, false);
}

function save(world, closing) {
  const room = getResource(world, Settings).room, human = query(world, [Player])[0];
  if (!room || human === undefined) return Promise.resolve();
  const p = getComponent(world, human, Player);
  if (!p.group) return Promise.resolve();   // not in the world yet
  // in the world of a game mode (systems/game.js): the player as it was before the round, where it goes back after it
  const back = getResource(world, Settings).land.game ? backFrom(world) : null;
  const data = back ? { ...back.data, world: back.world, x: back.char[0], z: back.char[1] }
    : { ...playerData(world, human), world: getResource(world, Settings).worldName, x: round(p.x), z: round(p.z) };
  const url = `../rooms/${room.id}`, body = JSON.stringify(data);
  if (closing && navigator.sendBeacon(url, body)) return Promise.resolve();
  return fetch(url, { method: 'POST', body, keepalive: closing }).catch(() => {});
}

const round = (v) => Math.round(v * 100) / 100;
