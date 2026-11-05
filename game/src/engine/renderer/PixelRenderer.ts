import * as THREE from "three";
import { CAMERA_FORWARD, PIXEL_SCALE, PIXELS_PER_METER } from "./constants.ts";
import { createGroundCover, type GroundCoverOptions } from "./groundCover.ts";
import { createSharedUniforms, Materials, shaderMaterial } from "./materials.ts";
import * as S from "./shaders.ts";

export type PixelRendererOptions = {
  pixelScale?: number;
  // Half the size in meters of the square the sun shadow covers around the target.
  shadowRadius?: number;
  // Clouds drift over the ground and cast soft shadows.
  clouds?: boolean;
};

// Objects on this layer cast sun shadows. Grass and the ground do not.
export const SHADOW_LAYER = 1;
const CLOUD_WIND = new THREE.Vector2(0.16, 0.05);
const CAMERA_DISTANCE = 45;

// Draws a scene like pixel-scene (top view):
// 1. The sun shadow map.
// 2. The scene into a G-buffer at 3×3 samples per game pixel, then resolved to 1 sample.
// 3. The post pass: flat color bands, 1px outlines, water, god rays.
// 4. Dust in the light beams. CSS scales the small canvas up with sharp pixels.
// The camera snaps to the pixel grid and CSS moves the canvas back by the snap error,
// so the view moves smoothly and pixels do not creep. The canvas has 1 spare pixel per side.
export class PixelRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  readonly canvas: HTMLCanvasElement;
  readonly materials: Materials;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly shared = createSharedUniforms();
  private readonly gbufferSamples: THREE.WebGLRenderTarget;
  private readonly gbuffer: THREE.WebGLRenderTarget;
  private readonly shadowTarget: THREE.WebGLRenderTarget;
  private readonly shadowCamera = new THREE.OrthographicCamera();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide, colorWrite: false });
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly resolve: THREE.ShaderMaterial;
  private readonly post: THREE.ShaderMaterial;
  private readonly resolveScene: THREE.Scene;
  private readonly postScene: THREE.Scene;
  private readonly dustScene = new THREE.Scene();
  private readonly dust: THREE.ShaderMaterial;
  private readonly forward = new THREE.Vector3(...CAMERA_FORWARD).normalize();
  private readonly right: THREE.Vector3;
  private readonly up: THREE.Vector3;
  private readonly target = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly frameListeners = new Set<(seconds: number) => void>();
  private pixelScale: number;
  private shadowRadius: number;
  private clouds: boolean;
  private width = 1;
  private height = 1;
  private lastTime = 0;
  private sceneTime = 0;

  constructor(
    private readonly container: HTMLElement,
    options: PixelRendererOptions = {},
  ) {
    this.pixelScale = options.pixelScale ?? PIXEL_SCALE;
    this.shadowRadius = options.shadowRadius ?? 30;
    this.clouds = options.clouds ?? true;
    this.right = new THREE.Vector3().crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    this.up = new THREE.Vector3().crossVectors(this.right, this.forward).normalize();

    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement;
    this.canvas.style.position = "absolute";
    this.canvas.style.imageRendering = "pixelated";
    this.container.style.position = "relative";
    this.container.style.overflow = "hidden";
    this.container.appendChild(this.canvas);
    this.materials = new Materials(this.shared);

    const floatTargets = this.renderer.extensions.has("EXT_color_buffer_float");
    const targetOptions = {
      type: floatTargets ? THREE.FloatType : THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      count: 3,
    };
    this.gbufferSamples = new THREE.WebGLRenderTarget(3, 3, targetOptions);
    this.gbuffer = new THREE.WebGLRenderTarget(1, 1, targetOptions);

    const shadowSize = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    this.shadowTarget = new THREE.WebGLRenderTarget(shadowSize, shadowSize, { depthBuffer: true });
    this.shadowTarget.depthTexture = new THREE.DepthTexture(shadowSize, shadowSize);
    this.shadowTarget.depthTexture.minFilter = this.shadowTarget.depthTexture.magFilter = THREE.NearestFilter;
    this.shadowCamera.layers.set(SHADOW_LAYER);
    this.shared.uShadowMap.value = this.shadowTarget.depthTexture;
    this.shared.uShadowTexel.value = 1 / shadowSize;
    if (!this.clouds) this.shared.uCloudLo.value = this.shared.uCloudHi.value = 10;

    this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.right, this.up, this.forward.clone().negate()));
    this.camera.layers.set(0);

    const quad = new THREE.PlaneGeometry(2, 2);
    const screen = { depthTest: false, depthWrite: false };
    this.resolve = shaderMaterial(this.shared, S.FS_VERT, S.RESOLVE_FRAG, {
      tData: { value: this.gbufferSamples.textures[0] },
      tNorm: { value: this.gbufferSamples.textures[1] },
      tAlb: { value: this.gbufferSamples.textures[2] },
    }, screen);
    this.post = shaderMaterial(this.shared, S.FS_VERT, S.POST_FRAG, {
      tData: { value: this.gbuffer.textures[0] },
      tNorm: { value: this.gbuffer.textures[1] },
      tAlb: { value: this.gbuffer.textures[2] },
      uRes: { value: new THREE.Vector2() },
      uCamPos: { value: new THREE.Vector3() },
      uViewR: { value: this.right },
      uViewU: { value: this.up },
      uViewF: { value: this.forward },
      uHalf: { value: new THREE.Vector2() },
      uVolTop: { value: 7.6 },
      uRayK: { value: 0.06 },
      uRayBias: { value: 3.56 },
      uRaySteps: { value: 48 },
    }, screen);
    this.resolveScene = new THREE.Scene().add(new THREE.Mesh(quad, this.resolve));
    this.postScene = new THREE.Scene().add(new THREE.Mesh(quad, this.post));
    this.dust = shaderMaterial(this.shared, S.DUST_VERT, S.DUST_FRAG, {
      uTime: { value: 0 },
      uBoxMin: { value: new THREE.Vector3() },
      uBoxSize: { value: new THREE.Vector3(30, 4.5, 30) },
      tNorm: { value: this.gbuffer.textures[1] },
    }, { depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
    this.dustScene.add(this.createDust());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  // The point the camera looks at, in meters.
  setTarget(point: THREE.Vector3Like) {
    this.target.set(point.x, point.y, point.z);
  }

  getTarget() {
    return this.target.clone();
  }

  setPixelScale(scale: number) {
    this.pixelScale = Math.max(1, Math.round(scale));
    this.resize();
  }

  setShadowRadius(radius: number) {
    this.shadowRadius = radius;
  }

  // Grass and flowers over an area, in the colors of the ground under them.
  createGroundCover(options: GroundCoverOptions) {
    return createGroundCover(this.shared, options);
  }

  // Puts an object on the shadow layer, so it casts sun shadows.
  castShadows(object: THREE.Object3D) {
    object.traverse((child) => child.layers.enable(SHADOW_LAYER));
    return object;
  }

  // Runs before each frame with the seconds since the last frame.
  onFrame(listener: (seconds: number) => void) {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  // A PNG of the game pixels, with no CSS scale.
  async capture() {
    this.render();
    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The view could not be saved as an image.");
    return blob;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.gbufferSamples.dispose();
    this.gbuffer.dispose();
    this.shadowTarget.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // 3000 motes in a box that follows the camera; each wraps around inside it.
  private createDust() {
    const positions = new Float32Array(3000 * 3);
    for (let index = 0; index < positions.length; index++) positions[index] = Math.random() * 30;
    const points = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3)), this.dust);
    points.frustumCulled = false;
    return points;
  }

  private resize() {
    const scale = this.pixelScale;
    this.width = Math.max(1, Math.ceil(this.container.clientWidth / scale)) + 2;
    this.height = Math.max(1, Math.ceil(this.container.clientHeight / scale)) + 2;
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width * scale}px`;
    this.canvas.style.height = `${this.height * scale}px`;
    this.gbufferSamples.setSize(this.width * 3, this.height * 3);
    this.gbuffer.setSize(this.width, this.height);
    this.post.uniforms.uRes!.value.set(this.width, this.height);

    const halfWidth = this.width / 2 / PIXELS_PER_METER;
    const halfHeight = this.height / 2 / PIXELS_PER_METER;
    Object.assign(this.camera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight, near: 0.5, far: 200 });
    this.camera.updateProjectionMatrix();
    this.post.uniforms.uHalf!.value.set(halfWidth, halfHeight);
  }

  private frame(time: number) {
    const seconds = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = time;
    this.sceneTime += seconds;
    if (this.clouds) this.shared.uCloudOffset.value.addScaledVector(CLOUD_WIND, seconds);
    for (const listener of this.frameListeners) listener(seconds);
    this.render();
  }

  private render() {
    const error = this.placeCamera();
    const renderer = this.renderer;
    renderer.setClearColor(0x000000, 0);

    this.scene.overrideMaterial = this.shadowMaterial;
    renderer.setRenderTarget(this.shadowTarget);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.shadowCamera);
    this.scene.overrideMaterial = null;

    renderer.setRenderTarget(this.gbufferSamples);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.gbuffer);
    renderer.render(this.resolveScene, this.screenCamera);

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    this.post.uniforms.uCamPos!.value.copy(this.camera.position);
    renderer.render(this.postScene, this.screenCamera);
    this.dust.uniforms.uTime!.value = this.sceneTime;
    this.dust.uniforms.uBoxMin!.value.set(this.target.x - 15, 0.15, this.target.z - 15);
    renderer.render(this.dustScene, this.camera);

    // The image is moved back by the snap error. One spare pixel sits on each side.
    const scale = this.pixelScale;
    this.canvas.style.left = `${-scale - error.x * scale}px`;
    this.canvas.style.top = `${-scale + error.y * scale}px`;
  }

  // Puts the camera on the pixel grid and returns the snap error in game pixels.
  private placeCamera() {
    const onRight = this.target.dot(this.right) * PIXELS_PER_METER;
    const onUp = this.target.dot(this.up) * PIXELS_PER_METER;
    const error = { x: onRight - Math.round(onRight), y: onUp - Math.round(onUp) };
    const snapped = this.target
      .clone()
      .addScaledVector(this.right, -error.x / PIXELS_PER_METER)
      .addScaledVector(this.up, -error.y / PIXELS_PER_METER);
    this.camera.position.copy(snapped).addScaledVector(this.forward, -CAMERA_DISTANCE);
    this.camera.updateMatrixWorld();

    // The shadow box moves in whole meters, so shadows do not swim.
    const center = new THREE.Vector3(Math.round(this.target.x), 0, Math.round(this.target.z));
    const radius = this.shadowRadius;
    Object.assign(this.shadowCamera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: 240 });
    this.shadowCamera.updateProjectionMatrix();
    this.shadowCamera.position.copy(center).addScaledVector(this.shared.uSunL.value, 120);
    this.shadowCamera.lookAt(center);
    this.shadowCamera.updateMatrixWorld();
    this.shared.uShadowMatrix.value.multiplyMatrices(this.shadowCamera.projectionMatrix, this.shadowCamera.matrixWorldInverse);
    return error;
  }
}
