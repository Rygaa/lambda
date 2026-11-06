// Slime mobs.
//   slimeSpawnSystem      one slime of each kind near the start; a new one some time after it dies;
//                         none while the admin menu has monsters off (the default)
//   slimeBrainSystem      wander, chase the player, start an attack -> Transform, SlimeAnim
//   swordHitSystem        the player's slash hurts the slimes in front of it -> Slime.hp, SlimeAnim, Knockback
//   slimeAttackHitSystem  a slime's attack frame pushes the player back -> Knockback
//   slimeAnimationSystem  SlimeAnim -> clip, time, frame -> SlimeShape
//   slimeDeathSystem      the puddle stays a moment after the death clip, then the slime is gone
//   slimeRigSystem        SlimeShape -> the Three.js meshes (after the mesh system)
import { query, spawn, added, changed, destroyEntity, addComponent, getComponent, hasComponent, markChanged, getResource } from '../ecs/world.js';
import { Slime, SlimeBrain, SlimeAnim, SlimeShape, Knockback, Transform, Player, Animator, CameraRig, ShadowCaster, SceneObject } from '../components.js';
import { Time, Settings, BlockGrid, Random, Slimes } from '../resources.js';
import { SLIME_KINDS, SLIME_KIND_NAMES, SLIME_CLIPS, SLIME_AI as AI, SWORD, clipLength } from '../prefabs/slime.js';
import { baseShape, shapeAt } from '../lib/slimeShapes.js';
import { applySlimeShape } from '../lib/slime.js';
import { circleBlocked, slide } from '../lib/footprints.js';
import { nextRandom } from '../lib/random.js';
import { heightAt, STEP } from '../gen/terrain.js';

const between = (rng, [lo, hi]) => lo + (hi - lo) * nextRandom(rng);
const alive = (world, e) => getComponent(world, e, SlimeAnim).clip !== 'death';

// on other levels (cliffs): they do not see or reach each other
const apart = (grid, a, b) => Math.abs(heightAt(grid.ground, a.x, a.z) - heightAt(grid.ground, b.x, b.z)) > 2 * STEP;

function player(world) {
  const e = query(world, [Player, Transform])[0];
  return e ? { e, t: getComponent(world, e, Transform) } : null;
}

// switch to a looping clip (keeps the time when it already plays)
function loop(anim, clip) {
  if (anim.clip !== clip) Object.assign(anim, { clip, time: 0 });
}
// start a clip from its first frame
function play(anim, clip) {
  Object.assign(anim, { clip, time: 0 });
}

// did `time` pass the moment `at` during this frame?
const crossed = (time, dt, at) => time >= at && time - dt < at;

export function slimeSpawnSystem(world) {
  const time = getResource(world, Time);
  const settings = getResource(world, Settings);
  if (settings.layout === 'blender') return;
  if (!settings.monsters) {
    for (const e of query(world, [Slime])) destroyEntity(world, e);
    return;
  }
  if (time.paused) return;
  const slimes = getResource(world, Slimes);
  const grid = getResource(world, BlockGrid);
  const rng = getResource(world, Random);
  const living = new Set(query(world, [Slime]).map((e) => getComponent(world, e, Slime).kind));
  const [sx, , sz] = settings.land.start;
  for (const kind of SLIME_KIND_NAMES) {
    if (living.has(kind)) { slimes.due[kind] = null; continue; }
    if (slimes.due[kind] === null) slimes.due[kind] = time.sceneTime + AI.respawn;
    if (time.sceneTime < slimes.due[kind]) continue;
    // a free spot on a ring around the start
    for (let i = 0; i < 40; i++) {
      const a = nextRandom(rng) * Math.PI * 2, d = between(rng, AI.spawnRing);
      const x = sx + Math.cos(a) * d, z = sz + Math.sin(a) * d;
      if (Math.abs(x) > settings.walkLimit || Math.abs(z) > settings.walkLimit || circleBlocked(grid, x, z, AI.radius + 0.2)) continue;
      spawn(world,
        [Transform, { x, z, rotY: nextRandom(rng) * Math.PI * 2 }],
        [Slime, { kind, hp: SLIME_KINDS[kind].hp }],
        [SlimeBrain, { home: [x, z], target: [x, z], wait: between(rng, AI.wait) }],
        [SlimeAnim], [SlimeShape, baseShape(kind)], [ShadowCaster]);
      slimes.due[kind] = null;
      break;
    }
  }
}

