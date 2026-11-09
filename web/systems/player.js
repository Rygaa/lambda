// The human walks: the arrows (or W A S D) move it on the ground, Shift makes it run, it turns to face where it goes, and the
// camera follows it. What stops a walker stops it (gen/collision.js, the BlockGrid), and so does a step
// higher than terrain STEP (a cliff wall); stairs are a slope, so it goes up and down them.
// Space makes it jump (Tuning jumpHeight), and it can steer in the air. The 4 parts of the jump clip: a crouch on
// the ground, going up, falling, and the crouch of the landing (cut short when it moves on).
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player, CameraRig } from '../components.js';
import { Input, Settings, Time, Gpu, BlockGrid, Tuning } from '../resources.js';
import { isBlocked } from '../lib/footprints.js';
import { heightAt, STEP } from '../gen/terrain.js';

// the speeds its walk and run clips were made for: at other speeds (the admin menu) the clip plays faster or slower
const CLIP_SPEED = { walk: 2.4, run: 5.2 };
const GRAVITY = 20;     // world units a second, each second
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
    const moving = mv.lengthSq() > 0, running = input.keys.has('shift');
    const j = p.jump;
    const clipTime = (state) => (p.clips[state].length - 1) / p.fps;
    // Space: it crouches on the ground first (jumpStart), then leaves the ground
    if (!j.air && !j.crouch && input.pressed.some(({ key }) => key === ' ')) j.crouch = clipTime('jumpStart');
    if (j.crouch > 0) {
      j.crouch = Math.max(0, j.crouch - time.dt);
      if (!j.crouch) { j.air = true; j.h = 0; j.vy = Math.sqrt(2 * GRAVITY * tuning.jumpHeight); }
    } else if (j.air) {
      j.h += j.vy * time.dt;
      j.vy -= GRAVITY * time.dt;
      if (j.h <= 0) { j.air = false; j.h = 0; j.land = clipTime('jumpLand'); }
    } else j.land = Math.max(0, j.land - time.dt);
    const ground = moving ? (running ? 'run' : 'walk') : 'idle';
    const state = j.crouch > 0 ? 'jumpStart' : j.air ? (j.vy > 0 ? 'jumpUp' : 'jumpDown')
      : j.land > 0 && !moving ? 'jumpLand' : ground;
    if (state !== p.state) { p.state = state; p.t = 0; }
    const speed = running ? tuning.runSpeed : tuning.walkSpeed;
    p.t += time.dt * (CLIP_SPEED[state] ? speed / CLIP_SPEED[state] : 1);
    let moved = false;
    if (moving) {
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
    // the walk, run and idle clips loop; a part of the jump stops on its last frame
    const frames = p.clips[p.state], k = Math.floor(p.t * p.fps);
    const frame = frames[p.state.startsWith('jump') ? Math.min(k, frames.length - 1) : k % frames.length];
    p.meshes.forEach((mesh, m) => { mesh.geometry = frame[m]; });
    p.group.position.set(p.x, heightAt(terrain, p.x, p.z) + p.foot + j.h, p.z);
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
