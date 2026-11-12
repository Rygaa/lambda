// The human walks: the arrows (or W A S D) move it on the ground, Shift makes it run, it turns to face where it goes, and the
// camera follows it. What stops it is in lib/walk.js: trees, water, cliff walls, and rocks and buildings by their
// real shape. It falls off the edges of a rock, so it can jump onto a rock and walk on it.
// Space makes it jump (Tuning jumpHeight), and it can steer in the air. The 4 parts of the jump clip: a crouch on
// the ground, going up, falling, and the crouch of the landing (cut short when it moves on).
// A click (or F) attacks: 4 sword hits in a row while you click again before the hit ends; with no weapon, 2 punches
// (punch1, punch2) that hit half as hard. It keeps walking while it hits:
// its legs walk or run and the rest of it hits (the clips attack1Walk, attack1Run..., lib/character.js), and the hit
// goes where it faces. While a skill plays (systems/skills.js moves it), it does not walk, jump or attack, and shows
// the clip of the skill. When no hit follows, it plays the end of the hit: its way back, melting into idle or walk.
// On the blow of each hit (character.json hits, from FlyFF data/motions.ron) it sends a Swing (systems/combat.js).
// Hurt (systems/combat.js sets hurt), it plays its hurt clip when it stands still. Dead (dead > 0), it lies down,
// and stands up again with full HP when dead is back to 0.
import * as THREE from 'three';
import { query, getComponent, getResource, sendEvent } from '../ecs/world.js';
import { Player, CameraRig, Health, Skills } from '../components.js';
import { Input, Settings, Time, Gpu, BlockGrid, Tuning, Tops, Wardrobe } from '../resources.js';
import { Swing } from '../events.js';
import { free, groundAt as groundOf, LEDGE } from '../lib/walk.js';
import { showFrame } from '../lib/bake.js';
import { heightAt } from '../gen/terrain.js';
import { ONCE } from '../lib/character.js';

// the speeds its walk and run clips were made for: at other speeds (the admin menu) the clip plays faster or slower
const CLIP_SPEED = { walk: 2.4, run: 5.2 };
const GRAVITY = 20;     // world units a second, each second
const RADIUS = 0.2;     // it keeps this far from what stops it
const HITS = { attack: 4, punch: 2 };   // the attack clips attack1 ... attack4 (a weapon), punch1, punch2 (none)
const FIST = 0.5;       // a punch hits this much of a sword hit
const KEYS = { up: ['arrowup', 'w', 'z'], down: ['arrowdown', 's'], left: ['arrowleft', 'a', 'q'], right: ['arrowright', 'd'] };

