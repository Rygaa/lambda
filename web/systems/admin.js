// The admin menu: the button at the top left opens it. Its Look part switches how things are drawn: as they are
// (Normal) or made of cubes (Voxel), with the size of a cube and its light (the Look resource, systems/voxels.js).
// Its sliders change values while the game runs:
// the walk and run speeds and the jump height of the human (the Tuning resource) and the zoom (the Viewport resource).
// Its slots change the clothes and weapons of the human (the Wardrobe resource, systems/outfit.js): a slot opens a grid
// with a picture of each item (lib/preview.js), and a click on a picture puts the item on.
// The Monsters part edits and spawns the monsters, the Human part changes the stats of the human (systems/adminFight.js),
// the Objects part places FlyFF decor objects (systems/adminObjects.js).
// Save writes all these values to saves/admin.json and the monster changes to saves/monsters.json (web/serve.py), which
// the game loads at start (main.js); Default puts back the values of the code (resources.js createTuning,
// character.json outfit), without saving them; it does not touch the monsters or the stats.
// The markup is in index.html (#admin-button, #admin, #picker).
import { getResource, query, getComponent } from '../ecs/world.js';
import { Tuning, Viewport, Wardrobe, Bestiary, Look, createTuning, createLook } from '../resources.js';
import { Stats } from '../components.js';
import { ZOOM_STEP } from './viewport.js';
import { createPreview } from '../lib/preview.js';
import { setupMonstersPart, setupHumanPart } from './adminFight.js';
import { setupObjectsPart } from './adminObjects.js';

let showHuman = () => {};   // shows the values of the Human part again (systems/adminFight.js)
let showObject = () => {};  // shows the chosen object again (its size is known once the human is: systems/adminObjects.js)

// one slider: [id, label, read the value, set the value, min, max, step, how to show the value]
const SLIDERS = [
  ['walk', 'Walk speed', (w) => getResource(w, Tuning).walkSpeed, (w, v) => { getResource(w, Tuning).walkSpeed = v; }, 0.5, 8, 0.1, (v) => v.toFixed(1)],
  ['run', 'Run speed (Shift)', (w) => getResource(w, Tuning).runSpeed, (w, v) => { getResource(w, Tuning).runSpeed = v; }, 1, 16, 0.1, (v) => v.toFixed(1)],
  ['jump', 'Jump height (Space)', (w) => getResource(w, Tuning).jumpHeight, (w, v) => { getResource(w, Tuning).jumpHeight = v; }, 0.2, 4, 0.1, (v) => v.toFixed(1)],
  ['zoom', 'Zoom', (w) => getResource(w, Viewport).zoom, (w, v) => { const vp = getResource(w, Viewport); vp.zoom = v; vp.dirty = true; }, 0, 0, ZOOM_STEP, (v) => v.toFixed(2)],
];

// one slot: [slot, label, its first choice ('': none or the bare body; null: no such choice)]
const SLOTS = [
  ['head', 'Head', null], ['hair', 'Hair', null], ['upper', 'Clothes', 'bare'], ['hand', 'Gloves', 'bare hands'],
  ['foot', 'Shoes', 'bare feet'], ['cap', 'Cap', 'none'], ['cloak', 'Cloak', 'none'], ['mask', 'Mask', 'none'],
  ['weapon', 'Weapon', 'none'], ['shield', 'Shield', 'none'],
];

