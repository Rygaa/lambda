// The FlyFF decor objects (assets/objects: chairs, boxes, fences, lamps, houses, trees...): the recipe "objects" or the
// Objects part of the admin menu puts them in the world (one Decor entity each, systems/setup.js,
// systems/adminObjects.js). Each model is loaded once (lib/bake.js loadPart), still, at our sizes (objectScale), and
// drawn in the style of our world: with the world, its textures turned into our palette rows (lib/objectStyle.js,
// render/shaders.js DECOR_FRAG), so it gets our pixels, light bands and outline. It stops a walker by a circle, and
// the grass does not grow under it.
// It follows the look (the Look resource, lib/voxels.js): made of cubes on the grid of the world, never smaller than a
// pixel like the rocks, by the voxel workers; a big object gets bigger cubes (MAX_CELLS). Each object keeps its cubes
// for its last look.
import * as THREE from 'three';
import { query, getComponent, addComponent, getResource } from '../ecs/world.js';
import { Decor, Blocker, Footprint } from '../components.js';
import { Objects, Gpu, Settings, Voxels, Assets } from '../resources.js';
import { loadPart } from '../lib/bake.js';
import { styleTexture } from '../lib/objectStyle.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';
import { unitScale } from '../lib/character.js';
import { lookOf, voxelStill } from '../lib/voxels.js';
import { heightAt } from '../gen/terrain.js';

const BASE = '../assets/objects/models/';
const LOW = 0.3;   // world units: a lower object (a flower bed) does not stop a walker
// our sizes (documentation/style/rules.md): next to the human (1.05 tall) FlyFF objects are a little bigger even when
// small (a bench 1.6 high) and much bigger when big (a house 17, giant trees up to 104), where our houses are 3 to 4
// high and our trees 3 to 5. So a height h (world units, FlyFF size) becomes SHRINK h / (1 + SHRINK h / CEILING): a
// bench 0.9, a crate 0.4, a lamp 1.2, a house 4, a tree 3.8, a giant tree 5.6; never more than CEILING, never bigger
const SHRINK = 0.7, CEILING = 6;
const MAX_CELLS = 16e6;   // the cubes of one object fill at most this many cells of its box: a bigger object (a house,
                          // a giant tree) gets bigger cubes, else a worker runs out of memory

export function objectSystem(world) {
  const o = getResource(world, Objects), gpu = getResource(world, Gpu);
  if (!o.unitAsked) { o.unitAsked = true; unitScale(world).then(({ k }) => { o.unit = k; }); }
  if (!o.unit) return;
  // drawn with the world, so the cubes of the world (never smaller than a pixel)
  const full = lookOf(world), look = full && { ...full, ...full.world }, key = look?.key ?? null;
  for (const e of query(world, [Decor])) {
    const d = getComponent(world, e, Decor);
    if (!d.group) { place(world, o, gpu, e, d); continue; }
    if (look && d.cubes?.key !== key && !d.busy) makeCubes(world, gpu, d, look);
    const cubed = !!look && d.cubes?.key === key;
    if (d.group.visible === cubed) { d.group.visible = !cubed; gpu.shadowsDirty = true; }
    if (d.cubes?.mesh) d.cubes.mesh.visible = cubed;
  }
}

// world units per FlyFF unit for the object `name` (assets/objects/objects.json): the scale of the human, its own scale
// (a model made far too big or too small), then our sizes (SHRINK, CEILING)
export function objectScale(o, name) {
  const { size, scale = 1 } = o.names[name], k = o.unit * scale, h = size[1] * k;
  return k * SHRINK / (1 + (SHRINK * h) / CEILING);
}

// the model of an object, loaded the first time: { value: { meshes: [{ geometry, texture }], box }, error }
function modelOf(o, file) {
  if (!o.models.has(file)) {
    const model = { value: null, error: null };
    loadModel(file).then((value) => { model.value = value; }, (err) => { model.error = err; console.error(`object ${file}:`, err); });
    o.models.set(file, model);
  }
  return o.models.get(file);
}

