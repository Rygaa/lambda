// Frame time. The scene clock stops while the editor is open or with ?freeze.
import { getResource } from '../ecs/world.js';
import { Time, Editor, Settings } from '../resources.js';

export function timeSystem(world) {
  const time = getResource(world, Time);
  if (time.prev === null) time.prev = time.now;
  time.dt = Math.min(0.05, Math.max(0, time.now - time.prev) / 1000);
  time.prev = time.now;
  time.paused = getResource(world, Editor).active || getResource(world, Settings).freeze;
  if (!time.paused) time.sceneTime += time.dt;
}
