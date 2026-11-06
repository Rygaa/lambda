// Turns the raw DOM records queued by the listeners into this frame's input.
import { getResource } from '../ecs/world.js';
import { Input } from '../resources.js';

export function inputSystem(world) {
  const input = getResource(world, Input);
  input.dragDelta = [0, 0];
  input.lookDelta = [0, 0];
  input.clicks = [];
  input.rightClicks = [];
  input.wheel = [];
  input.pressed = [];
  input.ui = [];
  input.stream = [];
  input.resized = false;
  for (const r of input.pending) {
    switch (r.t) {
      case 'down':
        input.drag = { sx: r.x, sy: r.y, x: r.x, y: r.y, button: r.button, moved: false };
        if (r.button === 2) { input.rightClicks.push({ x: r.x, y: r.y }); input.stream.push({ kind: 'right', x: r.x, y: r.y }); }
        break;
      case 'up':
        if (input.drag && !input.drag.moved && input.drag.button === 0) {
          input.clicks.push({ x: r.x, y: r.y });
          input.stream.push({ kind: 'click', x: r.x, y: r.y });
        }
        input.drag = null;
        break;
      case 'move': {
        input.pointer = { x: r.x, y: r.y };
        const d = input.drag;
        if (!d || d.button === 2) break;
        if (!d.moved && Math.hypot(r.x - d.sx, r.y - d.sy) < 5) break;
        d.moved = true;
        input.dragDelta[0] += r.x - d.x;
        input.dragDelta[1] += r.y - d.y;
        d.x = r.x; d.y = r.y;
        break;
      }
      case 'look': input.lookDelta[0] += r.dx; input.lookDelta[1] += r.dy; break;
      case 'wheel':
        input.wheel.push({ dy: r.dy, shift: r.shift });
        input.stream.push({ kind: 'wheel', dy: r.dy, shift: r.shift });
        break;
      case 'key':
        input.pressed.push({ key: r.key, ctrl: r.ctrl });
        input.stream.push({ kind: 'key', key: r.key, ctrl: r.ctrl });
        input.keys.add(r.key.toLowerCase());
        break;
      case 'keyup': input.keys.delete(r.key.toLowerCase()); break;
      case 'blur': input.keys.clear(); break;
      case 'resize': input.resized = true; break;
      case 'ui': input.ui.push(r); input.stream.push({ ...r, kind: 'ui' }); break;
    }
  }
  input.pending.length = 0;
}
