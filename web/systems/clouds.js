// Moves the canopy shadows with the wind and feeds cloud + clearing uniforms.
import { query, getComponent, getResource } from '../ecs/world.js';
import { CloudLayer, Glade } from '../components.js';
import { Gpu, Input, Time } from '../resources.js';

export function cloudSystem(world) {
  const time = getResource(world, Time);
  const input = getResource(world, Input);
  const u = getResource(world, Gpu).shared;
  for (const e of query(world, [CloudLayer])) {
    const c = getComponent(world, e, CloudLayer);
    for (const { key } of input.pressed) if (key.toLowerCase() === 'c') c.moving = !c.moving;
    if (c.moving && !time.paused) {
      c.offset[0] += c.wind[0] * time.dt;
      c.offset[1] += c.wind[1] * time.dt;
    }
    u.uCloudOffset.value.set(c.offset[0], c.offset[1]);
    u.uCloudScale.value = c.scale;
    u.uCloudLo.value = c.lo;
    u.uCloudHi.value = c.hi;
  }
  const glades = query(world, [Glade]);
  u.uGlades.value.forEach((v, i) => {
    const g = glades[i] && getComponent(world, glades[i], Glade);
    if (g) v.set(g.x, g.z, g.r, g.k); else v.set(0, 0, 1, 0);
  });
}