// the meshes of a model, still (each at its place in the file), with no triangle on a transparent texel; and its box
async function loadModel(file) {
  const { parts } = await loadPart(BASE + file + '.glb', BASE + 'textures/');
  const box = new THREE.Box3();
  const meshes = parts.map((part) => {
    const geometry = new THREE.BufferGeometry(), src = part.mesh.geometry;
    for (const name of ['position', 'normal', 'uv']) if (src.getAttribute(name)) geometry.setAttribute(name, src.getAttribute(name).clone());
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
    const count = src.getAttribute('position').count, index = src.index ? Array.from(src.index.array) : [...Array(count).keys()];
    const uv = geometry.getAttribute('uv'), kept = [];
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      if (part.alphaAt((uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3) >= 128) kept.push(a, b, c);
    }
    geometry.setIndex(kept);
    geometry.applyMatrix4(part.local);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    return { geometry, texture: part.texture };
  });
  return { meshes, box };
}

// an object whose model is loaded: its meshes in the world, at our sizes (objectScale), on the ground (lifted if a part
// goes below its origin), and its circle (half its widest side, a little less)
function place(world, o, gpu, e, d) {
  const file = o.names[d.object]?.model;
  if (!file) { console.error(`object "${d.object}": not in assets/objects/objects.json`); d.group = false; return; }
  const model = modelOf(o, file);
  if (!model.value) return;
  const k = objectScale(o, d.object), { meshes, box } = model.value;
  const group = new THREE.Group();
  for (const { geometry, texture } of meshes) group.add(decorMesh(world, gpu, styleTexture(texture), geometry));
  const y = heightAt(getResource(world, Settings).land.terrain, d.x, d.z) + Math.max(0, -box.min.y * k);
  group.position.set(d.x, y, d.z);
  group.rotation.y = d.rot;
  group.scale.setScalar(k);
  gpu.scene.add(group);
  gpu.shadowsDirty = true;
  d.group = group;
  group.updateMatrixWorld(true);
  d.box = box.clone().applyMatrix4(group.matrixWorld);
  const r = THREE.MathUtils.clamp(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 * k, 0.15, 3);
  addComponent(world, e, Footprint, { x: d.x, z: d.z, r });
  if (box.max.y * k > LOW) addComponent(world, e, Blocker, { x: d.x, z: d.z, r: r * 0.8, h: y + box.max.y * k });
}

// a mesh drawn with the world (layer 0) that casts a shadow (layer 1), its palette rows in the texture `map`
function decorMesh(world, gpu, map, geometry) {
  const mesh = new THREE.Mesh(geometry, shaderMaterial(gpu.shared, S.DECOR_VERT, S.DECOR_FRAG,
    { uMid: { value: getResource(world, Assets).meta.mid.rock }, uMap: { value: map } }, { side: THREE.DoubleSide }));
  mesh.layers.enable(1);
  return mesh;
}

// the object made of cubes in a look, by the voxel workers: one mesh, square with the world (not turned with the object)
function makeCubes(world, gpu, d, look) {
  d.busy = true;
  d.group.updateMatrixWorld(true);
  const { key } = look, p = d.group.position.clone();
  const s = d.box.getSize(new THREE.Vector3()), size = Math.max(look.size, Math.cbrt((s.x * s.y * s.z) / MAX_CELLS));
  voxelStill(world, d.group.children, size, look.normals).then((geometry) => {
    if (d.cubes?.mesh) { gpu.scene.remove(d.cubes.mesh); d.cubes.mesh.geometry.dispose(); }
    geometry?.translate(-p.x, -p.y, -p.z);
    const mesh = geometry && decorMesh(world, gpu, getResource(world, Voxels).palette.texture, geometry);
    if (mesh) { mesh.position.copy(p); mesh.visible = false; gpu.scene.add(mesh); }
    d.cubes = { key, mesh };
    d.busy = false;
    gpu.shadowsDirty = true;
  }, (err) => { console.error('object cubes:', err); d.cubes = { key, mesh: null }; d.busy = false; });
}
