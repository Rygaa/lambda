// The human walks: the arrows (or W A S D) move it on the ground, Shift makes it run, it turns to face where it goes, and the
// camera follows it. Trees and water stop it by a circle (gen/collision.js, the BlockGrid), and so does a step
// higher than terrain STEP (a cliff wall); stairs are a slope, so it goes up and down them.
// Rocks and buildings stop it by their real shape (lib/tops.js): it stands on their top, a part more than LEDGE
// higher than its feet stops it, and it falls off their edges. So it can jump onto a rock and walk on it.
// Space makes it jump (Tuning jumpHeight), and it can steer in the air. The 4 parts of the jump clip: a crouch on
// the ground, going up, falling, and the crouch of the landing (cut short when it moves on).
// A click (or F) attacks: 4 hits in a row while you click again before the hit ends. It stands still while it hits.
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player, CameraRig } from '../components.js';
import { Input, Settings, Time, Gpu, BlockGrid, Tuning, Tops } from '../resources.js';
import { isBlocked } from '../lib/footprints.js';
import { topAt } from '../lib/tops.js';
import { heightAt, STEP } from '../gen/terrain.js';

// the speeds its walk and run clips were made for: at other speeds (the admin menu) the clip plays faster or slower
const CLIP_SPEED = { walk: 2.4, run: 5.2 };
const GRAVITY = 20;     // world units a second, each second
const RADIUS = 0.2;     // it keeps this far from what stops it
const LEDGE = 0.12;     // it steps up onto a top at most this much higher than its feet: within RADIUS, so a slope
                        // steeper than about 30° stops it (it must jump onto a rock)
const HITS = 4;         // the attack clips attack1 ... attack4
const KEYS = { up: ['arrowup', 'w', 'z'], down: ['arrowdown', 's'], left: ['arrowleft', 'a', 'q'], right: ['arrowright', 'd'] };
const AROUND = [[0, 0], [RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]];

export function playerSystem(world) {
  const input = getResource(world, Input), settings = getResource(world, Settings), time = getResource(world, Time);
  const tuning = getResource(world, Tuning), tops = getResource(world, Tops);
  const grid = getResource(world, BlockGrid), terrain = settings.land.terrain;
  const { R, groundFwd } = settings.basis;
  const down = (k) => KEYS[k].some((key) => input.keys.has(key));
  const pressed = (k) => input.pressed.some(({ key }) => key.toLowerCase() === k);
  // the ground under its centre: the terrain, or the top of a rock or a building
  const groundAt = (x, z) => Math.max(heightAt(terrain, x, z), topAt(tops, x, z));
  for (const e of query(world, [Player])) {
    const p = getComponent(world, e, Player);
    const j = p.jump, a = p.attack, dt = time.dt;
    const clipTime = (state) => (p.clips[state].length - 1) / p.fps;
    p.y ??= groundAt(p.x, p.z);

    // the attack: a click during a hit makes the next hit follow it
    if (pressed('click') || pressed('f')) {
      if (a.hit) a.queued = true;
      else if (!j.air && !j.crouch) { a.hit = 1; a.left = clipTime('attack1'); a.queued = false; }
    }
    if (a.hit && (a.left -= dt) <= 0) {
      if (a.queued) { a.hit = (a.hit % HITS) + 1; a.left = clipTime('attack' + a.hit); a.queued = false; } else a.hit = 0;
    }

    const mv = new THREE.Vector3();
    if (down('up')) mv.add(groundFwd);
    if (down('down')) mv.sub(groundFwd);
    if (down('right')) mv.add(R);
    if (down('left')) mv.sub(R);
    const moving = !a.hit && mv.lengthSq() > 0, running = input.keys.has('shift');
    const speed = running ? tuning.runSpeed : tuning.walkSpeed;

    // a step on the ground or in the air: the whole step, else only along x, else only along z (it slides along what stops it)
    let moved = false;
    if (moving) {
      mv.normalize();
      p.rot = Math.atan2(mv.x, mv.z);
      const d = speed * dt, l = settings.walkLimit;
      for (const [dx, dz] of [[mv.x * d, mv.z * d], [mv.x * d, 0], [0, mv.z * d]]) {
        const x = THREE.MathUtils.clamp(p.x + dx, -l, l), z = THREE.MathUtils.clamp(p.z + dz, -l, l);
        if ((x === p.x && z === p.z) || !free(grid, tops, terrain, p.x, p.z, x, z, p.y)) continue;
        p.x = x; p.z = z; moved = true;
        break;
      }
    }

    // up and down. Space: it crouches on the ground first (jumpStart), then leaves the ground
    const ground = groundAt(p.x, p.z);
    if (!a.hit && !j.air && !j.crouch && pressed(' ')) j.crouch = clipTime('jumpStart');
    if (j.crouch > 0) {
      p.y = ground;
      j.crouch = Math.max(0, j.crouch - dt);
      if (!j.crouch) { j.air = true; j.vy = Math.sqrt(2 * GRAVITY * tuning.jumpHeight); }
    } else if (j.air) {
      p.y += j.vy * dt;
      j.vy -= GRAVITY * dt;
      if (p.y <= ground) { j.air = false; p.y = ground; j.land = clipTime('jumpLand'); }
    } else if (ground < p.y - LEDGE) {
      j.air = true; j.vy = 0;          // it walked off an edge: it falls
    } else {
      p.y = ground;
      j.land = Math.max(0, j.land - dt);
    }

    const state = a.hit ? 'attack' + a.hit : j.crouch > 0 ? 'jumpStart' : j.air ? (j.vy > 0 ? 'jumpUp' : 'jumpDown')
      : j.land > 0 && !moving ? 'jumpLand' : moving ? (running ? 'run' : 'walk') : 'idle';
    if (state !== p.state) { p.state = state; p.t = 0; }
    p.t += dt * (CLIP_SPEED[state] ? speed / CLIP_SPEED[state] : 1);

    // the frame of its clip: walk, run and idle loop; a part of the jump or a hit stops on its last frame
    const frames = p.clips[p.state], k = Math.floor(p.t * p.fps);
    const frame = frames[/^(jump|attack)/.test(p.state) ? Math.min(k, frames.length - 1) : k % frames.length];
    p.meshes.forEach((mesh, m) => { mesh.geometry = frame[m]; });
    p.group.position.set(p.x, p.y + p.foot, p.z);
    p.group.rotation.y = p.rot;
    // its shadow moves with it
    if (moved || state !== 'idle') getResource(world, Gpu).shadowsDirty = true;
    // the camera follows it
    const rig = getComponent(world, query(world, [CameraRig])[0], CameraRig);
    rig.follow = false;
    rig.target = [p.x, rig.target[1], p.z];
  }
}

// can it go from (x0, z0) to (x, z) with its feet at y? no tree or water within RADIUS, no top of a rock or a
// building more than LEDGE above its feet, and no cliff wall up or down. A point of its circle that is already
// over a rock (it landed against the rock) stops only a step towards that point, so it can walk along the rock or
// away from it
function free(grid, tops, terrain, x0, z0, x, z, y) {
  const high = (px, pz) => topAt(tops, px, pz) > y + LEDGE;
  for (const [ox, oz] of AROUND) {
    if (isBlocked(grid, x + ox, z + oz)) return false;
    if (high(x + ox, z + oz) && (!high(x0 + ox, z0 + oz) || (x - x0) * ox + (z - z0) * oz > 0)) return false;
  }
  return Math.abs(heightAt(terrain, x, z) - heightAt(terrain, x0, z0)) <= STEP;
}
