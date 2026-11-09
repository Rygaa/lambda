// The admin menu: the button at the top left opens it. Its sliders change values while the game runs:
// the walk and run speeds and the jump height of the human (the Tuning resource) and the zoom (the Viewport resource).
// Its lists change the clothes of the human, one list per slot (the Wardrobe resource, systems/outfit.js).
// The markup is in index.html (#admin-button, #admin).
import { getResource } from '../ecs/world.js';
import { Tuning, Viewport, Wardrobe } from '../resources.js';
import { ZOOM_STEP } from './viewport.js';

// one slider: [id, label, read the value, set the value, min, max, step, how to show the value]
const SLIDERS = [
  ['walk', 'Walk speed', (w) => getResource(w, Tuning).walkSpeed, (w, v) => { getResource(w, Tuning).walkSpeed = v; }, 0.5, 8, 0.1, (v) => v.toFixed(1)],
  ['run', 'Run speed (Shift)', (w) => getResource(w, Tuning).runSpeed, (w, v) => { getResource(w, Tuning).runSpeed = v; }, 1, 16, 0.1, (v) => v.toFixed(1)],
  ['jump', 'Jump height (Space)', (w) => getResource(w, Tuning).jumpHeight, (w, v) => { getResource(w, Tuning).jumpHeight = v; }, 0.2, 4, 0.1, (v) => v.toFixed(1)],
  ['zoom', 'Zoom', (w) => getResource(w, Viewport).zoom, (w, v) => { const vp = getResource(w, Viewport); vp.zoom = v; vp.dirty = true; }, 0, 0, ZOOM_STEP, (v) => v.toFixed(2)],
];

// one list of clothes: [slot, label, its first choice ('' : none or the bare body; null: no such choice)]
const SLOTS = [
  ['head', 'Head', null], ['hair', 'Hair', null], ['upper', 'Clothes', 'bare'], ['hand', 'Gloves', 'bare hands'],
  ['foot', 'Shoes', 'bare feet'], ['cap', 'Cap', 'none'], ['cloak', 'Cloak', 'none'], ['mask', 'Mask', 'none'],
];

export function setupAdminSystem(world) {
  const panel = document.getElementById('admin');
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
    panel.append(row);
  }
  const w = getResource(world, Wardrobe), title = document.createElement('h3');
  title.textContent = 'Clothes';
  panel.append(title);
  for (const [slot, label, none] of SLOTS) {
    const row = document.createElement('label');
    row.innerHTML = `<span>${label}</span><output>${w.slots[slot].length}</output><select></select>`;
    const select = row.querySelector('select');
    select.id = 'admin-' + slot;
    if (none !== null) select.add(new Option(none, ''));
    const seen = new Map();   // the same name twice gets a number
    for (const { name, file } of w.slots[slot]) {
      seen.set(name, (seen.get(name) ?? 0) + 1);
      select.add(new Option(seen.get(name) > 1 ? `${name} ${seen.get(name)}` : name, file));
    }
    select.value = w.outfit[slot] ?? '';
    select.addEventListener('change', () => { w.outfit[slot] = select.value || null; w.dirty = true; select.blur(); });
    panel.append(row);
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
