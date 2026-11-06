// Camera: arrows, following the player, idle walk; then pixel snapping.
// (Zoom is the settings panel's slider, see editor.js.)
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { CameraRig, OrthoView, Player, Transform } from '../components.js';
import { Input, Settings, Viewport, Time, Editor, Gpu } from '../resources.js';

export function cameraControlSystem(world) {
  const input = getResource(world, Input);
  const settings = getResource(world, Settings);
  const vp = getResource(world, Viewport);
  const time = getResource(world, Time);
  const editor = getResource(world, Editor);
  const { R, groundFwd } = settings.basis;
  const rig = getComponent(world, query(world, [CameraRig])[0], CameraRig);
  const target = new THREE.Vector3(...rig.target);
  const player = query(world, [Player, Transform])[0];

  // character views while playing: the top-view target stays on the player,
  // so the top view is centred on it when the editor opens
  if (rig.mode !== 'top' && player && !editor.active) {
    const t = getComponent(world, player, Transform);
    rig.target = [t.x, target.y, t.z];
    return;
  }

  // arrows move the camera away from the player; once it walks, the camera follows it again
  const keys = input.keys;
  const mv = new THREE.Vector3();
  if (keys.has('arrowup')) mv.add(groundFwd);
  if (keys.has('arrowdown')) mv.sub(groundFwd);
  if (keys.has('arrowright')) mv.add(R);
  if (keys.has('arrowleft')) mv.sub(R);
  if (player && !editor.active && getComponent(world, player, Player).moving) rig.follow = true;
  if (mv.lengthSq() > 0) {
    rig.follow = false;
    target.addScaledVector(mv.normalize(), 3.2 * time.dt * Math.max(1, 4 / vp.scale));
    rig.lastInput = time.now;
  } else if (player && rig.follow) {
    const t = getComponent(world, player, Transform);
    target.x = t.x;
    target.z = t.z;
  } else if (!player && settings.layout !== 'blender' && !settings.freeze && !editor.active && time.now - rig.lastInput > 5000) {
    // slow idle walk; turn back towards the centre near the edges
    const dt = time.dt;
    rig.driftPhase += dt * 0.05;
    const toC = Math.atan2(-target.z, -target.x);
    const edge = Math.max(Math.abs(target.x), Math.abs(target.z)) > settings.walkLimit - 2;
    if (edge) rig.driftPhase += Math.sign(Math.sin(toC - rig.driftPhase)) * dt * 0.6;
    target.x += Math.cos(rig.driftPhase) * 0.45 * dt;
    target.z += Math.sin(rig.driftPhase) * 0.45 * dt;
  }
  if (settings.layout !== 'blender') {
    const l = editor.active ? settings.half : settings.walkLimit;
    target.x = THREE.MathUtils.clamp(target.x, -l, l);
    target.z = THREE.MathUtils.clamp(target.z, -l, l);
  }
  rig.target = target.toArray();
}

// snap the camera to the pixel grid; the blit pass shifts by the error
export function cameraSnapSystem(world) {
  const settings = getResource(world, Settings);
  const gpu = getResource(world, Gpu);
  const { R, U, F } = settings.basis;
  const e = query(world, [CameraRig, OrthoView])[0];
  const rig = getComponent(world, e, CameraRig);
  const camera = getComponent(world, e, OrthoView).camera;
  const p = new THREE.Vector3(...rig.target).addScaledVector(F, -45);
  const tex = 1 / (getResource(world, Viewport).ppu || settings.ppu);   // one frame pixel at this zoom
  const r = p.dot(R), u = p.dot(U), f = p.dot(F);
  const rs = Math.round(r / tex) * tex, us = Math.round(u / tex) * tex;
  camera.position.set(0, 0, 0).addScaledVector(R, rs).addScaledVector(U, us).addScaledVector(F, f);
  camera.updateMatrixWorld();
  rig.snap = [(r - rs) / tex, (u - us) / tex];
}
