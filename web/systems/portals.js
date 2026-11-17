// Portals (recipe "portals", gen/recipe.js): a circle on the ground that takes the human to another world. When the
// human walks into it, the page opens the world `to` with the human at `char`: both are kept in the session (GO) and the
// page reloads, so the address does not change (online it holds only the room: lib/address.js). A portal works only once the human has been out of it, so a human who arrives in a portal
// (or starts in it) must step out and back in.
// A player (?player) takes itself along: its stats, HP, MP, skills, bag, outfit and quests are kept in the session
// (sessionStorage CARRY) and main.js puts them back in the next world (carried). The player of a room too (lib/room.js).
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player, Stats, Health, Mana, Skills } from '../components.js';
import { Settings, Inventory, Wardrobe, Quests } from '../resources.js';

export const CARRY = 'lambda-carry';
const GO = 'lambda-go';

const state = { armed: new Set(), gone: false };

export function portalSystem(world) {
  const portals = getResource(world, Settings).land.portals;
  const human = query(world, [Player])[0];
  if (!portals.length || human === undefined || state.gone) return;
  const p = getComponent(world, human, Player);
  if (!p.group || p.dead > 0) return;
  for (const [i, portal] of portals.entries()) {
    const inside = Math.hypot(p.x - portal.x, p.z - portal.z) < portal.r;
    if (!inside) { state.armed.add(i); continue; }
    if (!state.armed.has(i)) continue;
    state.gone = true;
    if (getResource(world, Settings).player || getResource(world, Settings).room) carry(world, human);
    try { sessionStorage.setItem(GO, JSON.stringify({ world: portal.to, char: portal.char ?? null })); } catch (err) { console.error('portal: no session', err); }
    location.reload();
    return;
  }
}

// keeps the player for the next world
function carry(world, human) {
  try { sessionStorage.setItem(CARRY, JSON.stringify(playerData(world, human))); } catch (err) { console.error('portal: the player is not kept', err); }
}

// what a player takes along: to the next world, and in its room (systems/room.js)
export function playerData(world, human) {
  const get = (C) => getComponent(world, human, C);
  return { stats: get(Stats), hp: get(Health).hp, mp: get(Mana).mp, skills: get(Skills).levels,
    bag: getResource(world, Inventory).bag, outfit: getResource(world, Wardrobe).outfit, quests: getResource(world, Quests).state };
}

// the world and the place of the portal that opened this page: { world, char } (once: it is then forgotten), or null
export function goingTo() {
  try {
    const data = JSON.parse(sessionStorage.getItem(GO));
    sessionStorage.removeItem(GO);
    return data?.world ? data : null;
  } catch { return null; }
}

// the player kept by the portal that opened this page (once: it is then forgotten), or null
export function carried() {
  try {
    const data = JSON.parse(sessionStorage.getItem(CARRY));
    sessionStorage.removeItem(CARRY);
    return data;
  } catch { return null; }
}
