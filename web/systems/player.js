// Walks the player's character while the scene is not paused.
//   top view:      WASD (the arrows move the camera)
//   third person:  WASD / arrows relative to the camera; mouse turns the camera
//   first person:  WASD / arrows relative to where you look; mouse to look
//   shift runs; it stands still while it attacks or holds up its shield
import * as THREE from 'three';
import { query, getComponent, markChanged, getResource } from '../ecs/world.js';
import { Player, Transform, CameraRig, Animator } from '../components.js';
import { Input, Settings, Time, BlockGrid } from '../resources.js';
import { slide } from '../lib/footprints.js';
import { FPS, THIRD } from '../prefabs/player.js';
import { RUN_SPEED } from '../prefabs/character.js';

export function playerMoveSystem(world) {
  const time = getResource(world, Time);
  if (time.paused) return;
  const input = getResource(world, Input);
  const settings = getResource(world, Settings);
  const grid = getResource(world, BlockGrid);
  const { R, groundFwd } = settings.basis;
  const mode = getComponent(world, query(world, [CameraRig])[0], CameraRig).mode;
  const keys = input.keys;
  const arrows = mode !== 'top';
  const fps = mode === 'fps';
  const look = fps || mode === 'third';     // the mouse turns the view

  for (const e of query(world, [Player, Transform])) {
    const p = getComponent(world, e, Player);
    const t = getComponent(world, e, Transform);
    let fwd = groundFwd, right = R;
    if (look) {
      // mouse look: locked pointer, or drag when it is not locked
      const dx = input.lookDelta[0] * FPS.look + input.dragDelta[0] * FPS.dragLook;
      const dy = input.lookDelta[1] * FPS.look + input.dragDelta[1] * FPS.dragLook;
      const [lo, hi] = fps ? [-1.3, 1.3] : THIRD.pitch;
      p.yaw -= dx;
      p.pitch = THREE.MathUtils.clamp(p.pitch - dy, lo, hi);
      if (fps && (dx || dy)) {
        t.rotY = p.yaw;
        markChanged(world, e, Transform);
      }
      fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    }
    p.moving = false;
    p.running = keys.has('shift');
    const anim = getComponent(world, e, Animator);
    if (anim && (anim.clip === 'attack' || anim.guard > 0)) continue;
    const mv = new THREE.Vector3();
    if (keys.has('w') || (arrows && keys.has('arrowup'))) mv.add(fwd);
    if (keys.has('s') || (arrows && keys.has('arrowdown'))) mv.sub(fwd);
    if (keys.has('d') || (arrows && keys.has('arrowright'))) mv.add(right);
    if (keys.has('a') || (arrows && keys.has('arrowleft'))) mv.sub(right);
    if (mv.lengthSq() === 0) continue;
    mv.normalize().multiplyScalar((p.running ? RUN_SPEED : p.speed) * time.dt);
    // slide along stones: try both axes, then each one alone
    const lim = settings.edgeLimit;
    const clampXZ = (v) => THREE.MathUtils.clamp(v, -lim, lim);
    const [nx, nz] = slide(grid, t.x, t.z, clampXZ(t.x + mv.x), clampXZ(t.z + mv.z), p.radius);
    if (nx === t.x && nz === t.z) continue;
    if (!fps) t.rotY = Math.atan2(nx - t.x, nz - t.z);     // face where it walks
    t.x = nx;
    t.z = nz;
    p.moving = true;
    markChanged(world, e, Transform);
  }
}
