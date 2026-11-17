// Pictures of the items, the monsters and the objects for the admin menu (systems/admin.js) and the bag: each model has
// a saved PNG file (pictures/<name>.png next to it, made by assets/make-pictures.mjs), so the page loads no 3D model
// for them. A model with no file yet is drawn here, and assets/make-pictures.mjs draws them all the same way: one
// small hidden renderer draws each
// model alone, turned three quarters, lit, and keeps the picture. Clothes are drawn in their rest pose, without the
// body; a cap or a mask that is not skinned is drawn as it sits on the head (onHead); a monster at the start of its
// stand clip (clip). One picture at a time, in the order they are asked for.
import * as THREE from 'three';
import { loader } from './bake.js';

const SIZE = 96;
const VIEW = new THREE.Vector3(0.9, 0.7, 1.6).normalize();   // from the front, a little from the right and above
const HEAD_BONE = THREE.PropertyBinding.sanitizeNodeName('Bip02 Head');
const PARTS = '../assets/character/player/parts/';
// a .glb file and its clips; its textures are in the folder textures/ next to it
const load = (url) => loader(url.replace(/[^/]*$/, 'textures/')).loadAsync(url);

// the saved picture of a model: pictures/<name>.png next to its .glb (made by assets/make-pictures.mjs)
export const pictureOf = (url) => url.replace(/([^/]*)\.glb$/, 'pictures/$1.png');

// a function (url, { onHead, clip }) -> Promise of the picture: its saved PNG file, or, when there is none (a new
// model), the model drawn here (a data URL). saved: false always draws (assets/make-pictures.mjs).
export function createPreview({ saved = true } = {}) {
  let renderer = null;   // made at the first drawing: with the saved pictures, often never
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sun);
  const pictures = new Map();
  let last = Promise.resolve(), head = null;
  const fromFile = (url) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img.src);
    img.onerror = fail;
    img.src = pictureOf(url);
  });

  async function draw(url, { onHead = false, clip = null } = {}) {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(SIZE, SIZE);
    }
    const gltf = await load(url), root = gltf.scene;
    const action = clip && gltf.animations.find((a) => a.name === clip);
    if (action) new THREE.AnimationMixer(root).clipAction(action).play().getMixer().setTime(0);
    let skinned = false;
    root.traverse((o) => { skinned ||= !!o.isSkinnedMesh; });
    if (onHead && !skinned) {
      // the head bone at rest, from the bare head
      head ??= load(PARTS + 'part_malehead01.glb').then(({ scene: h }) => { h.updateMatrixWorld(true); return h.getObjectByName(HEAD_BONE).matrixWorld.clone(); });
      root.applyMatrix4(await head);
    }
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const map = o.material.map, color = map ? 0xffffff : o.material.color;
      o.material.dispose();
      o.material = new THREE.MeshLambertMaterial({ map, color, alphaTest: 0.5, side: THREE.DoubleSide });
      o.frustumCulled = false;
      if (o.isSkinnedMesh) o.skeleton.update();
    });
    const sphere = new THREE.Box3().setFromObject(root, true).getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-3);
    Object.assign(camera, { left: -r, right: r, top: r, bottom: -r, near: 0.01, far: 4 * r });
    camera.position.copy(sphere.center).addScaledVector(VIEW, 2 * r);
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    sun.position.copy(camera.position).add(new THREE.Vector3(0, r, 0));
    scene.add(root);
    renderer.render(scene, camera);
    const picture = renderer.domElement.toDataURL('image/png');
    scene.remove(root);
    root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
    return picture;
  }

  // the drawings one at a time, in the order they are asked for
  const drawn = (url, opts) => (last = last.then(() => draw(url, opts), () => draw(url, opts)));
  return (url, opts) => {
    if (!pictures.has(url)) pictures.set(url, saved ? fromFile(url).catch(() => drawn(url, opts)) : drawn(url, opts));
    return pictures.get(url);
  };
}
