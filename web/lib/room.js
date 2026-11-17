// The room of the game page (web/serve.py, the home page web/home.html): the game opens a room, ?room=<code>, chosen
// on the home page. The room keeps the player of each account (systems/room.js writes it): its world, where it stands,
// its stats, HP, MP, skills, bag, outfit and quests. Opened again later, the page puts it back there.
// Not logged in, or no such room: the page goes to the home page (which logs in, then comes back).

// the home page (web/home.html, at the root of the site: ../ from web/)
export const HOME = new URL('../', location.href).pathname;

// the room of ?room: { id, title, owner, name, player } (player null the first time), or null with no ?room.
// Not logged in: to the home page, which logs in and comes back; no such room: to the home page.
export async function openRoom(params) {
  const id = params.get('room');
  if (!id) return null;
  const res = await fetch(`../rooms/${encodeURIComponent(id)}`).catch(() => null);
  if (res?.ok) return { id, ...(await res.json()) };
  location.replace(res?.status === 401 ? `${HOME}?room=${encodeURIComponent(id)}` : HOME);
  return new Promise(() => {});   // the page goes away
}

const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null), () => null);

// { name (null: not logged in), admin } of this browser (web/serve.py)
export const accountInfo = () => getJson('../account').then((a) => ({ name: a?.name ?? null, admin: !!a?.admin }));

// the link of a room for a friend: the home page with ?room (it logs in, then opens the room)
export function roomLink(id) {
  return `${location.origin}${HOME}?room=${id}`;
}
