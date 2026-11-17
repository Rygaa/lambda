// The grass and the flowers of a big world (a FlyFF map, gen/map.js: Settings coverChunks), too big to cover all at
// once: squares of CHUNK units around the camera (which follows the human). The squares that reach within grassHalf
// of it are made, a few each frame (all of them at the start), and the squares far behind are removed. Each square
// has its own random numbers, so it comes back the same. The dust (render/shaders.js DUST_VERT) moves with it.
import { query, getComponent, getResource, destroyEntity } from '../ecs/world.js';
import { GroundCover, CameraRig, DustField, SceneObject } from '../components.js';
import { Settings } from '../resources.js';
import { nextRandom, hashSeed } from '../lib/random.js';
import { heightAt } from '../gen/terrain.js';
import { spawnCover } from './setup.js';

export const CHUNK = 16;
const PER_FRAME = 2;     // squares made in one frame (each takes a few milliseconds)

export function coverChunkSystem(world) {
  const settings = getResource(world, Settings);
  if (!settings.coverChunks) return;
  const [cx, , cz] = getComponent(world, query(world, [CameraRig])[0], CameraRig).target, R = settings.grassHalf;
  // how far the square (i, j) is from the camera target
  const away = (i, j) => Math.hypot(Math.max(0, i * CHUNK - cx, cx - (i + 1) * CHUNK), Math.max(0, j * CHUNK - cz, cz - (j + 1) * CHUNK));

  const have = new Map();    // name of a square -> its entities
  for (const e of query(world, [GroundCover])) {
    const { chunk } = getComponent(world, e, GroundCover);
    if (!have.has(chunk)) have.set(chunk, []);
    have.get(chunk).push(e);
  }
  for (const [name, entities] of have) {
    const [i, j] = name.split(',').map(Number);
    if (away(i, j) <= R + CHUNK) continue;
    for (const e of entities) {
      const so = getComponent(world, e, SceneObject);
      so?.group.geometry.dispose();
      so?.group.material.dispose();
      destroyEntity(world, e);
    }
    have.delete(name);
  }

  const wanted = [];
  for (let i = Math.floor((cx - R) / CHUNK); i <= Math.floor((cx + R) / CHUNK); i++)
    for (let j = Math.floor((cz - R) / CHUNK); j <= Math.floor((cz + R) / CHUNK); j++)
      if (!have.has(`${i},${j}`) && away(i, j) <= R) wanted.push([away(i, j), i, j]);
  wanted.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of wanted.slice(0, have.size ? PER_FRAME : wanted.length)) {
    const rng = { seed: hashSeed('cover', i, j) };
    spawnCover(world, [i * CHUNK, (i + 1) * CHUNK, j * CHUNK, (j + 1) * CHUNK], () => nextRandom(rng), `${i},${j}`);
  }

  const y = heightAt(settings.land.terrain, cx, cz);
  for (const e of query(world, [DustField, SceneObject]))
    getComponent(world, e, SceneObject).group.material.uniforms.uBoxMin.value.set(cx - R, y + 0.15, cz - R);
}
