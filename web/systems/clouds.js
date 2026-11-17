// Moves the canopy shadows with the wind and feeds cloud + clearing uniforms.
import { query, getComponent, getResource } from '../ecs/world.js';
import { CloudLayer, Glade, CameraRig } from '../components.js';
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

// The lamps (systems/setup.js gpu.lamps): the nearest to the camera go to the post pass (render/shaders.js LAMPS);
// a flame flickers (its rings grow and shrink a little)
export function lampSystem(world) {
  const gpu = getResource(world, Gpu), u = gpu.shared, t = getResource(world, Time).now / 1000;
  const rig = query(world, [CameraRig])[0], at = rig === undefined ? [0, 0, 0] : getComponent(world, rig, CameraRig).target;
  const near = (gpu.lamps ?? []).map((l) => [Math.hypot(l.x - at[0], l.z - at[2]), l]).sort((a, b) => a[0] - b[0]);
  u.uLamps.value.forEach((v, i) => {
    const l = near[i]?.[1];
    if (!l) { v.set(0, 0, 0, 0); return; }
    const f = l.flicker ? 1 + 0.05 * Math.sin(t * 9 + l.ph) + 0.04 * Math.sin(t * 23 + l.ph * 2) : 1;
    v.set(l.x, l.y, l.z, l.r * f);
    u.uLampCol.value[i].set(l.color.r, l.color.g, l.color.b, l.k);
  });
}
