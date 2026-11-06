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

  const view = getResource(world, ActiveView);
  renderer.setClearColor(0x000000, 0);
  if (gpu.reflect.on) reflectionPass(gpu, camera, view.persp);
  if (view.persp) {
    renderer.setRenderTarget(gpu.gbuf);
    renderer.clear(true, true, false);
    renderer.render(gpu.scene, camera);
  } else {
    // top view: 3x3 samples per pixel, then one sample per pixel (thin lit
    // ledges stay whole lines, see RESOLVE_FRAG)
    renderer.setRenderTarget(gpu.gbufSS);
    renderer.clear(true, true, false);
    renderer.render(gpu.scene, camera);
    const r = gpu.resolve.uniforms;
    r.tData.value = gpu.gbufSS.textures[0];
    r.tNorm.value = gpu.gbufSS.textures[1];
    r.tStep.value = gpu.gbufSS.textures[2];
    renderer.setRenderTarget(gpu.gbuf);
    renderer.render(gpu.resolveScene, gpu.fsCam);
  }
  if (view.persp) {
    // first person: god rays at a quarter of the resolution
    gpu.rays.uniforms.tNorm.value = gpu.gbuf.textures[1];
    renderer.setRenderTarget(gpu.rayRT);
    renderer.render(gpu.raysScene, gpu.fsCam);
    gpu.post.uniforms.tRay.value = gpu.rayRT.texture;
  }

  gpu.post.uniforms.uTime.value = time.sceneTime;
  gpu.post.uniforms.tData.value = gpu.gbuf.textures[0];
  gpu.post.uniforms.tNorm.value = gpu.gbuf.textures[1];
  gpu.post.uniforms.tStep.value = gpu.gbuf.textures[2];
  renderer.setRenderTarget(gpu.finalRT);
  renderer.render(gpu.postScene, gpu.fsCam);
  gpu.charSprite.uniforms.tNorm.value = gpu.gbuf.textures[1];
  renderer.render(gpu.spriteScene, camera);
  renderer.render(gpu.dustScene, camera);

  gpu.blit.uniforms.tFinal.value = gpu.finalRT.texture;
  gpu.blit.uniforms.tNorm.value = gpu.gbuf.textures[1];
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, false, false);
  renderer.render(gpu.blitScene, gpu.fsCam);
  if (!view.persp) screenCharPass(gpu, camera);
}

// Top view: the 3d_new character (layer 3) straight onto the screen at full
// resolution, in a viewport that lines up with the upscaled low-res frame
const SIZE = new THREE.Vector2();
function screenCharPass(gpu, camera) {
  const { renderer, blit } = gpu;
  const u = blit.uniforms, s = u.uScale.value;
  renderer.getSize(SIZE);
  renderer.setViewport(u.uMargin.value.x - (1 + u.uOffset.value.x) * s, u.uMargin.value.y - (1 + u.uOffset.value.y) * s,
    gpu.gbuf.width * s, gpu.gbuf.height * s);
  renderer.clear(false, true, false);
  const mask = camera.layers.mask;
  camera.layers.set(3);
  renderer.render(gpu.scene, camera);
  camera.layers.mask = mask;
  renderer.setViewport(0, 0, SIZE.x, SIZE.y);
}

// Water (the article's planar reflections): the scene drawn again into a
// second G-buffer by the camera mirrored in the water plane y = 0. It is the
// mirror image turned upright, so faces keep their winding; nothing under the
// plane is drawn (uClipY). The top view's mirrored pixels are the screen
// pixels flipped, so reflections stay on the pixel grid.
const MIRROR = new THREE.Matrix4().makeScale(1, -1, 1);

function reflectionPass(gpu, camera, persp) {
  const { renderer, reflect, shared } = gpu;
  const m = persp ? reflect.persp : reflect.ortho;
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
