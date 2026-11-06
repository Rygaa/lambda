// Window size + zoom -> low-res frame size; resizes targets and the camera.
// Zoom (screen pixels per world pixel, in ZOOM_STEP steps) is split in two: a
// whole upscale, so pixels stay square and sharp, and the camera, which draws
// a little more or less of the world per pixel (vp.ppu) for the steps between.
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { OrthoView, PerspView, CameraRig, Player } from '../components.js';
import { Viewport, Input, Settings, Gpu, Editor } from '../resources.js';
import { SPRITE } from '../prefabs/character.js';

// the zoom slider's step
export const ZOOM_STEP = 0.25;

export function viewportSystem(world) {
  const vp = getResource(world, Viewport);
  const input = getResource(world, Input);
  // first and third person while playing draw at full screen resolution
  const rig = getComponent(world, query(world, [CameraRig])[0], CameraRig);
  const fps = (rig.mode === 'fps' || rig.mode === 'third') && !getResource(world, Editor).active && query(world, [Player]).length > 0;
  if (fps !== vp.fps) vp.dirty = true;
  if (!vp.dirty && !input.resized) return;
  const settings = getResource(world, Settings);
  const gpu = getResource(world, Gpu);
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.floor(innerWidth * dpr), ph = Math.floor(innerHeight * dpr);
  if (!pw || !ph) return;                   // hidden tab: keep the last size
  vp.dirty = false;
  vp.fps = fps;
  const canvas = settings.canvas;
  canvas.width = pw; canvas.height = ph;
  gpu.renderer.setSize(pw, ph, false);
  if (settings.fixed) {
    const s = Math.max(1, Math.floor(Math.min(pw / 480, ph / 270)));
    Object.assign(vp, { w: 480, h: 270, scale: s, ppu: settings.ppu, mx: Math.floor((pw - 480 * s) / 2), my: Math.floor((ph - 270 * s) / 2) });
  } else {
    const base = Math.max(1, Math.round(pw / 480));
    // never show past the grass
    const zMin = Math.max(1, Math.ceil(pw / ((2 * settings.grassHalf - 8) * settings.ppu) / ZOOM_STEP) * ZOOM_STEP);
    vp.zoomMin = zMin - base;
    vp.zoomMax = 12 - base;
    vp.zoom = THREE.MathUtils.clamp(vp.zoom, vp.zoomMin, vp.zoomMax);
    // first person draws at full screen resolution; its pixels sit on the surfaces (see texelCentre)
    const z = base + vp.zoom;
    const s = fps ? 1 : Math.max(1, Math.round(z));
    const ppu = fps ? settings.ppu : settings.ppu * z / s;
    Object.assign(vp, { w: Math.ceil(pw / s), h: Math.ceil(ph / s), scale: s, ppu, mx: 0, my: 0 });
  }
  const W = vp.w + 2, H = vp.h + 2;       // 1px border for the sub-pixel shift
  const ppu = vp.ppu;
  gpu.gbuf.setSize(W, H);
  gpu.reflect.rt.setSize(W, H);
  if (!fps) gpu.gbufSS.setSize(W * 3, H * 3);
  gpu.finalRT.setSize(W, H);
  for (const e of query(world, [OrthoView])) {
    const camera = getComponent(world, e, OrthoView).camera;
    camera.left = -W / 2 / ppu; camera.right = W / 2 / ppu;
    camera.top = H / 2 / ppu; camera.bottom = -H / 2 / ppu;
    camera.updateProjectionMatrix();
  }
  for (const e of query(world, [PerspView])) {
    const camera = getComponent(world, e, PerspView).camera;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  gpu.post.uniforms.uRes.value.set(W, H);
  gpu.post.uniforms.uHalf.value.set(W / 2 / ppu, H / 2 / ppu);
  gpu.blit.uniforms.uScale.value = vp.scale;
  // the sprite character keeps one sheet pixel per frame pixel at every zoom
  gpu.charSprite.uniforms.uSize.value.setScalar(SPRITE.frame / ppu);
  gpu.blit.uniforms.uMargin.value.set(vp.mx, vp.my);
  gpu.blit.uniforms.uLow.value.set(vp.w, vp.h);
}
