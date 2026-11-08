// The human walks: the arrows (or W A S D) move it on the ground, Shift makes it run, it turns to face where it goes, and the
// camera follows it. What stops a walker stops it (gen/collision.js, the BlockGrid), and so does a step
// higher than terrain STEP (a cliff wall); stairs are a slope, so it goes up and down them.
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player, CameraRig } from '../components.js';
import { Input, Settings, Time, Gpu, BlockGrid, Tuning } from '../resources.js';
import { isBlocked } from '../lib/footprints.js';
import { heightAt, STEP } from '../gen/terrain.js';

// the speeds its walk and run clips were made for: at other speeds (the admin menu) the clip plays faster or slower
const CLIP_SPEED = { walk: 2.4, run: 5.2 };
const RADIUS = 0.2;     // it keeps this far from what stops it
const KEYS = { up: ['arrowup', 'w', 'z'], down: ['arrowdown', 's'], left: ['arrowleft', 'a', 'q'], right: ['arrowright', 'd'] };

export function playerSystem(world) {
  const input = getResource(world, Input), settings = getResource(world, Settings), time = getResource(world, Time);
  const tuning = getResource(world, Tuning);
  const grid = getResource(world, BlockGrid), terrain = settings.land.terrain;
  const { R, groundFwd } = settings.basis;
  const down = (k) => KEYS[k].some((key) => input.keys.has(key));
  for (const e of query(world, [Player])) {
    const p = getComponent(world, e, Player);
    const mv = new THREE.Vector3();
    if (down('up')) mv.add(groundFwd);
    if (down('down')) mv.sub(groundFwd);
    if (down('right')) mv.add(R);
    if (down('left')) mv.sub(R);
    const state = mv.lengthSq() === 0 ? 'idle' : input.keys.has('shift') ? 'run' : 'walk';
    if (state !== p.state) { p.state = state; p.t = 0; }
    const speed = state === 'run' ? tuning.runSpeed : tuning.walkSpeed;
    p.t += time.dt * (state === 'idle' ? 1 : speed / CLIP_SPEED[state]);
    let moved = false;
    if (state !== 'idle') {
      mv.normalize();
      p.rot = Math.atan2(mv.x, mv.z);
      const d = speed * time.dt, l = settings.walkLimit;
      // the whole step, else only along x, else only along z (it slides along what stops it)
      for (const [dx, dz] of [[mv.x * d, mv.z * d], [mv.x * d, 0], [0, mv.z * d]]) {
        const x = THREE.MathUtils.clamp(p.x + dx, -l, l), z = THREE.MathUtils.clamp(p.z + dz, -l, l);
        if ((x === p.x && z === p.z) || !free(grid, terrain, p.x, p.z, x, z)) continue;
        p.x = x; p.z = z; moved = true;
        break;
      }
    }
    // the frame of its clip
    const frames = p.clips[p.state], frame = frames[Math.floor(p.t * p.fps) % frames.length];
    p.meshes.forEach((mesh, m) => { mesh.geometry = frame[m]; });
    p.group.position.set(p.x, heightAt(terrain, p.x, p.z) + p.foot, p.z);
    p.group.rotation.y = p.rot;
    // its shadow moves with it
    if (moved || state !== 'idle') getResource(world, Gpu).shadowsDirty = true;
    // the camera follows it
    const rig = getComponent(world, query(world, [CameraRig])[0], CameraRig);
    rig.follow = false;
    rig.target = [p.x, rig.target[1], p.z];
  }
}

// can it step from (x0, z0) to (x, z)? nothing in the way within RADIUS, and no wall up or down
function free(grid, terrain, x0, z0, x, z) {
  for (const [ox, oz] of [[0, 0], [RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]])
    if (isBlocked(grid, x + ox, z + oz)) return false;
  return Math.abs(heightAt(terrain, x, z) - heightAt(terrain, x0, z0)) <= STEP;
}
