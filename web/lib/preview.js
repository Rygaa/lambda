// Pictures of the items and the monsters for the admin menu (systems/admin.js): one small hidden renderer draws each
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

// a function (url, { onHead, clip }) -> Promise of the picture (a data URL)
export function createPreview() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sun);
  const pictures = new Map();
  let last = Promise.resolve(), head = null;

  async function draw(url, { onHead = false, clip = null } = {}) {
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

  return (url, opts) => {
    if (!pictures.has(url)) pictures.set(url, (last = last.then(() => draw(url, opts), () => draw(url, opts))));
    return pictures.get(url);
  };
}
