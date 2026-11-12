// The clothes and weapons of the human: when the admin menu changes the outfit (the Wardrobe resource) or the look (the
// Look resource: as it is, or made of cubes), its clips are baked again (lib/character.js dress); when the bake is
// done, the new meshes and clips replace the old ones.
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player } from '../components.js';
import { Wardrobe, Gpu } from '../resources.js';
import { dress } from '../lib/character.js';
import { lookOf } from '../lib/voxels.js';

export function outfitSystem(world) {
  const w = getResource(world, Wardrobe), e = query(world, [Player])[0];
  if (e === undefined) return;
  const look = lookOf(world)?.human.key ?? null;   // its cubes do not follow the cube size (lib/voxels.js)
  if (!w.busy && w.look !== look) w.dirty = true;
  if (w.dirty && !w.busy) {
    w.dirty = false;
    w.look = look;
    w.busy = true;
    dress(world, { ...w.outfit }).then((d) => { w.next = d; }, (err) => { console.error(err); w.busy = false; });
  }
  if (!w.next) return;
  const p = getComponent(world, e, Player), { clips, meshes } = w.next;
  w.next = null;
  w.busy = false;
  for (const mesh of p.meshes) { p.group.remove(mesh); mesh.material.dispose(); }
  for (const frames of Object.values(p.clips)) for (const frame of frames) for (const g of frame) g.dispose();
  for (const mesh of meshes) p.group.add(mesh);
  p.meshes = meshes;
  p.clips = clips;
  getResource(world, Gpu).shadowsDirty = true;
}
