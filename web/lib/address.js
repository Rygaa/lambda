// The options of the address. Online (not this computer), the address holds only the room (?room=<id>): the world, the
// place, the mode and the look come from the game (the room, the portals, the account), never from the address, so a
// player cannot change them there. On this computer (localhost, the tests) every option works (documentation/worlds.md).
export const online = !['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);

const all = new URLSearchParams(location.search);
export const params = online ? new URLSearchParams(all.has('room') ? { room: all.get('room') } : {}) : all;
// online, the address bar shows only the room too (anything else typed there is taken away)
if (online && params.toString() !== all.toString()) {
  history.replaceState(null, '', location.pathname + (params.has('room') ? '?' + params.toString() : '') + location.hash);
}