export function setupAdminSystem(world) {
  const panel = document.getElementById('admin'), refresh = [];   // refresh: show the values again
  document.getElementById('admin-button').addEventListener('click', (e) => { panel.hidden = !panel.hidden; syncZoom(world); e.currentTarget.blur(); });
  refresh.push(setupLookPart(world, panel));
  for (const [id, label, get, set, min, max, step, show] of SLIDERS) {
    const row = document.createElement('label');
    row.innerHTML = `<span>${label}</span><output></output><input type="range" min="${min}" max="${max}" step="${step}">`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.id = 'admin-' + id;
    input.value = get(world);
    out.textContent = show(get(world));
    input.addEventListener('input', () => { set(world, Number(input.value)); out.textContent = show(Number(input.value)); });
    input.addEventListener('change', () => input.blur());   // the arrows go back to the human
    refresh.push(() => { input.value = get(world); out.textContent = show(get(world)); });
    panel.append(row);
  }
  const w = getResource(world, Wardrobe), picker = document.getElementById('picker'), preview = createPreview();
  const title = document.createElement('h3');
  title.textContent = 'Clothes and weapons';
  panel.append(title);
  for (const [slot, label, none] of SLOTS) {
    // the same name twice gets a number
    const seen = new Map(), items = (none === null ? [] : [{ name: none, file: '' }]).concat(w.slots[slot].map(({ name, file }) => {
      seen.set(name, (seen.get(name) ?? 0) + 1);
      return { name: seen.get(name) > 1 ? `${name} ${seen.get(name)}` : name, file };
    }));
    const row = document.createElement('div');
    row.className = 'slot';
    row.innerHTML = `<span>${label}</span><output>${w.slots[slot].length}</output><button></button>`;
    const button = row.querySelector('button');
    button.id = 'admin-' + slot;
    const wearing = () => { button.textContent = items.find((it) => it.file === (w.outfit[slot] ?? ''))?.name ?? w.outfit[slot]; };
    wearing();
    refresh.push(wearing);
    button.addEventListener('click', () => {
      button.blur();
      if (!picker.hidden && picker.dataset.slot === slot) { picker.hidden = true; return; }
      const picture = (file) => preview(`../assets/character/player/parts/${file}.glb`, { onHead: slot === 'cap' || slot === 'mask' });
      openPicker(picker, slot, label, items, picture, () => w.outfit[slot] ?? '', (file) => {
        w.outfit[slot] = file || null;
        w.dirty = true;
        wearing();
      });
    });
    panel.append(row);
  }
  document.getElementById('admin-button').addEventListener('click', () => { if (panel.hidden) picker.hidden = true; });
  setupMonstersPart(world, panel, picker, preview);
  showHuman = setupHumanPart(world, panel);
  showObject = setupObjectsPart(world, panel, picker, preview);

  const bar = document.createElement('div');
  bar.className = 'save';
  bar.innerHTML = `<button id="admin-save">Save</button><button id="admin-default">Default</button><span></span>`;
  const status = bar.querySelector('span');
  bar.querySelector('#admin-save').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    const human = query(world, [Stats])[0];
    const data = { look: { ...getResource(world, Look) }, tuning: { ...getResource(world, Tuning) }, outfit: { ...w.outfit }, zoom: getResource(world, Viewport).zoom,
      ...(human === undefined ? {} : { stats: { ...getComponent(world, human, Stats) } }) };
    const post = (name, body) => fetch(`../saves/${name}.json`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.ok, () => false);
    const ok = await Promise.all([post('admin', data), post('monsters', { changes: getResource(world, Bestiary).changes })]);
    status.textContent = ok.every(Boolean) ? 'saved' : 'not saved (restart web/serve.py)';
  });
  bar.querySelector('#admin-default').addEventListener('click', (e) => {
    e.currentTarget.blur();
    Object.assign(getResource(world, Look), createLook());
    Object.assign(getResource(world, Tuning), createTuning());
    Object.assign(w.outfit, w.config.outfit);
    w.dirty = true;
    const vp = getResource(world, Viewport);
    vp.zoom = 0;
    vp.dirty = true;
    picker.hidden = true;
    refresh.forEach((f) => f());
    syncZoom(world);
    status.textContent = 'default (not saved)';
  });
  panel.append(bar);
}

