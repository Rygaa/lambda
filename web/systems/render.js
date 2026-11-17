// G-buffer (+ the mirrored one for water) -> post (palette, outlines, water,
// god rays) -> dust -> upscale to screen.
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { DustField, SceneObject } from '../components.js';
import { Gpu, Time, ActiveView } from '../resources.js';

export function renderSystem(world) {
  const gpu = getResource(world, Gpu);
  const time = getResource(world, Time);
  const { renderer } = gpu;
  const camera = getResource(world, ActiveView).camera;
  for (const e of query(world, [DustField, SceneObject])) {
    const u = getComponent(world, e, SceneObject).group.material.uniforms;
    u.uTime.value = time.sceneTime;
    u.tNorm.value = gpu.gbuf.textures[1];
  }

  renderer.setClearColor(0x000000, 0);
  if (gpu.reflect.on) reflectionPass(gpu, camera);
  // 3x3 samples per pixel, then one sample per pixel (thin lit ledges stay
  // whole lines, see RESOLVE_FRAG)
  renderer.setRenderTarget(gpu.gbufSS);
  renderer.clear(true, true, false);
  renderer.render(gpu.scene, camera);
  const r = gpu.resolve.uniforms;
  r.tData.value = gpu.gbufSS.textures[0];
  r.tNorm.value = gpu.gbufSS.textures[1];
  renderer.setRenderTarget(gpu.gbuf);
  renderer.render(gpu.resolveScene, gpu.fsCam);

  gpu.post.uniforms.uTime.value = time.sceneTime;
  gpu.post.uniforms.tData.value = gpu.gbuf.textures[0];
  gpu.post.uniforms.tNorm.value = gpu.gbuf.textures[1];
  renderer.setRenderTarget(gpu.finalRT);
  renderer.render(gpu.postScene, gpu.fsCam);
  renderer.render(gpu.dustScene, camera);

  gpu.blit.uniforms.tFinal.value = gpu.finalRT.texture;
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, false, false);
  renderer.render(gpu.blitScene, gpu.fsCam);
  if (gpu.fine) finePass(gpu, camera);
}

// characters at screen pixels on top of the frame (render/shaders.js FINE_VERT, lib/character.js)
function finePass(gpu, camera) {
  const { renderer, fine } = gpu;
  fine.camera.copy(camera, false);
  fine.camera.layers.set(2);
  const u = fine.uniforms;
  u.tNorm.value = gpu.gbuf.textures[1];
  u.uLowSize.value.set(gpu.gbuf.width, gpu.gbuf.height);
  renderer.getDrawingBufferSize(u.uScreen.value);
  renderer.clear(false, true, false);
  renderer.render(gpu.scene, fine.camera);
}

// Water (the article's planar reflections): the scene drawn again into a
// second G-buffer by the camera mirrored in the water plane y = 0. It is the
// mirror image turned upright, so faces keep their winding; nothing under the
// plane is drawn (uClipY). The mirrored pixels are the screen pixels flipped,
// so reflections stay on the pixel grid.
const MIRROR = new THREE.Matrix4().makeScale(1, -1, 1);

function reflectionPass(gpu, camera) {
  const { renderer, reflect, shared } = gpu;
  const m = reflect.camera;
  m.projectionMatrix.copy(camera.projectionMatrix);
  m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  m.matrixWorld.copy(MIRROR).multiply(camera.matrixWorld).multiply(MIRROR);
  m.matrixWorldInverse.copy(m.matrixWorld).invert();
  m.layers.mask = camera.layers.mask;
  for (const o of reflect.skip) o.visible = false;
  shared.uClipY.value = 0;
  renderer.setRenderTarget(reflect.rt);
  renderer.clear(true, true, false);
  renderer.render(gpu.scene, m);
  shared.uClipY.value = -1e4;
  for (const o of reflect.skip) o.visible = true;
  const u = gpu.post.uniforms;
  u.uReflVP.value.multiplyMatrices(m.projectionMatrix, m.matrixWorldInverse);
  u.tRefl.value = reflect.rt.textures[0];
  u.tReflN.value = reflect.rt.textures[1];
}
