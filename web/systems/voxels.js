// The look of the rocks, plants and cliffs (the Look resource): as they are, or made of cubes (lib/voxels.js). Only the
// geometry drawn is swapped: the shapes, what stops a walker, and the materials stay the same, so the switch goes
// both ways. The human and the monsters follow the look too (systems/outfit.js, systems/monsters.js).
// One cube is `px` pixels of the frame, at least 1. The voxel workers make them (lib/voxelPool.js), so the game does not
// stop: the objects nearest to the camera first, then the cliffs, on the grid of the world, in square pieces (CHUNK
// units) shown all at once when they are all made. The copies of one shape share its cubes (made once, in the units of
// the shape, turned with each copy), so a forest of 300 trees from 12 shapes makes 12 jobs. Each object keeps its cubes
// for its last look, so going back to it is at once. Leaves (sprites), water, grass and the ground stay as they are.
import * as THREE from 'three';
import { query, added, getComponent, hasComponent, getResource } from '../ecs/world.js';
import { Prop, SceneObject, GroundPlane, CameraRig } from '../components.js';
import { Voxels, Gpu, Settings } from '../resources.js';
import { lookOf, triangles, toGeometry, oneSided } from '../lib/voxels.js';

const AHEAD = 2;         // jobs of the world sent to the pool for each worker (the bodies go before the ones that wait)
const CHUNK = 4;         // world units: the side of a piece of cliff
const FLAT = ['leaves', 'water'];   // roles that stay as they are
const UP = [0, 1, 0];     // the cubes of a shape are for all its turns: where two faces meet in one cube (a thin leaf),
                         // the one facing up wins (the camera looks down on it whatever its turn)
const MAX_CELLS = 16e6;  // the cubes of one shape fill at most this many cells of its box: a bigger one (a giant tree of a
                         // FlyFF map) gets bigger cubes, else a worker is slow and runs out of memory (as systems/objects.js)

export function voxelSystem(world) {
  // the look of the world: its cubes are never smaller than a pixel (lib/voxels.js lookOf)
  const v = getResource(world, Voxels), gpu = getResource(world, Gpu), full = lookOf(world);
  const look = full && { ...full, ...full.world }, key = look?.key ?? null;
  if (key !== v.key) {
    v.key = key;
    v.queue = [];
    // the shapes still being made for the old look: their answers will be dropped, so they are asked again next time
    for (const job of v.sent.values()) if (job.shared) job.shared.looks.delete(job.shared.key);
    v.sent.clear();
    for (const e of query(world, [Prop, SceneObject])) { showShape(world, e); if (look) v.queue.push({ entity: e }); }
    dropChunks(world, v);
    if (look) {
      const [x, , z] = getComponent(world, query(world, [CameraRig])[0], CameraRig).target;
      const far = ({ entity }) => { const p = getComponent(world, entity, SceneObject).group.position; return (p.x - x) ** 2 + (p.z - z) ** 2; };
      v.queue.sort((a, b) => far(a) - far(b));
      v.queue.push(...cliffChunks(world, look));
    }
    gpu.shadowsDirty = true;
  } else if (look) {
    for (const e of added(world, SceneObject)) if (hasComponent(world, e, Prop)) v.queue.unshift({ entity: e });
  }

  // the answers of the workers (an answer for an old look is dropped)
  for (const { id, meshes } of v.done.splice(0)) {
    const job = v.sent.get(id);
    v.sent.delete(id);
    if (!job || !look) continue;
    if (job.shared) shapeDone(world, job.shared, meshes);
    else putChunk(world, v, job, meshes);
    gpu.shadowsDirty = true;
  }
  // new jobs: an object that kept its cubes for this look shows them at once
  while (look && v.queue.length && v.sent.size < v.pool.size * AHEAD) {
    const job = v.queue.shift();
    if (job.entity !== undefined && !hasComponent(world, job.entity, SceneObject)) continue;
    const message = job.entity !== undefined ? propJob(world, job, look) : chunkJob(world, job, look);
    if (!message) { gpu.shadowsDirty = true; continue; }
    const id = v.next++;
    v.sent.set(id, { ...job, key });
    v.pool.run(message, message.sources.flatMap((s) => [s.tris.p.buffer, s.tris.nrm.buffer])).then(({ meshes }) => v.done.push({ id, meshes }));
  }
}

// toward the camera (lib/voxelCore.js voxelize view)
const viewOf = (world) => getResource(world, Settings).basis.F.clone().negate().toArray();

// ------------------------------------------------------------------ objects
// the cubes of the shapes in each look: the first geometry of a shape -> look key -> { geometries (one per mesh, or
// null while they are made), waiting: the entities to give them to }
const shapes = new WeakMap();

// the job of an object: the cubes of its shape, if no copy of it asked for them yet: the triangles of each of its
// meshes, in the units of the shape (null: they are made or being made; it gets them when they are there)
function propJob(world, job, look) {
  const so = getComponent(world, job.entity, SceneObject);
  const meshes = so.meshes.filter(({ role }) => !FLAT.includes(role)).map(({ mesh }) => mesh);
  for (const mesh of meshes) mesh.userData.shape ??= mesh.geometry;
  if (!meshes.length) return null;
  if (meshes.every((mesh) => mesh.userData.cubes?.key === look.key)) { showCubes(so); return null; }
  const first = meshes[0].userData.shape;
  if (!shapes.has(first)) shapes.set(first, new Map());
  const looks = shapes.get(first);
  let shared = looks.get(look.key);
  if (shared) {
    if (shared.geometries) putCubes(world, job.entity, shared, look.key);
    else shared.waiting.push(job.entity);
    return null;
  }
  looks.set(look.key, (shared = { geometries: null, waiting: [job.entity], key: look.key, looks }));
  job.shared = shared;
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    mesh.userData.shape.computeBoundingBox();
    box.union(mesh.userData.shape.boundingBox);
  }
  const s = box.getSize(new THREE.Vector3()), size = Math.max(look.size, Math.cbrt((s.x * s.y * s.z) / MAX_CELLS));
  // one source per mesh, each its own colour, so each mesh gets its own cubes
  return {
    sources: meshes.map((mesh, c) => ({ tris: oneSided(triangles(mesh.userData.shape, mesh.matrix)), color: c })),
    size, opts: { normals: look.normals, fill: true, view: UP }, colors: meshes.length,
  };
}

