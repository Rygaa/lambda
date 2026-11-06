// Feeds the top-view camera's uniforms: the pixel-snapped orthographic camera.
import { query, getComponent, getResource } from '../ecs/world.js';
import { CameraRig, OrthoView } from '../components.js';
import { Gpu, Settings, ActiveView } from '../resources.js';

export function viewSystem(world) {
  const gpu = getResource(world, Gpu);
  const { basis } = getResource(world, Settings);
  const view = getResource(world, ActiveView);
  const cam = query(world, [CameraRig, OrthoView])[0];
  const rig = getComponent(world, cam, CameraRig);
  const ortho = getComponent(world, cam, OrthoView).camera;
  const u = gpu.post.uniforms;
  u.uViewR.value.copy(basis.R); u.uViewU.value.copy(basis.U); u.uViewF.value.copy(basis.F);
  u.uCamPos.value.copy(ortho.position);
  gpu.shared.uCamR.value.copy(basis.R);
  gpu.shared.uCamU.value.copy(basis.U);
  gpu.blit.uniforms.uOffset.value.set(rig.snap[0], rig.snap[1]);
  view.camera = ortho;
}