// the Look part: two buttons (Normal, Voxel), the size of a cube in pixels (from 0.5: smaller ones would not fit in
// memory, the human has 270 frames of cubes), and its light. A new size or light applies
// when the slider is let go. -> a function that shows the values again
function setupLookPart(world, panel) {
  const look = getResource(world, Look), part = document.createElement('div');
  part.className = 'look';
  part.innerHTML = `<h3>Look</h3><div class="switch"><button id="admin-normal">Normal</button><button id="admin-voxel">Voxel</button></div>
    <label><span>Cube size (pixels)</span><output></output><input id="admin-cube" type="range" min="0.5" max="6" step="0.5"></label>
    <label><span>Cube light</span><select id="admin-light"><option value="surface">like the shape</option><option value="cube">each face</option></select></label>`;
  const normal = part.querySelector('#admin-normal'), voxel = part.querySelector('#admin-voxel');
  const size = part.querySelector('#admin-cube'), light = part.querySelector('#admin-light'), out = part.querySelector('output');
  const show = () => {
    normal.classList.toggle('on', !look.voxel);
    voxel.classList.toggle('on', look.voxel);
    size.value = look.px;
    out.textContent = look.px;
    light.value = look.light;
    for (const el of part.querySelectorAll('label')) el.classList.toggle('off', !look.voxel);
  };
  for (const [button, on] of [[normal, false], [voxel, true]]) button.addEventListener('click', () => { button.blur(); look.voxel = on; show(); });
  size.addEventListener('input', () => { out.textContent = size.value; });
  size.addEventListener('change', () => { look.px = Number(size.value); size.blur(); });
  light.addEventListener('change', () => { look.light = light.value; light.blur(); });
  show();
  panel.append(part);
  return show;
}

// a grid of pictures (the items of a slot, the monsters, the monster models): a picture and the name of each item
// ({ name, file }); picture(file) -> Promise of its picture, drawn when it scrolls into view (none for file '');
// current() -> the file chosen now; choose(file) when a picture is clicked
export function openPicker(picker, key, label, items, picture, current, choose) {
  picker.dataset.slot = key;
  picker.hidden = false;
  picker.scrollTop = 0;
  picker.innerHTML = `<header><b>${label}</b><span>${items.length}</span><input type="search" placeholder="search"><button title="close">×</button></header><div class="grid"></div>`;
  picker.querySelector('header button').addEventListener('click', () => { picker.hidden = true; });
  const grid = picker.querySelector('.grid');
  // the search box shows only the items whose name has its text
  picker.querySelector('header input').addEventListener('input', (e) => {
    const text = e.target.value.trim().toLowerCase();
    for (const cell of grid.children) cell.hidden = !!text && !cell.title.toLowerCase().includes(text);
  });
  const seen = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      seen.unobserve(target);
      picture(target.dataset.file).then((url) => { target.querySelector('img').src = url; }, (err) => console.error(err));
    }
  }, { root: picker });
  for (const { name, file } of items) {
    const cell = document.createElement('button');
    cell.className = 'cell' + (file === current() ? ' on' : '');
    cell.dataset.file = file;
    cell.title = name;
    cell.innerHTML = `<img alt=""><span></span>`;
    cell.querySelector('span').textContent = name;
    cell.addEventListener('click', () => {
      grid.querySelector('.on')?.classList.remove('on');
      cell.classList.add('on');
      cell.blur();
      choose(file);
    });
    grid.append(cell);
    if (file) seen.observe(cell);
  }
  grid.querySelector('.on')?.scrollIntoView({ block: 'center' });
}

// the zoom also changes with the wheel, and its range with the window, and the stats of the human while it fights:
// keep them in step
export function adminSystem(world) {
  if (document.getElementById('admin').hidden) return;
  if (document.activeElement !== document.getElementById('admin-zoom')) syncZoom(world);
  showHuman();
  showObject();
}

function syncZoom(world) {
  const input = document.getElementById('admin-zoom');
  const vp = getResource(world, Viewport);
  input.min = vp.zoomMin;
  input.max = vp.zoomMax;
  input.value = vp.zoom;
  input.previousElementSibling.textContent = vp.zoom.toFixed(2);
}
