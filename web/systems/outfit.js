// The clothes and weapons of the human: when the admin menu changes the outfit (the Wardrobe resource) or the look (the
// Look resource: as it is, or made of cubes), its clips are baked again (lib/character.js dress); when the bake is
// done, the new meshes and clips replace the old ones (the Wardrobe keeps them: dressed). Transformed (the Form
// component, systems/transform.js), the human keeps its gold form: systems/transform.js makes it again from the new
// bake and puts it on.
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player } from '../components.js';
import { Wardrobe, Gpu } from '../resources.js';
import { dress } from '../lib/character.js';
import { lookOf } from '../lib/voxels.js';
import { wear } from '../lib/form.js';

export function outfitSystem(world) {
  const w = getResource(world, Wardrobe), e = query(world, [Player])[0];
  if (e === undefined) return;
  const look = lookOf(world)?.player.key ?? null;   // its cubes have their own size (lib/voxels.js)
  if (!w.busy && w.look !== look) w.dirty = true;
  if (w.dirty && !w.busy) {
    w.dirty = false;
    w.look = look;
    w.busy = true;
    dress(world, { ...w.outfit }).then((d) => { w.next = d; }, (err) => { console.error(err); w.busy = false; });
  }
  if (!w.next) return;
  const p = getComponent(world, e, Player), old = w.dressed, next = w.next;
  w.next = null;
  w.busy = false;
  wear(p, next);
  if (old) {
    for (const mesh of old.meshes) mesh.material.dispose();
    for (const frames of Object.values(old.clips)) for (const frame of frames) for (const g of frame) g.dispose();
  }
  w.dressed = next;
  getResource(world, Gpu).shadowsDirty = true;
}
