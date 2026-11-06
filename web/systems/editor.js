// Settings panel: # (or the # button) pauses the world and opens the panel:
// camera mode, first-person options, monsters on / off and the character's look. Nothing can be
// placed or removed: the world comes from its recipe (gen/).
import { getComponent, query, getResource } from '../ecs/world.js';
import { Transform, CameraRig, Player, Character } from '../components.js';
import { Editor, Input, Settings, Ui, Viewport } from '../resources.js';
import { THIRD } from '../prefabs/player.js';

export function editorActionSystem(world) {
  const editor = getResource(world, Editor);
  const input = getResource(world, Input);
  const settings = getResource(world, Settings);
  for (const ev of input.stream) {
    // # (or the # button) opens / closes the panel; everything else only while open
    if ((ev.kind === 'key' && ev.key === '#') || (ev.kind === 'ui' && ev.action === 'toggle')) {
      editor.active = !editor.active;
      continue;
    }
    if (!editor.active || ev.kind !== 'ui') continue;
    if (ev.action === 'camera') setCameraMode(world, ev.mode);
    if (ev.action === 'zoom') {
      const vp = getResource(world, Viewport);
      vp.zoom = ev.value;
      vp.dirty = true;
    }
    // first-person and monster settings
    if (ev.action === 'set') {
      settings[ev.key] = Array.isArray(ev.value) ? [...ev.value] : ev.value;
      getResource(world, Viewport).dirty = true;
    }
  }
}

// top view: free camera; third / first person: the camera goes to the player
function setCameraMode(world, mode) {
  const cam = query(world, [CameraRig])[0];
  const rig = getComponent(world, cam, CameraRig);
  const player = query(world, [Player, Transform])[0];
  if (mode !== 'top' && !player) return;
  rig.mode = mode;
  if (mode !== 'top') {
    const t = getComponent(world, player, Transform);
    rig.target = [t.x, rig.target[1], t.z];
    // third person starts behind the character, looking a little down
    if (mode === 'third') {
      const p = getComponent(world, player, Player);
      p.yaw = t.rotY + Math.PI;
      p.pitch = THIRD.startPitch;
    }
  }
}

// keeps the DOM in step with the panel state
export function editorUiSystem(world) {
  const editor = getResource(world, Editor);
  const input = getResource(world, Input);
  const ui = getResource(world, Ui);
  document.body.classList.toggle('editing', editor.active);
  const mode = getComponent(world, query(world, [CameraRig])[0], CameraRig).mode;
  for (const b of ui.cameraButtons) b.el.classList.toggle('on', b.mode === mode);
  const settings = getResource(world, Settings);
  for (const b of ui.fpsButtons) b.el.classList.toggle('on', String(settings[b.key]) === String(b.value));
  const vp = getResource(world, Viewport);
  ui.zoomSlider.disabled = !!settings.fixed;
  if (editor.active && document.activeElement !== ui.zoomSlider)
    Object.assign(ui.zoomSlider, { min: vp.zoomMin, max: vp.zoomMax, value: vp.zoom });
  const player = query(world, [Player, Character])[0];
  const look = player && getComponent(world, player, Character);
  for (const b of ui.lookButtons) b.el.classList.toggle('on', !!look && look[b.key === 'color' ? 'hairColor' : b.key] === b.value);
  // first or third person while playing: clicks lock the mouse (see setup.js listeners)
  const mouseLook = (mode === 'fps' || mode === 'third') && !editor.active;
  document.body.dataset.look = mouseLook ? 'on' : 'off';
  if (!mouseLook && document.pointerLockElement === ui.canvas) document.exitPointerLock();
  ui.canvas.classList.toggle('drag', !!input.drag?.moved);
}