export function slimeBrainSystem(world) {
  const time = getResource(world, Time);
  if (time.paused) return;
  const grid = getResource(world, BlockGrid);
  const rng = getResource(world, Random);
  const lim = getResource(world, Settings).walkLimit;
  const hero = player(world);
  for (const e of query(world, [Slime, SlimeBrain, SlimeAnim, Transform])) {
    const brain = getComponent(world, e, SlimeBrain);
    const anim = getComponent(world, e, SlimeAnim);
    const t = getComponent(world, e, Transform);
    brain.cooldown = Math.max(0, brain.cooldown - time.dt);
    if (!SLIME_CLIPS[anim.clip].loop) continue;          // attack, hurt and death play to their end
    const dist = hero && !apart(grid, hero.t, t) ? Math.hypot(hero.t.x - t.x, hero.t.z - t.z) : Infinity;
    brain.mode = dist < AI.sight || (brain.mode === 'chase' && dist < AI.giveUp) ? 'chase' : 'wander';
    if (brain.mode === 'chase' && dist < AI.reach) {
      t.rotY = Math.atan2(hero.t.x - t.x, hero.t.z - t.z);
      markChanged(world, e, Transform);
      if (brain.cooldown > 0) loop(anim, 'idle');
      else {
        play(anim, 'attack');
        brain.cooldown = AI.cooldown;
      }
      continue;
    }
    let goal;
    if (brain.mode === 'chase') goal = [hero.t.x, hero.t.z];
    else {
      if (brain.wait > 0) {
        brain.wait -= time.dt;
        loop(anim, 'idle');
        continue;
      }
      goal = brain.target;
      if (Math.hypot(goal[0] - t.x, goal[1] - t.z) < 0.1) {
        // arrived: stand a while, then walk somewhere else near home
        const a = nextRandom(rng) * Math.PI * 2, d = nextRandom(rng) * AI.wanderRadius;
        brain.target = [brain.home[0] + Math.cos(a) * d, brain.home[1] + Math.sin(a) * d];
        brain.wait = between(rng, AI.wait);
        loop(anim, 'idle');
        continue;
      }
    }
    // keep a body's width from the other slimes: aim a little away from them
    goal = [...goal];
    for (const o of query(world, [Slime, Transform])) {
      if (o === e) continue;
      const ot = getComponent(world, o, Transform);
      const ox = t.x - ot.x, oz = t.z - ot.z, od = Math.hypot(ox, oz);
      if (od > 0.01 && od < AI.radius * 3) {
        goal[0] += (ox / od) * AI.radius * 3;
        goal[1] += (oz / od) * AI.radius * 3;
      }
    }
    const len = Math.hypot(goal[0] - t.x, goal[1] - t.z);
    const step = Math.min(len, (brain.mode === 'chase' ? AI.runSpeed : AI.walkSpeed) * time.dt);
    const clamp = (v) => Math.max(-lim, Math.min(lim, v));
    // straight at the goal, else turned a little more each try to get around a stone
    const heading = Math.atan2(goal[0] - t.x, goal[1] - t.z);
    let nx = t.x, nz = t.z, dir = heading;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
      dir = heading + turn;
      [nx, nz] = slide(grid, t.x, t.z, clamp(t.x + Math.sin(dir) * step), clamp(t.z + Math.cos(dir) * step), AI.radius);
      if (nx !== t.x || nz !== t.z) break;
    }
    if (nx === t.x && nz === t.z) {
      brain.target = [...brain.home];       // stuck: go back home
      loop(anim, 'idle');
      continue;
    }
    t.rotY = dir;
    t.x = nx;
    t.z = nz;
    markChanged(world, e, Transform);
    loop(anim, brain.mode === 'chase' ? 'run' : 'walk');
  }
}

