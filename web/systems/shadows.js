// The static sun shadow map. The shadows of the world (layer 1) are drawn into their own map when shadow casters come,
// go or move; the bodies (the human and the monsters, layer 3) move at almost every frame, so they are drawn alone on
// a copy of that map, and the world is not drawn again for them.
import { added, removed, changed, hasComponent, getResource } from '../ecs/world.js';
import { ShadowCaster, SceneObject, Transform } from '../components.js';
import { Gpu } from '../resources.js';
import * as THREE from 'three';

const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export function shadowSystem(world) {
  const gpu = getResource(world, Gpu);
  const changedCasters = added(world, SceneObject).some((e) => hasComponent(world, e, ShadowCaster)) ||
    removed(world, ShadowCaster).length > 0 ||
    changed(world, Transform).some((e) => hasComponent(world, e, ShadowCaster));
  const worldDirty = changedCasters || gpu.shadowsDirty;
  if (!worldDirty && !gpu.bodiesDirty) return;
  const { rt, cam, mat, worldRT, bodyCam, copyScene } = gpu.shadow, r = gpu.renderer;
  gpu.scene.overrideMaterial = mat;
  if (worldDirty) {
    r.setRenderTarget(worldRT);
    r.clear(true, true, false);
    r.render(gpu.scene, cam);
  }
  r.setRenderTarget(rt);
  r.clear(true, true, false);
  r.render(copyScene, copyCam);
  r.render(gpu.scene, bodyCam);
  gpu.scene.overrideMaterial = null;
  gpu.shadowsDirty = false;
  gpu.bodiesDirty = false;
}