export function playerSystem(world) {
  const input = getResource(world, Input), settings = getResource(world, Settings), time = getResource(world, Time);
  const tuning = getResource(world, Tuning), tops = getResource(world, Tops), { config, outfit } = getResource(world, Wardrobe);
  const grid = getResource(world, BlockGrid), terrain = settings.land.terrain;
  const { R, groundFwd } = settings.basis;
  const down = (k) => KEYS[k].some((key) => input.keys.has(key));
  const pressed = (k) => input.pressed.some(({ key }) => key.toLowerCase() === k);
  // the ground under its centre: the terrain, or the top of a rock or a building
  const groundAt = (x, z) => groundOf(terrain, tops, x, z);
  for (const e of query(world, [Player, Health])) {
    const p = getComponent(world, e, Player), health = getComponent(world, e, Health);
    const j = p.jump, a = p.attack, dt = time.dt, skill = getComponent(world, e, Skills)?.active ?? null;
    const clipTime = (state) => (p.clips[state].length - 1) / p.fps;
    p.y ??= groundAt(p.x, p.z);

    // dead: it lies there, then stands up again with full HP
    if (p.dead > 0) {
      a.hit = 0; a.end = 0; j.crouch = 0; j.air = false; p.hurt = 0;
      p.y = groundAt(p.x, p.z);
      if ((p.dead -= dt) <= 0) { p.dead = 0; health.hp = health.max; }
    }
    const alive = p.dead <= 0;
    if (skill) { a.hit = 0; a.end = 0; a.queued = false; }

    // the attack: a click during a hit makes the next hit follow it; a click during the end of a hit (its way back,
    // attack1End...) starts the next hit at once
    // kind: attack (sword hits, with any weapon) or punch (no weapon), kept until the hits stop
    const start = (hit) => { a.hit = hit; a.end = 0; a.left = clipTime(a.kind + hit); a.queued = false; a.struck = false; };
    if (alive && !skill && (pressed('click') || pressed('f'))) {
      if (a.hit) a.queued = true;
      else if (a.end) start((a.end % HITS[a.kind]) + 1);
      else if (!j.air && !j.crouch) { a.kind = outfit.weapon ? 'attack' : 'punch'; start(1); }
    }
    if (a.hit && (a.left -= dt) <= 0) {
      if (a.queued) start((a.hit % HITS[a.kind]) + 1);
      else { a.end = a.hit; a.hit = 0; a.left = clipTime(a.kind + a.end + 'End'); }
    } else if (a.end && (a.left -= dt) <= 0) a.end = 0;
    // the blow of this hit
    if (a.hit && !a.struck && clipTime(a.kind + a.hit) - a.left >= config.hits[a.kind + a.hit]) {
      a.struck = true;
      sendEvent(world, Swing, { x: p.x, z: p.z, rot: p.rot, range: config.attackRange, arc: config.attackArc, power: a.kind === 'punch' ? FIST : 1 });
    }

    const mv = new THREE.Vector3();
    if (down('up')) mv.add(groundFwd);
    if (down('down')) mv.sub(groundFwd);
    if (down('right')) mv.add(R);
    if (down('left')) mv.sub(R);
    const moving = alive && !skill && mv.lengthSq() > 0, running = input.keys.has('shift');
    const speed = running ? tuning.runSpeed : tuning.walkSpeed;

    // a step on the ground or in the air: the whole step, else only along x, else only along z (it slides along what stops it)
    let moved = false;
    if (moving) {
      mv.normalize();
      p.rot = Math.atan2(mv.x, mv.z);
      const d = speed * dt, l = settings.walkLimit;
      for (const [dx, dz] of [[mv.x * d, mv.z * d], [mv.x * d, 0], [0, mv.z * d]]) {
        const x = THREE.MathUtils.clamp(p.x + dx, -l, l), z = THREE.MathUtils.clamp(p.z + dz, -l, l);
        if ((x === p.x && z === p.z) || !free(grid, tops, terrain, p.x, p.z, x, z, p.y, RADIUS)) continue;
        p.x = x; p.z = z; moved = true;
        break;
      }
    }

    // up and down. Space: it crouches on the ground first (jumpStart), then leaves the ground
    const ground = groundAt(p.x, p.z);
    if (alive && !skill && !a.hit && !j.air && !j.crouch && pressed(' ')) { j.crouch = clipTime('jumpStart'); a.end = 0; }
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

    p.hurt = Math.max(0, p.hurt - dt);
    const pace = moving ? (running ? 'Run' : 'Walk') : '';
    const state = !alive ? 'dead' : skill ? skill.clip : a.hit ? a.kind + a.hit + pace : a.end && !j.air ? a.kind + a.end + 'End' + pace : j.crouch > 0 ? 'jumpStart' : j.air ? (j.vy > 0 ? 'jumpUp' : 'jumpDown')
      : j.land > 0 && !moving ? 'jumpLand' : moving ? (running ? 'run' : 'walk') : p.hurt > 0 ? 'hit' : 'idle';
    if (state !== p.state) { p.state = state; p.t = 0; }
    p.t += dt * (CLIP_SPEED[state] ? speed / CLIP_SPEED[state] : 1);
    // a hit goes on from where it is when it starts or stops walking
    if (skill) p.t = skill.t;
    else if (a.hit) p.t = clipTime(a.kind + a.hit) - a.left;
    else if (a.end && !j.air) p.t = clipTime(a.kind + a.end + 'End') - a.left;

    // the frame of its clip: walk, run and idle loop; a part of the jump or a hit stops on its last frame
    const frames = p.clips[p.state], k = Math.floor(p.t * p.fps);
    const frame = frames[ONCE(p.state) ? Math.min(k, frames.length - 1) : k % frames.length];
    showFrame(p.meshes, frame);
    p.group.position.set(p.x, p.y + p.foot, p.z);
    p.group.rotation.y = p.rot;
    // its shadow moves with it
    if (moved || state !== 'idle') getResource(world, Gpu).bodiesDirty = true;
    // the camera follows it
    const rig = getComponent(world, query(world, [CameraRig])[0], CameraRig);
    rig.follow = false;
    // on a FlyFF map the ground goes up and down: the camera follows its height (not the jumps)
    rig.target = [p.x, terrain?.kind === 'map' ? heightAt(terrain, p.x, p.z) + 0.6 : rig.target[1], p.z];
  }
}
