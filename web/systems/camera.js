// Camera: arrows move it, the wheel zooms, else a slow idle walk; then pixel snapping.
// With the human (systems/player.js), the arrows move the human and the camera follows it.
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { CameraRig, OrthoView, Player } from '../components.js';
import { Input, Settings, Viewport, Time, Gpu } from '../resources.js';
import { ZOOM_STEP } from './viewport.js';

export function cameraControlSystem(world) {
  const input = getResource(world, Input);
  const settings = getResource(world, Settings);
  const vp = getResource(world, Viewport);
  const time = getResource(world, Time);
  const { R, groundFwd } = settings.basis;
  const rig = getComponent(world, query(world, [CameraRig])[0], CameraRig);
  const target = new THREE.Vector3(...rig.target);

  // the wheel: one zoom step per notch (the viewport system keeps it in range)
  for (const { dy } of input.wheel) {
    if (!dy || settings.fixed) continue;
    vp.zoom -= Math.sign(dy) * ZOOM_STEP;
    vp.dirty = true;
  }

  const keys = query(world, [Player]).length ? new Set() : input.keys;
  const mv = new THREE.Vector3();
  if (keys.has('arrowup')) mv.add(groundFwd);
  if (keys.has('arrowdown')) mv.sub(groundFwd);
  if (keys.has('arrowright')) mv.add(R);
  if (keys.has('arrowleft')) mv.sub(R);
  if (mv.lengthSq() > 0) {
    rig.follow = false;
    target.addScaledVector(mv.normalize(), 3.2 * time.dt * Math.max(1, 4 / vp.scale));
    rig.lastInput = time.now;
  } else if (rig.follow && !query(world, [Player]).length && !settings.freeze && time.now - rig.lastInput > 5000) {
    // slow idle walk; turn back towards the centre near the edges
    const dt = time.dt;
    rig.driftPhase += dt * 0.05;
    const toC = Math.atan2(-target.z, -target.x);
    const edge = Math.max(Math.abs(target.x), Math.abs(target.z)) > settings.walkLimit - 2;
    if (edge) rig.driftPhase += Math.sign(Math.sin(toC - rig.driftPhase)) * dt * 0.6;
    target.x += Math.cos(rig.driftPhase) * 0.45 * dt;
    target.z += Math.sin(rig.driftPhase) * 0.45 * dt;
  }
  const l = settings.walkLimit;
  target.x = THREE.MathUtils.clamp(target.x, -l, l);
  target.z = THREE.MathUtils.clamp(target.z, -l, l);
  rig.target = target.toArray();
}

// snap the camera to the pixel grid; the blit pass shifts by the error
export function cameraSnapSystem(world) {
  const settings = getResource(world, Settings);
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