// the cubes of a shape have come: to every copy that waits for them
function shapeDone(world, shared, arrays) {
  shared.geometries = arrays.map((a) => toGeometry(a));
  for (const e of shared.waiting.splice(0)) putCubes(world, e, shared, shared.key);
}

// an object gets the cubes of its shape: each mesh its own
function putCubes(world, entity, { geometries }, key) {
  if (!hasComponent(world, entity, SceneObject)) return;
  const so = getComponent(world, entity, SceneObject);
  so.meshes.filter(({ role }) => !FLAT.includes(role)).forEach(({ mesh }, c) => { mesh.userData.cubes = { key, geometry: geometries[c] }; });
  showCubes(so);
}

// an object made of cubes (they turn with it)
function showCubes(so) {
  for (const { mesh } of so.meshes) {
    const cubes = mesh.userData.cubes;
    if (!cubes) continue;
    mesh.geometry = cubes.geometry ?? mesh.userData.shape;
    mesh.visible = !!cubes.geometry;
  }
}

// an object as it is
function showShape(world, e) {
  for (const { mesh } of getComponent(world, e, SceneObject).meshes) {
    if (!mesh.userData.shape) continue;
    mesh.geometry = mesh.userData.shape;
    mesh.visible = true;
  }
}

// ------------------------------------------------------------------ cliffs
// the cliff meshes (systems/meshes.js: the plateau tops, the walls, the stairs) of the ground plane. A FlyFF map has
// none: its ground and its water stay as they are, like the ground of the other worlds (in cubes of a pixel its
// slopes would look the same, from millions of cubes)
function cliffMeshes(world) {
  if (getResource(world, Settings).land.terrain?.kind === 'map') return [];
  const e = query(world, [GroundPlane, SceneObject])[0];
  return e === undefined ? [] : getComponent(world, e, SceneObject).group.children.filter((m) => !m.userData.cube);
}

// the jobs of the cliffs: one square piece each, with the triangles of each cliff mesh that touch it
function cliffChunks(world, look) {
  const meshes = cliffMeshes(world);
  if (!meshes.length) return [];
  const pad = look.size * 2, pieces = new Map();
  meshes.forEach((mesh, c) => {
    const { p, nrm } = triangles(mesh.geometry);
    for (let t = 0; t < p.length; t += 9) {
      const xs = [p[t], p[t + 3], p[t + 6]], zs = [p[t + 2], p[t + 5], p[t + 8]];
      for (let i = Math.floor((Math.min(...xs) - pad) / CHUNK); i <= Math.floor((Math.max(...xs) + pad) / CHUNK); i++)
        for (let j = Math.floor((Math.min(...zs) - pad) / CHUNK); j <= Math.floor((Math.max(...zs) + pad) / CHUNK); j++) {
          const k = `${i},${j}`;
          if (!pieces.has(k)) pieces.set(k, { i, j, tris: meshes.map(() => ({ p: [], nrm: [] })) });
          const into = pieces.get(k).tris[c];
          for (let q = 0; q < 9; q++) { into.p.push(p[t + q]); into.nrm.push(nrm[t + q]); }
        }
    }
  });
  getResource(world, Voxels).chunksLeft = pieces.size;
  return [...pieces.values()].map((chunk) => ({ chunk }));
}

// the job of a piece of cliff: one volume for all the cliff meshes (colour = which mesh), so where they meet no face
// is made twice; then one mesh for each
function chunkJob(world, { chunk: { i, j, tris } }, look) {
  const box = [i * CHUNK, -1e3, j * CHUNK, (i + 1) * CHUNK, 1e3, (j + 1) * CHUNK];
  const sources = tris.map((t, c) => ({ tris: { p: Float32Array.from(t.p), nrm: Float32Array.from(t.nrm), uv: null }, color: c }))
    .filter((s) => s.tris.p.length);
  return { sources, size: look.size, opts: { normals: look.normals, view: viewOf(world), box }, colors: tris.length };
}

// a piece of cliff has come: a hidden mesh for each cliff mesh, with its material. When the last piece comes, the
// pieces show and the cliffs hide
function putChunk(world, v, job, arrays) {
  const meshes = cliffMeshes(world), parent = meshes[0]?.parent;
  if (!parent) return;
  meshes.forEach((source, c) => {
    const geometry = toGeometry(arrays[c]);
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, source.material);
    mesh.layers.mask = source.layers.mask;
    mesh.userData.cube = true;
    mesh.visible = false;
    parent.add(mesh);
    v.chunks.push(mesh);
  });
  if (--v.chunksLeft > 0) return;
  for (const mesh of v.chunks) mesh.visible = true;
  for (const mesh of meshes) mesh.visible = false;
}

// the cliffs as they are
function dropChunks(world, v) {
  for (const mesh of v.chunks) { mesh.parent?.remove(mesh); mesh.geometry.dispose(); }
  v.chunks = [];
  v.chunksLeft = 0;
  for (const mesh of cliffMeshes(world)) mesh.visible = true;
}
