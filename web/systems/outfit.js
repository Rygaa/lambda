// The clothes and weapons of the human: when the admin menu changes the outfit (the Wardrobe resource) or the look (the
// Look resource: as it is, or made of cubes), its clips are baked again (lib/character.js dress); when the bake is
// done, the new meshes and clips replace the old ones (the Wardrobe keeps them: dressed). The last bakes are kept
// (Wardrobe worn, lib/character.js keepWorn), so an outfit put back is there at once. Transformed (the Form component, systems/transform.js),
// the human keeps its gold form: systems/transform.js makes it again from the new bake and puts it on.
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player } from '../components.js';
import { Wardrobe, Gpu } from '../resources.js';
import { dress, wornKey, keepWorn, disposeBake } from '../lib/character.js';
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
    const outfit = { ...w.outfit }, key = wornKey(look, outfit), kept = w.worn.get(key);
    if (kept) { keepWorn(w, key, kept); w.next = kept; }
    else {
      w.busy = true;
      dress(world, outfit).then((d) => { keepWorn(w, key, d); w.next = d; }, (err) => { console.error(err); w.busy = false; });
    }
  }
  if (!w.next) return;
  const p = getComponent(world, e, Player), old = w.dressed, next = w.next;
  w.next = null;
  w.busy = false;
  if (next === old) return;
  wear(p, next);
  if (old && ![...w.worn.values()].includes(old)) disposeBake(old);
  w.dressed = next;
  getResource(world, Gpu).shadowsDirty = true;
}
