// The human in the window of the bag (systems/inventory.js): its own small renderer draws the human as it is dressed
// now (the Wardrobe resource: dressed, lib/character.js dress), playing its idle clip, lit from the front, in big
// pixels like the game. A drag turns it. It draws only while the bag is open.
import * as THREE from 'three';

const PX = 2;          // CSS pixels per pixel of the picture
const FPS = 30;        // the frames of the idle clip a second (character.json bakeFps)

// a doll on `canvas` (its CSS size is its size) -> { show (dressed, texture of cubes), draw (dt), turn (radians) }
export function createDoll(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the textures are their bytes as they are (lib/bake.js)
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(24, 1, 0.01, 100), group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  scene.add(group, new THREE.HemisphereLight(0xfff4e0, 0x40504a, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6), rim = new THREE.DirectionalLight(0xb8d86a, 1.4);
  key.position.set(1, 2, 3);
  rim.position.set(-2, 1, -2);
  scene.add(key, rim);
  let meshes = [], frames = null, time = 0, angle = 0.35, size = [0, 0];

  // the human dressed (its idle frames, one geometry per part, and the texture of each part)
  function show(dressed, cubes) {
    for (const m of meshes) { inner.remove(m); m.material.dispose(); }
    frames = dressed?.clips.idle ?? null;
    if (!frames) { meshes = []; return; }
    const textures = dressed.body ? dressed.body.parts.map((p) => p.texture) : frames[0].map(() => cubes);
    meshes = frames[0].map((g, m) => {
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: textures[m], side: THREE.DoubleSide }));
      mesh.frustumCulled = false;
      return mesh;
    });
    inner.add(...meshes);
    // the camera: the whole human, from the front, a little from above
    const box = new THREE.Box3();
    for (const g of frames[0]) { g.computeBoundingBox(); box.union(g.boundingBox); }
    const c = box.getCenter(new THREE.Vector3()), h = box.max.y - box.min.y;
    inner.position.set(-c.x, 0, -c.z);   // it turns about its middle
    const d = (h * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, c.y + h * 0.12, d);
    camera.lookAt(0, c.y - h * 0.02, 0);
  }

  function draw(dt) {
    const w = Math.round(canvas.clientWidth / PX), h = Math.round(canvas.clientHeight / PX);
    if (!w || !h) return;
    if (w !== size[0] || h !== size[1]) {
      size = [w, h];
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (frames) {
      time += dt;
      const frame = frames[Math.floor(time * FPS) % frames.length];
      meshes.forEach((mesh, m) => { mesh.geometry = frame[m]; });
    }
    group.rotation.y = angle;
    renderer.render(scene, camera);
  }

  return { show, draw, turn: (da) => { angle += da; } };
}
