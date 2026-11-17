// The room (lib/room.js, web/serve.py): at the top right, under the network text, a button to make a room (no room
// now) or the name of the room and a button that copies its link; logged in, the username and Log out. In a room, the
// page writes the player of its account (portals.js playerData, with its world and where it stands) every SAVE ms and
// when it closes, so it comes back there.
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player } from '../components.js';
import { Settings, Time } from '../resources.js';
import { playerData } from './portals.js';
import { makeRoom, roomLink, account, logOut } from '../lib/room.js';

const SAVE = 10000;   // ms between two saves

const state = { savedAt: 0 };

export function setupRoomSystem(world) {
  const settings = getResource(world, Settings), room = settings.room;
  if (!/^https?:$/.test(location.protocol)) return;
  const el = document.createElement('div');
  el.id = 'room';
  document.body.append(el);
  const button = document.createElement('button'), out = document.createElement('button');
  out.textContent = 'Log out';
  // the last save first: once logged out, the room no longer takes it
  out.addEventListener('click', async () => { out.blur(); await save(world, false); logOut(); });
  if (!room) {
    button.textContent = 'Create room';
    button.addEventListener('click', () => { button.blur(); makeRoom(); });
    el.append(button);
    account().then((name) => {
      if (!name) return;
      const who = document.createElement('span');
      who.textContent = name;
      el.prepend(who);
      el.append(out);
    });
    return;
  }
  const title = document.createElement('span');
  title.textContent = `room ${room.title} · ${room.name}`;
  button.textContent = 'Copy link';
  button.addEventListener('click', async () => {
    button.blur();
    const link = roomLink(room.id);
    try { await navigator.clipboard.writeText(link); button.textContent = 'Copied'; } catch { prompt('The link of the room:', link); }
    setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
  });
  el.append(title, button, out);
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
  const data = { ...playerData(world, human), world: getResource(world, Settings).worldName, x: round(p.x), z: round(p.z) };
  const url = `../rooms/${room.id}`, body = JSON.stringify(data);
  if (closing && navigator.sendBeacon(url, body)) return Promise.resolve();
  return fetch(url, { method: 'POST', body, keepalive: closing }).catch(() => {});
}

const round = (v) => Math.round(v * 100) / 100;
