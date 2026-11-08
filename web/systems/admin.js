// The admin menu: the button at the top left opens it. Its sliders change values while the game runs:
// the walk and run speeds of the human (the Tuning resource) and the zoom (the Viewport resource).
// The markup is in index.html (#admin-button, #admin).
import { getResource } from '../ecs/world.js';
import { Tuning, Viewport } from '../resources.js';
import { ZOOM_STEP } from './viewport.js';

// one slider: [id, label, read the value, set the value, min, max, step, how to show the value]
const SLIDERS = [
  ['walk', 'Walk speed', (w) => getResource(w, Tuning).walkSpeed, (w, v) => { getResource(w, Tuning).walkSpeed = v; }, 0.5, 8, 0.1, (v) => v.toFixed(1)],
  ['run', 'Run speed (Shift)', (w) => getResource(w, Tuning).runSpeed, (w, v) => { getResource(w, Tuning).runSpeed = v; }, 1, 16, 0.1, (v) => v.toFixed(1)],
  ['zoom', 'Zoom', (w) => getResource(w, Viewport).zoom, (w, v) => { const vp = getResource(w, Viewport); vp.zoom = v; vp.dirty = true; }, 0, 0, ZOOM_STEP, (v) => v.toFixed(2)],
];

export function setupAdminSystem(world) {
  const panel = document.getElementById('admin');
  document.getElementById('admin-button').addEventListener('click', () => { panel.hidden = !panel.hidden; syncZoom(world); });
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
