// The player's character: actions, look, animation and posing the rig.
//   characterLookSystem    editor panel choices -> Character (any time, also while paused)
//   characterActionSystem  space: jump, F: attack, G (hold): shield -> Animator
//   animationSystem        Player + Animator -> clip, time -> Pose
//   rigPoseSystem          Pose -> the Three.js joints (after the mesh system)
//   spriteFrameSystem      the sprite model's frame (after the view system)
import { query, added, changed, getComponent, hasComponent, markChanged, getResource } from '../ecs/world.js';
import { Player, Character, Animator, Pose, SceneObject, Transform } from '../components.js';
import { Input, Time, Gpu } from '../resources.js';
import { CLIPS, GUARD_SPEED, SPRITE } from '../prefabs/character.js';
import { poseAt } from '../lib/poses.js';
import { applyPose } from '../lib/character.js';

const oneShot = (clip) => CLIPS[clip] && !CLIPS[clip].loop;

export function characterLookSystem(world) {
  const input = getResource(world, Input);
  for (const ev of input.ui) {
    if (ev.action !== 'look') continue;
    for (const e of query(world, [Player, Character])) {
      const look = getComponent(world, e, Character);
      if (ev.key === 'color') look.hairColor = look.beardColor = ev.value;
      else look[ev.key] = ev.value;
      markChanged(world, e, Character);
    }
  }
}

export function characterActionSystem(world) {
  if (getResource(world, Time).paused) return;
  const input = getResource(world, Input);
  const keys = input.pressed.map((p) => p.key.toLowerCase());
  for (const e of query(world, [Player, Animator])) {
    const a = getComponent(world, e, Animator);
    a.guardHeld = input.keys.has('g');
    if (oneShot(a.clip)) continue;          // a jump or an attack plays to its end
    const start = keys.includes(' ') ? 'jump' : keys.includes('f') ? 'attack' : null;
    if (start) { a.clip = start; a.time = 0; }
  }
}

export function animationSystem(world) {
  const time = getResource(world, Time);
  if (time.paused) return;
  for (const e of query(world, [Animator, Pose])) {
    const a = getComponent(world, e, Animator);
    const p = getComponent(world, e, Player);
    a.guard = Math.min(1, Math.max(0, a.guard + (a.guardHeld ? 1 : -1) * GUARD_SPEED * time.dt));
    a.time += time.dt;
    if (oneShot(a.clip) && a.time >= CLIPS[a.clip].length) { a.clip = 'idle'; a.time = 0; }
    if (!oneShot(a.clip)) {
      // what it does on its own: shield, run, walk or stand
      const clip = a.guard > 0 ? 'defend' : p?.moving ? (p.running ? 'run' : 'walk') : 'idle';
      if (clip !== a.clip) {
        // walk <-> run keep the step they are at
        if (CLIPS[a.clip]?.loop && CLIPS[clip]?.loop && clip !== 'idle' && a.clip !== 'idle')
          a.time = (a.time / CLIPS[a.clip].length) * CLIPS[clip].length;
        else a.time = 0;
        a.clip = clip;
      }
    }
    const info = CLIPS[a.clip];
    const t = !info ? 0 : info.loop ? (a.time / info.length) % 1 : a.time / info.length;
    Object.assign(getComponent(world, e, Pose), poseAt(a.clip, t, a.guard));
    markChanged(world, e, Pose);
  }
}

// the sprite model: the row from where it faces, seen from the camera; the
// column from the walk / run clip (after the view system has set uCamR)
export function spriteFrameSystem(world) {
  const gpu = getResource(world, Gpu);
  const R = gpu.shared.uCamR.value;
  const rx = R.x / Math.hypot(R.x, R.z), rz = R.z / Math.hypot(R.x, R.z);
  for (const e of query(world, [Player, Character, Transform, Animator])) {
    if (getComponent(world, e, Character).model !== 'sprite') continue;
    const t = getComponent(world, e, Transform);
    const a = getComponent(world, e, Animator);
    const fx = Math.sin(t.rotY), fz = Math.cos(t.rotY);
    const side = fx * rx + fz * rz, away = fx * rz - fz * rx;   // along the camera's right / forward
    const row = Math.abs(side) > Math.abs(away) ? (side > 0 ? 2 : 1) : (away > 0 ? 3 : 0);
    const walking = a.clip === 'walk' || a.clip === 'run';
    const col = walking ? Math.floor((a.time / CLIPS[a.clip].length) * SPRITE.steps) % SPRITE.steps : SPRITE.idle;
    gpu.charSprite.uniforms.uCell.value.set(col, row);
  }
}

export function rigPoseSystem(world) {
  const todo = new Set([...changed(world, Pose), ...added(world, SceneObject)]);
  for (const e of todo) {
    const rig = getComponent(world, e, SceneObject)?.rig;
    if (rig && hasComponent(world, e, Pose)) applyPose(rig, getComponent(world, e, Pose));
  }
}
