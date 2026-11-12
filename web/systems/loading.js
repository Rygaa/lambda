// The loading screen (#loading in index.html): it covers the page from the start, with a bar, until the world is all
// there in the look: every decor object loaded (systems/objects.js), and with the cubes of the look every rock, plant,
// cliff piece and decor object made of cubes (systems/voxels.js, systems/objects.js), and the human and the monsters
// too (systems/outfit.js, systems/monsters.js). Then it fades out, once: a later change of the look (the Admin menu)
// happens in the game, as before. With ?bake it then sends the cubes to be kept (worlds/baked/<world>.bin).
import { query, getComponent, getResource } from '../ecs/world.js';
import { Decor, Prop, SceneObject, Monster, Player } from '../components.js';
import { Voxels, Wardrobe, Bestiary } from '../resources.js';
import { lookOf } from '../lib/voxels.js';
import { toFile } from '../lib/voxelSaved.js';

const FLAT = ['leaves', 'water'];    // the roles that stay as they are (systems/voxels.js)

export function loadingSystem(world) {
  const el = document.getElementById('loading');
  if (!el || el.dataset.done) return;
  const full = lookOf(world), look = full && { ...full, ...full.world };
  const parts = [];      // [what, done, of]

  const decor = query(world, [Decor]).map((e) => getComponent(world, e, Decor));
  parts.push(['objects', decor.filter((d) => d.group !== null).length, decor.length]);
  if (look) {
    parts.push(['objects in cubes', decor.filter((d) => d.group === false || d.cubes?.key === look.key).length, decor.length]);
    const props = query(world, [Prop, SceneObject]).map((e) => getComponent(world, e, SceneObject).meshes.filter(({ role }) => !FLAT.includes(role)));
    parts.push(['plants and rocks in cubes', props.filter((ms) => ms.every(({ mesh }) => mesh.userData.cubes?.key === look.key)).length, props.length]);
    const v = getResource(world, Voxels);
    const pieces = v.chunks.length + v.chunksLeft;
    parts.push(['cliffs in cubes', v.chunksLeft ? 0 : pieces, pieces]);
  }
  const bodies = lookOf(world)?.key ?? null, human = query(world, [Player])[0], w = getResource(world, Wardrobe);
  if (human !== undefined) parts.push(['the human', !w.busy && !w.dirty && w.look === bodies ? 1 : 0, 1]);
  const monsters = query(world, [Monster]).map((e) => getComponent(world, e, Monster));
  const asked = getResource(world, Bestiary).requests.length;
  parts.push(['monsters', monsters.filter((m) => m.look === bodies).length, monsters.length + asked]);

  const done = parts.reduce((s, p) => s + p[1], 0), of = parts.reduce((s, p) => s + p[2], 0);
  const next = parts.find(([, d, n]) => d < n);
  el.querySelector('i').style.width = `${of ? Math.round((done / of) * 100) : 0}%`;
  el.querySelector('span').textContent = next ? `${next[0]}: ${next[1]} / ${next[2]}` : 'ready';
  if (next) return;
  el.dataset.done = '1';
  getResource(world, Voxels).pool.dropBaked();
  // ?bake: every cube made or read goes to web/serve.py, which writes worlds/baked/<world>.bin (lib/voxelSaved.js)
  const kept = getResource(world, Voxels).pool.kept;
  if (kept) {
    const name = new URLSearchParams(location.search).get('world') || 'meadow';
    fetch(`../worlds/baked/${encodeURIComponent(name)}.bin`, { method: 'POST', body: toFile(kept) })
      .then((r) => console.log(r.ok ? `worlds/baked/${name}.bin: ${kept.size} jobs` : `bake not saved: ${r.status}`));
  }
  el.classList.add('gone');
  setTimeout(() => el.remove(), 600);
}
