// Accounts and rooms (web/serve.py): a player logs in with a username and a password (a cookie keeps it logged in),
// makes a room and sends its link (?room=<id>) to its friends. The room keeps the player of each account
// (systems/room.js writes it): its world, where it stands, its stats, HP, MP, skills, bag, outfit and quests. Opened
// again later, the page puts it back there.

// the room of ?room (asks to log in first): { id, title, name, player }; the player is null the first time. No ?room,
// or no such room (a message says it): null, the page plays as before
export async function openRoom(params) {
  const id = params.get('room');
  if (!id) return null;
  if (!/^[a-z0-9]{8}$/.test(id)) return noRoom(id);
  let room = await getJson(`../rooms/${id}`);
  if (!room) return noRoom(id);
  if (!room.name) {
    await logIn(`Room ${room.title}`, false);
    room = await getJson(`../rooms/${id}`);
    if (!room?.name) return noRoom(id);
  }
  return { id, title: room.title, name: room.name, player: room.player ?? null };
}

function noRoom(id) {
  const hint = document.getElementById('hint');
  hint.textContent = `no room ${id}: you play alone`;
  hint.style.color = '#ffb4a0';
  return null;
}

const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null), () => null);

// the username of the account this browser is logged in, or null
export const account = () => getJson('../account').then((a) => a?.name ?? null);

export async function logOut() {
  await fetch('../account/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}

// makes a room and opens it (the address keeps ?player and ?look); logs in first
export async function makeRoom() {
  if (!(await account()) && !(await logIn('Log in to make a room', true))) return;
  const values = await ask('New room', [['title', 'Room name']], ['Make', 'Cancel']);
  if (!values) return;
  const res = await fetch('../rooms', { method: 'POST', body: JSON.stringify({ title: values.title }) }).catch(() => null);
  if (!res?.ok) { alert('the room was not made'); return; }
  location.search = '?' + linkParams((await res.json()).id);
}

// the link of a room: ?room, and ?player and ?look of this page
export function roomLink(id) {
  return `${location.origin}${location.pathname}?${linkParams(id)}`;
}
function linkParams(id) {
  const now = new URLSearchParams(location.search), params = new URLSearchParams({ room: id });
  for (const k of ['player', 'look']) if (now.has(k)) params.set(k, now.get(k));
  return params.toString().replace(/=(?=&|$)/g, '');
}

// the login form, until the server says yes: Log in or Create account; resolves to the username, or null when it can
// be cancelled and is
function logIn(title, cancel) {
  return ask(title, [['username', 'Username'], ['password', 'Password', '', 'password']], ['Log in', 'Create account', ...(cancel ? ['Cancel'] : [])],
    async (values, button) => {
      const res = await fetch(button === 'Log in' ? '../account/login' : '../account/new', { method: 'POST', body: JSON.stringify(values) }).catch(() => null);
      const data = await res?.json().catch(() => null);
      return res?.ok ? null : data?.error ?? 'no server';
    }).then((values) => values?.username ?? null);
}

// a small form over the game: fields [[key, label, value, type]], all filled in, and buttons (the first one: Enter;
// 'Cancel' closes it). check(values, button) answers an error text (the form stays) or null. Resolves to the values,
// or null when cancelled
function ask(title, fields, buttons, check = async () => null) {
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.id = 'ask';
    form.innerHTML = `<b></b>${fields.map(() => '<label><span></span><input required maxlength="200"></label>').join('')}<em></em><div></div>`;
    form.querySelector('b').textContent = title;
    const inputs = [...form.querySelectorAll('input')], error = form.querySelector('em');
    for (const [i, [, label, value, type]] of fields.entries()) {
      form.querySelectorAll('label span')[i].textContent = label;
      inputs[i].value = value ?? '';
      if (type) inputs[i].type = type;
    }
    for (const text of buttons) {
      const b = document.createElement('button');
      b.textContent = text;
      b.value = text;
      if (text === 'Cancel') { b.type = 'button'; b.addEventListener('click', () => { form.remove(); resolve(null); }); }
      form.querySelector('div').append(b);
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(fields.map(([key, , , type], i) => [key, type === 'password' ? inputs[i].value : inputs[i].value.trim()]));
      if (Object.values(values).some((v) => !v)) return;
      const button = e.submitter?.value ?? buttons[0];
      for (const b of form.querySelectorAll('button')) b.disabled = true;
      const problem = await check(values, button);
      for (const b of form.querySelectorAll('button')) b.disabled = false;
      if (problem) { error.textContent = problem; return; }
      form.remove();
      resolve(values);
    });
    document.body.append(form);
    (inputs.find((i) => !i.value) ?? inputs[0]).focus();
  });
}
