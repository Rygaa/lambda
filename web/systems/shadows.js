// Redraws the static sun shadow map when shadow casters come, go or move.
import { added, removed, changed, hasComponent, getResource } from '../ecs/world.js';
import { ShadowCaster, SceneObject, Transform } from '../components.js';
import { Gpu } from '../resources.js';

export function shadowSystem(world) {
  const gpu = getResource(world, Gpu);
  const changedCasters = added(world, SceneObject).some((e) => hasComponent(world, e, ShadowCaster)) ||
    removed(world, ShadowCaster).length > 0 ||
    changed(world, Transform).some((e) => hasComponent(world, e, ShadowCaster));
  if (!changedCasters && !gpu.shadowsDirty) return;
  const { rt, cam, mat } = gpu.shadow;
  gpu.scene.overrideMaterial = mat;
  gpu.renderer.setRenderTarget(rt);
  gpu.renderer.clear(true, true, false);
  gpu.renderer.render(gpu.scene, cam);
  gpu.scene.overrideMaterial = null;
  gpu.shadowsDirty = false;
}
