// Pictures of the items for the admin menu (systems/admin.js): one small hidden renderer draws each model of
// assets/character/player/parts alone, turned three quarters, lit, and keeps the picture. Clothes are drawn in their
// rest pose, without the body; a cap or a mask that is not skinned is drawn as it sits on the head (onHead).
// One picture at a time, in the order they are asked for.
import * as THREE from 'three';
import { loader } from './character.js';

const SIZE = 96;
const VIEW = new THREE.Vector3(0.9, 0.7, 1.6).normalize();   // from the front, a little from the right and above
const HEAD_BONE = THREE.PropertyBinding.sanitizeNodeName('Bip02 Head');
const load = async (file) => (await loader().loadAsync(`../assets/character/player/parts/${file}.glb`)).scene;

// a function (file, onHead) -> Promise of the picture (a data URL)
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

  async function draw(file, onHead) {
    const root = await load(file);
    let skinned = false;
    root.traverse((o) => { skinned ||= !!o.isSkinnedMesh; });
    if (onHead && !skinned) {
      // the head bone at rest, from the bare head
      head ??= load('part_malehead01').then((h) => { h.updateMatrixWorld(true); return h.getObjectByName(HEAD_BONE).matrixWorld.clone(); });
      root.applyMatrix4(await head);
    }
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const map = o.material.map;
      o.material.dispose();
      o.material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
      o.frustumCulled = false;
      if (o.isSkinnedMesh) o.skeleton.update();
    });
    const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-3);
    Object.assign(camera, { left: -r, right: r, top: r, bottom: -r, near: 0.01, far: 4 * r });
    camera.position.copy(sphere.center).addScaledVector(VIEW, 2 * r);
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    sun.position.copy(camera.position).add(new THREE.Vector3(0, r, 0));
    scene.add(root);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(root);
    root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
    return url;
  }

  return (file, onHead = false) => {
    if (!pictures.has(file)) pictures.set(file, (last = last.then(() => draw(file, onHead), () => draw(file, onHead))));
    return pictures.get(file);
  };
}
