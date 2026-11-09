// The admin menu: the button at the top left opens it. Its sliders change values while the game runs:
// the walk and run speeds and the jump height of the human (the Tuning resource) and the zoom (the Viewport resource).
// Its slots change the clothes and weapons of the human (the Wardrobe resource, systems/outfit.js): a slot opens a grid
// with a picture of each item (lib/preview.js), and a click on a picture puts the item on.
// Save writes all these values to saves/admin.json (web/serve.py), which the game loads at start (main.js);
// Default puts back the values of the code (resources.js createTuning, character.json outfit), without saving them.
// The markup is in index.html (#admin-button, #admin, #picker).
import { getResource } from '../ecs/world.js';
import { Tuning, Viewport, Wardrobe, createTuning } from '../resources.js';
import { ZOOM_STEP } from './viewport.js';
import { createPreview } from '../lib/preview.js';

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
      openPicker(picker, slot, label, items, preview, () => w.outfit[slot] ?? '', (file) => {
        w.outfit[slot] = file || null;
        w.dirty = true;
        wearing();
      });
    });
    panel.append(row);
  }
  document.getElementById('admin-button').addEventListener('click', () => { if (panel.hidden) picker.hidden = true; });

  const bar = document.createElement('div');
  bar.className = 'save';
  bar.innerHTML = `<button id="admin-save">Save</button><button id="admin-default">Default</button><span></span>`;
  const status = bar.querySelector('span');
  bar.querySelector('#admin-save').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    const data = { tuning: { ...getResource(world, Tuning) }, outfit: { ...w.outfit }, zoom: getResource(world, Viewport).zoom };
    const res = await fetch('../saves/admin.json', { method: 'POST', body: JSON.stringify(data) }).catch(() => null);
    status.textContent = res?.ok ? 'saved' : 'not saved (restart web/serve.py)';
  });
  bar.querySelector('#admin-default').addEventListener('click', (e) => {
    e.currentTarget.blur();
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

// the grid of one slot: a picture and the name of each item; a picture is drawn when it scrolls into view
function openPicker(picker, slot, label, items, preview, current, wear) {
  picker.dataset.slot = slot;
  picker.hidden = false;
  picker.scrollTop = 0;
  picker.innerHTML = `<header><b>${label}</b><span>${items.length}</span><button title="close">×</button></header><div class="grid"></div>`;
  picker.querySelector('header button').addEventListener('click', () => { picker.hidden = true; });
  const grid = picker.querySelector('.grid');
  const seen = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      seen.unobserve(target);
      preview(target.dataset.file, slot === 'cap' || slot === 'mask').then((url) => { target.querySelector('img').src = url; }, (err) => console.error(err));
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
      wear(file);
    });
    grid.append(cell);
    if (file) seen.observe(cell);
  }
}

// the zoom also changes with the wheel, and its range with the window: keep its slider in step
export function adminSystem(world) {
  if (!document.getElementById('admin').hidden && document.activeElement !== document.getElementById('admin-zoom')) syncZoom(world);
}

function syncZoom(world) {
  const input = document.getElementById('admin-zoom');
  const vp = getResource(world, Viewport);
  input.min = vp.zoomMin;
  input.max = vp.zoomMax;
  input.value = vp.zoom;
  input.previousElementSibling.textContent = vp.zoom.toFixed(2);
}
