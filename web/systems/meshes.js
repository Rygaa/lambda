// Creates, updates and removes the Three.js objects behind entities.
import * as THREE from 'three';
import { added, removed, changed, addComponent, hasComponent, getComponent, getResource } from '../ecs/world.js';
import { Transform, Prop, ShadowCaster, SceneObject, GroundPlane, GroundCover, DustField } from '../components.js';
import { Assets, Gpu, Settings } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';
import { spriteGeometry, spriteUniforms } from '../lib/sprites.js';
import { FAMILY, paletteRows } from '../gen/palettes.js';
import { heightAt, terrainGeometry } from '../gen/terrain.js';

// the meshes of one generated object: [{ mesh, role }]; rows: palette family -> row
// (a part with its own `palette` name keeps it)
function propMeshes(gpu, shape, rows, casts) {
  const group = new THREE.Group();
  const meshes = [];
  for (const { geometry, role, palette } of shape.parts) {
    const row = palette ? paletteRows({ [FAMILY[role]]: palette })[FAMILY[role]] : rows[FAMILY[role]] ?? 0;
    const mesh = new THREE.Mesh(geometry, gpu.materials[role][row]);
    if (casts && role !== 'leaves' && role !== 'water') mesh.layers.enable(1);     // layer 1 = shadow casters
    if (role === 'leaves') mesh.frustumCulled = false;
    // water is not seen in water; once there is some, the mirrored pass runs
    if (role === 'water') { gpu.reflect.skip.add(mesh); gpu.reflect.on = true; }
    group.add(mesh);
    meshes.push({ mesh, role });
  }
  return { group, meshes };
}

// on the ground under it: its level, or the slope of stairs
function placeGroup(world, e) {
  const so = getComponent(world, e, SceneObject);
  const t = getComponent(world, e, Transform);
  so.group.position.set(t.x, heightAt(getResource(world, Settings).land.terrain, t.x, t.z), t.z);
  so.group.rotation.y = t.rotY;
}

// the ground paints (gen/ground.js) as a texture, read with linear filtering
function groundUniforms(ground) {
  const n = ground?.n ?? 1;
  const tex = new THREE.DataTexture(ground?.data ?? new Uint8Array(4), n, n, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const ext = ground?.ext ?? 1;
  return { uGround: { value: tex }, uGroundBox: { value: new THREE.Vector3(-ext, -ext, 2 * ext) } };
}

export function meshSystem(world) {
  const gpu = getResource(world, Gpu);
  const assets = getResource(world, Assets);
  const settings = getResource(world, Settings);

  for (const e of added(world, GroundPlane)) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      shaderMaterial(gpu.shared, S.MESH_VERT, S.groundFrag(settings.land.pavement === 'bricks'), groundUniforms(settings.land.ground)));
    gpu.scene.add(mesh);
    addComponent(world, e, SceneObject, { group: mesh, meshes: [] });
    // cliffs: the plateau tops look like the ground; the walls and the stairs are stone
    const terrain = settings.land.terrain;
    if (terrain?.kind === 'map') {
      // a FlyFF map (gen/map.js): its ground, which goes on past the map, over the plane; and its water
      const g = terrainGeometry(terrain);
      mesh.position.y = Math.min(...terrain.height) - 1;
      const ground = new THREE.Mesh(g.tops, mesh.material);
      ground.position.y = -mesh.position.y;
      ground.layers.enable(1);     // casts shadows (the hills)
      mesh.add(ground);
      if (g.water) {
        const water = new THREE.Mesh(g.water, gpu.materials.water[paletteRows({ water: 'clear' }).water]);
        water.position.y = -mesh.position.y;
        gpu.reflect.skip.add(water);
        gpu.reflect.on = true;
        mesh.add(water);
      }
    } else if (terrain) {
      const g = terrainGeometry(terrain);
      const stone = (name) => gpu.materials.stone[paletteRows({ stone: name }).stone];
      for (const [geometry, material] of [[g.tops, mesh.material], [g.walls, stone(terrain.palette)], [g.stairs, stone(terrain.stairsPalette)]]) {
        if (!geometry) continue;
        const m = new THREE.Mesh(geometry, material);
        m.layers.enable(1);     // casts shadows
        mesh.add(m);
      }
    }
  }

  for (const e of added(world, GroundCover)) {
    const c = getComponent(world, e, GroundCover);
    const kind = c.kind === 'grass' ? 'tufts' : 'decor';
    const geo = spriteGeometry(c.pos, c.light, c.params);
    const mesh = new THREE.Mesh(geo, shaderMaterial(gpu.shared, S.SPRITE_VERT, S.SPRITE_FRAG,
      { ...spriteUniforms(assets.tex[kind], assets.meta.sprites[kind], 0, 0, settings.ppu), uPal: { value: 0 } }));
    mesh.frustumCulled = false;
    gpu.scene.add(mesh);
    gpu.reflect.skip.add(mesh);     // too small to see in the water, and many
    addComponent(world, e, SceneObject, { group: mesh, meshes: [] });
  }

  for (const e of added(world, DustField)) {
    const d = getComponent(world, e, DustField);
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    const mat = shaderMaterial(gpu.shared, S.DUST_VERT, S.DUST_FRAG, {
      uTime: { value: 0 }, uBoxMin: { value: new THREE.Vector3(...d.boxMin) },
      uBoxSize: { value: new THREE.Vector3(...d.boxSize) }, tNorm: { value: null },
    }, { depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    gpu.dustScene.add(points);
    addComponent(world, e, SceneObject, { group: points, meshes: [] });
  }

  // generated objects (gen/)
  for (const e of added(world, Prop)) {
    if (hasComponent(world, e, SceneObject)) continue;
    const prop = getComponent(world, e, Prop);
    const shape = assets.shapes.sets.get(prop.set).shapes[prop.variant];
    const { group, meshes } = propMeshes(gpu, shape, prop.palette, hasComponent(world, e, ShadowCaster));
    for (const m of meshes) m.mesh.userData.entity = e;
    gpu.scene.add(group);
    addComponent(world, e, SceneObject, { group, meshes });
    placeGroup(world, e);
  }

  for (const e of changed(world, Transform)) if (hasComponent(world, e, SceneObject)) placeGroup(world, e);

  for (const [, so] of removed(world, SceneObject)) so.group.parent?.remove(so.group);
}
