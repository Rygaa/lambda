// The holes dug in the ground (the Craters resource, lib/craters.js): when one changes, the ground hides its cells
// (the texture of the depths, render/shaders.js groundFrag) and its cubes of earth are made again, drawn like the
// stones with the brown of the cliffs, darker the deeper they are (CRATER_FRAG); they cast shadows, so the walls shade
// the floor.
import * as THREE from 'three';
import { getResource } from '../ecs/world.js';
import { Craters, Gpu, Settings, Assets } from '../resources.js';
import { craterGeometry } from '../lib/craters.js';
import { paletteRows } from '../gen/palettes.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';

const EARTH = 'cliff';    // the stone palette of the holes (assets/palettes.json)

export function craterSystem(world) {
  const c = getResource(world, Craters);
  if (!c.dirty) return;
  c.dirty = false;
  c.texture.needsUpdate = true;
  const gpu = getResource(world, Gpu), geometry = craterGeometry(c, getResource(world, Settings).land.terrain);
  if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.geometry = geometry; }
  else {
    const material = shaderMaterial(gpu.shared, S.CRATER_VERT, S.CRATER_FRAG,
      { uMid: { value: getResource(world, Assets).meta.mid.rock }, uPal: { value: paletteRows({ stone: EARTH }).stone } });
    c.mesh = new THREE.Mesh(geometry, material);
    c.mesh.layers.enable(1);     // casts shadows
    c.mesh.frustumCulled = false;
    gpu.scene.add(c.mesh);
  }
  gpu.shadowsDirty = true;
}
