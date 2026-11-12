// The Objects part of the admin menu (systems/admin.js calls it): a button opens the grid of the 1018 FlyFF decor
// objects (assets/objects/objects.json, with a search box); Place puts the chosen one in front of the human, in any
// world (a Decor entity: systems/objects.js loads it, draws it and makes it of cubes with the look); Remove all removes
// the objects placed here (not the ones of the world recipe).
import { query, getComponent, getResource, spawn, destroyEntity } from '../ecs/world.js';
import { Decor, Player } from '../components.js';
import { Objects, Gpu } from '../resources.js';
import { openPicker } from './admin.js';
import { objectScale } from './objects.js';

const BASE = '../assets/objects/models/';

export function setupObjectsPart(world, panel, picker, preview) {
  const o = getResource(world, Objects);
  // the FlyFF names (the short names of the first 30 are the same models again)
  const names = Object.keys(o.names).filter((n) => o.names[n].model.slice(4).trim() === n).sort();
  let name = names.includes('rustiachair01') ? 'rustiachair01' : names[0];
  const title = document.createElement('h3');
  title.textContent = 'Objects';
  const box = document.createElement('div');
  box.className = 'monsters';
  box.innerHTML = `<div class="slot"><span>Object</span><output>${names.length}</output><button id="admin-object"></button></div>
    <div class="slot"><span>Size</span><output id="admin-object-size"></output></div>
    <div class="save"><button id="admin-place">Place</button><button id="admin-objects-clear">Remove all</button></div>`;
  panel.append(title, box);
  const $ = (sel) => box.querySelector(sel);
  // the name, and the size in world units (width x height x depth), once the unit is known
  const show = () => {
    $('#admin-object').textContent = name;
    const k = o.unit && objectScale(o, name);
    $('#admin-object-size').textContent = k ? o.names[name].size.map((s) => (s * k).toFixed(1)).join(' × ') : '';
  };
  $('#admin-object').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (!picker.hidden && picker.dataset.slot === 'object') { picker.hidden = true; return; }
    openPicker(picker, 'object', 'Objects', names.map((n) => ({ name: n, file: n })),
      (n) => preview(BASE + o.names[n].model + '.glb'), () => name, (n) => { name = n; show(); });
  });
  // in front of the human, facing it: farther for a big object
  $('#admin-place').addEventListener('click', (e) => {
    e.currentTarget.blur();
    const human = query(world, [Player])[0];
    if (human === undefined || !o.unit) return;
    const p = getComponent(world, human, Player), { size } = o.names[name];
    const d = 0.6 + (Math.max(size[0], size[2]) * objectScale(o, name)) / 2;
    spawn(world, [Decor, { object: name, x: p.x + Math.sin(p.rot) * d, z: p.z + Math.cos(p.rot) * d, rot: p.rot + Math.PI, placed: true }]);
    show();
  });
  $('#admin-objects-clear').addEventListener('click', (e) => {
    e.currentTarget.blur();
    const gpu = getResource(world, Gpu);
    for (const ent of query(world, [Decor])) {
      const d = getComponent(world, ent, Decor);
      if (!d.placed) continue;
      for (const mesh of [...(d.group ? d.group.children : []), d.cubes?.mesh].filter(Boolean)) mesh.material.dispose();
      if (d.group) gpu.scene.remove(d.group);
      if (d.cubes?.mesh) gpu.scene.remove(d.cubes.mesh);    // its geometry stays: the copies of its model share it
      destroyEntity(world, ent);
    }
    gpu.shadowsDirty = true;
  });
  show();
  return show;
}