export function swordHitSystem(world) {
  const time = getResource(world, Time);
  if (time.paused) return;
  const hero = player(world);
  const a = hero && getComponent(world, hero.e, Animator);
  if (!a || a.clip !== 'attack' || !crossed(a.time, time.dt, SWORD.at)) return;
  const grid = getResource(world, BlockGrid);
  // where the character faces (first person: where the camera looks)
  const fps = getComponent(world, query(world, [CameraRig])[0], CameraRig)?.mode === 'fps';
  const yaw = hero.t.rotY;
  const fx = fps ? -Math.sin(yaw) : Math.sin(yaw), fz = fps ? -Math.cos(yaw) : Math.cos(yaw);
  for (const e of query(world, [Slime, SlimeAnim, Transform])) {
    if (!alive(world, e)) continue;
    const t = getComponent(world, e, Transform);
    const dx = t.x - hero.t.x, dz = t.z - hero.t.z, d = Math.hypot(dx, dz);
    if (d > SWORD.range + AI.radius || (d > 0.05 && (dx * fx + dz * fz) / d < SWORD.cosArc) || apart(grid, hero.t, t)) continue;
    const slime = getComponent(world, e, Slime);
    slime.hp -= 1;
    markChanged(world, e, Slime);
    play(getComponent(world, e, SlimeAnim), slime.hp > 0 ? 'hurt' : 'death');
    getComponent(world, e, SlimeBrain).mode = 'chase';
    const k = d > 0.05 ? SWORD.knock / d : 0;
    addComponent(world, e, Knockback, { vx: dx * k, vz: dz * k, time: 0.25 });
  }
}

export function slimeAttackHitSystem(world) {
  const time = getResource(world, Time);
  if (time.paused) return;
  const hero = player(world);
  if (!hero) return;
  for (const e of query(world, [Slime, SlimeAnim, Transform])) {
    const anim = getComponent(world, e, SlimeAnim);
    const { kind } = getComponent(world, e, Slime);
    if (anim.clip !== 'attack' || !crossed(anim.time, time.dt, AI.hitFrame[kind] / SLIME_CLIPS.attack.fps)) continue;
    const t = getComponent(world, e, Transform);
    const dx = hero.t.x - t.x, dz = hero.t.z - t.z, d = Math.hypot(dx, dz);
    if (d > AI.hitRange[kind]) continue;
    const k = d > 0.05 ? AI.knock / d : 0;
    addComponent(world, hero.e, Knockback, { vx: dx * k, vz: dz * k, time: 0.3 });
  }
}

export function slimeAnimationSystem(world) {
  const time = getResource(world, Time);
  if (time.paused) return;
  for (const e of query(world, [Slime, SlimeAnim, SlimeShape])) {
    const anim = getComponent(world, e, SlimeAnim);
    anim.time += time.dt;
    // attack and hurt go back to idle; death holds its last frame (the puddle)
    if (!SLIME_CLIPS[anim.clip].loop && anim.clip !== 'death' && anim.time >= clipLength(anim.clip)) play(anim, 'idle');
    const { frames, fps, loop: loops } = SLIME_CLIPS[anim.clip];
    const step = Math.floor(anim.time * fps);
    const frame = loops ? step % frames : Math.min(frames - 1, step);
    const key = anim.clip + frame;
    if (key === anim.shown) continue;
    anim.shown = key;
    Object.assign(getComponent(world, e, SlimeShape), shapeAt(getComponent(world, e, Slime).kind, anim.clip, frame, frames));
    markChanged(world, e, SlimeShape);
  }
}

export function slimeDeathSystem(world) {
  if (getResource(world, Time).paused) return;
  for (const e of query(world, [Slime, SlimeAnim])) {
    const anim = getComponent(world, e, SlimeAnim);
    if (anim.clip === 'death' && anim.time >= clipLength('death') + AI.linger) destroyEntity(world, e);
  }
}

export function slimeRigSystem(world) {
  const todo = new Set([...changed(world, SlimeShape), ...added(world, SceneObject)]);
  for (const e of todo) {
    const rig = getComponent(world, e, SceneObject)?.rig;
    if (rig?.slime && hasComponent(world, e, SlimeShape)) applySlimeShape(rig, getComponent(world, e, SlimeShape));
  }
}
