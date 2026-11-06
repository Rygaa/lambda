// Picks the camera drawn this frame and feeds the matching uniforms.
//   top view, or any view while editing: the pixel-snapped orthographic camera
//   first person while playing: a perspective camera at the player's eyes
//   third person while playing: the same perspective camera, behind the player's back
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { CameraRig, OrthoView, PerspView, Player, Transform, SceneObject, Prop } from '../components.js';
import { Gpu, Editor, Settings, ActiveView, Viewport, BlockGrid, Time, Assets } from '../resources.js';
import { FPS, THIRD } from '../prefabs/player.js';
import { blockedAbove } from '../lib/footprints.js';
import { heightAt } from '../gen/terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

// third person: the camera looks at a point above the player that trails it a
// little; it sits `distance` behind that point, along the view direction, and
// comes nearer when a blocker taller than the camera line stands in between
function placeBehind(persp, rig, t, grid, dt) {
  const k = rig.focus ? 1 - Math.exp(-dt * THIRD.follow) : 1;
  const y = heightAt(grid.ground, t.x, t.z) + THIRD.lookAt;
  const f = rig.focus || [t.x, y, t.z];
  f[0] += (t.x - f[0]) * k;
  f[1] += (y - f[1]) * k;
  f[2] += (t.z - f[2]) * k;
  rig.focus = f;
  const back = new THREE.Vector3(0, 0, 1).applyEuler(persp.rotation);     // from the focus to the camera
  let d = rig.distance;
  for (let s = 0.3; s < rig.distance; s += 0.1) {
    const x = f[0] + back.x * s, y = f[1] + back.y * s, z = f[2] + back.z * s;
    if (blockedAbove(grid, x, z, y)) { d = Math.max(0.3, s - 0.25); break; }
  }
  persp.position.set(f[0], f[1], f[2]).addScaledVector(back, d);
}

// third person: crowns (gen/registry.js) between the camera and the player
// are hidden, so the player stays in sight; everything else is shown
function seeThroughCrowns(world, from, to) {
  const sets = getResource(world, Assets).shapes.sets;
  const seg = new THREE.Line3(from, to), c = new THREE.Vector3(), q = new THREE.Vector3();
  for (const e of query(world, [Prop, Transform, SceneObject])) {
    const prop = getComponent(world, e, Prop);
    const crown = sets.get(prop.set).shapes[prop.variant].crown;
    if (!crown) continue;
    const t = getComponent(world, e, Transform);
    const hide = !!to && seg.closestPointToPoint(c.set(t.x, crown.y, t.z), true, q).distanceTo(c) < crown.r;
    for (const m of getComponent(world, e, SceneObject).meshes)
      if (m.role === 'canopy' || m.role === 'leaves') { if (hide) m.mesh.layers.disable(0); else m.mesh.layers.enable(0); }
  }
}

export function viewSystem(world) {
  const gpu = getResource(world, Gpu);
  const editor = getResource(world, Editor);
  const settings = getResource(world, Settings);
  const { basis, ppu } = settings;
  const view = getResource(world, ActiveView);
  const cam = query(world, [CameraRig, OrthoView, PerspView])[0];
  const rig = getComponent(world, cam, CameraRig);
  const ortho = getComponent(world, cam, OrthoView).camera;
  const player = query(world, [Player, Transform, SceneObject])[0];
  const playing = !editor.active && !!player;
  const fps = rig.mode === 'fps' && playing;
  const third = rig.mode === 'third' && playing;
  const u = gpu.post.uniforms, shared = gpu.shared;

  if (fps || third) {
    const p = getComponent(world, player, Player);
    const t = getComponent(world, player, Transform);
    const persp = getComponent(world, cam, PerspView).camera;
    const vp = getResource(world, Viewport);
    persp.rotation.set(p.pitch, p.yaw, 0);
    if (fps) persp.position.set(t.x, FPS.eye + heightAt(settings.land.terrain, t.x, t.z), t.z);
    else placeBehind(persp, rig, t, getResource(world, BlockGrid), getResource(world, Time).dt);
    persp.updateMatrixWorld();
    const e = persp.matrixWorld.elements;
    const R = new THREE.Vector3(e[0], e[1], e[2]), U = new THREE.Vector3(e[4], e[5], e[6]);
    const F = new THREE.Vector3(-e[8], -e[9], -e[10]);
    u.uViewR.value.copy(R); u.uViewU.value.copy(U); u.uViewF.value.copy(F);
    u.uCamPos.value.copy(persp.position);
    u.uPersp.value = 1;
    u.uRaySteps.value = FPS.raySteps;
    const ty = Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2);
    u.uTanHalf.value.set(ty * persp.aspect, ty);
    u.uFog.value.set(...settings.fpsFog);
    // pixels sit on the surfaces: one surface pixel = one top-view pixel
    shared.uTexel.value = 1 / ppu;
    shared.uPxAngle.value = 2 * ty / (vp.h + 2);
    shared.uLineWorld.value = FPS.lineWorld;
    shared.uLineMax.value = settings.fpsLines * (window.devicePixelRatio || 1);
    // grass and flowers stand upright facing you
    shared.uCamR.value.copy(R.setY(0).normalize());
    shared.uCamU.value.copy(UP);
    shared.uNearCull.value = fps ? FPS.nearCull : THIRD.nearCull;
    gpu.blit.uniforms.uOffset.value.set(0, 0);
    gpu.blit.uniforms.uSoftK.value = shared.uTexel.value / shared.uPxAngle.value;
    // quarter-resolution god rays
    gpu.rayRT.setSize(Math.ceil((vp.w + 2) / FPS.rayScale), Math.ceil((vp.h + 2) / FPS.rayScale));
    view.camera = persp;
  } else {
    u.uViewR.value.copy(basis.R); u.uViewU.value.copy(basis.U); u.uViewF.value.copy(basis.F);
    u.uCamPos.value.copy(ortho.position);
    u.uPersp.value = 0;
    u.uRaySteps.value = 48;
    shared.uCamR.value.copy(basis.R);
    shared.uCamU.value.copy(basis.U);
    shared.uNearCull.value = 0;
    shared.uTexel.value = 0;
    gpu.blit.uniforms.uOffset.value.set(rig.snap[0], rig.snap[1]);
    gpu.blit.uniforms.uSoftK.value = 0;
    view.camera = ortho;
  }
  view.persp = fps || third;
  if (!third) rig.focus = null;
  if (third || rig.crownsHidden) {
    seeThroughCrowns(world, view.camera.position, third ? new THREE.Vector3(...rig.focus) : null);
    rig.crownsHidden = third;
  }

  // you do not see your own character from inside it (it still casts a shadow);
  // in the top view a model with textured copies (3d_new) is drawn by those,
  // at full resolution (systems/render.js), not in the low-res frame
  if (player) {
    const so = getComponent(world, player, SceneObject);
    const hide = fps || (!view.persp && so.rig?.screen?.length > 0);
    for (const m of so.meshes) {
      if (hide) m.mesh.layers.disable(0); else m.mesh.layers.enable(0);
    }
  }
}
