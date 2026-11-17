// Where a point of the world is on the screen, like the fine pass draws it (render/shaders.js FINE_VERT), and the
// monster under the mouse. The bars and numbers of systems/hud.js and the target of a skill (systems/skills.js) use it.
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { Monster } from '../components.js';
import { Gpu, Settings, ActiveView } from '../resources.js';

const v = new THREE.Vector3();

// a world point -> [x, y] in CSS pixels of the canvas (null before the fine pass is ready)
export function toScreen(world, x, y, z) {
  const gpu = getResource(world, Gpu);
  if (!gpu.fine) return null;
  const canvas = getResource(world, Settings).canvas, u = gpu.fine.uniforms;
  v.set(x, y, z).project(getResource(world, ActiveView).camera);
  const sx = ((v.x * 0.5 + 0.5) * u.uLowSize.value.x - 1 - u.uOffset.value.x) * u.uScale.value + u.uMargin.value.x;
  const sy = ((v.y * 0.5 + 0.5) * u.uLowSize.value.y - 1 - u.uOffset.value.y) * u.uScale.value + u.uMargin.value.y;
  return [(sx / u.uScreen.value.x) * canvas.clientWidth, (1 - sy / u.uScreen.value.y) * canvas.clientHeight];
}

// the living monster under the mouse ({ x, y } in CSS pixels of the canvas), or null: the one whose line from its
// feet to its top passes nearest, within half its width on the screen (at least PICK pixels)
const PICK = 14;
export function monsterAt(world, mouse) {
  if (!mouse) return null;
  let best = null, bestD = Infinity;
  for (const e of query(world, [Monster])) {
    const m = getComponent(world, e, Monster);
    if (m.mode === 'dead') continue;
    const a = toScreen(world, m.x, m.y, m.z), b = toScreen(world, m.x, m.y + m.foot + m.height, m.z), side = toScreen(world, m.x + m.radius, m.y, m.z);
    if (!a) return null;
    const dx = b[0] - a[0], dy = b[1] - a[1], k = Math.max(0, Math.min(1, ((mouse.x - a[0]) * dx + (mouse.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(mouse.x - a[0] - k * dx, mouse.y - a[1] - k * dy);
    if (d < Math.max(PICK, Math.abs(side[0] - a[0])) && d < bestD) { best = e; bestD = d; }
  }
  return best;
}
