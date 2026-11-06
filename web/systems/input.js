// Turns the raw DOM records queued by the listeners into this frame's input.
import { getResource } from '../ecs/world.js';
import { Input } from '../resources.js';

export function inputSystem(world) {
  const input = getResource(world, Input);
  input.wheel = [];
  input.pressed = [];
  input.resized = false;
  for (const r of input.pending) {
    switch (r.t) {
      case 'wheel': input.wheel.push({ dy: r.dy }); break;
      case 'key':
        input.pressed.push({ key: r.key });
        input.keys.add(r.key.toLowerCase());
        break;
      case 'keyup': input.keys.delete(r.key.toLowerCase()); break;
      case 'blur': input.keys.clear(); break;
      case 'resize': input.resized = true; break;
    }
  }
  input.pending.length = 0;
}
