// The Monsters and Human parts of the admin menu (systems/admin.js calls them).
// Monsters: a button opens the grid of all monster types (the Bestiary resource); a click on one opens its editor:
// its name, its model (a grid of the 127 models), its level and stats. A change applies at once, also to the monsters
// of that type already in the world, and goes into Bestiary changes, which Save writes to saves/monsters.json.
// Spawn puts one in front of the human (systems/monsters.js bakes its model first); Copy makes a new type from it;
// Delete removes the type; Remove all removes the monsters in the world.
// Human: its level, STR, STA and points (the Stats component, lib/combat.js), and a button that fills its HP.
import { query, getComponent, getResource, destroyEntity } from '../ecs/world.js';
import { Monster, Player, Health, Stats } from '../components.js';
import { Bestiary, Gpu } from '../resources.js';
import { BASE } from '../lib/monsters.js';
import { maxHp } from '../lib/combat.js';
import { openPicker } from './admin.js';

const FIRST_ID = 100000;   // new types get ids from here (the FlyFF ids are lower)
// the fields of the editor: [key, label, step, min]; damage is [min, max]
const FIELDS = [
  ['level', 'Level', 1, 1], ['hp', 'HP', 1, 1], ['damage.0', 'Damage min', 1, 1], ['damage.1', 'Damage max', 1, 1],
  ['defense', 'Defense', 1, 0], ['attackDelay', 'Attack delay (s)', 0.1, 0.3], ['walkSpeed', 'Walk speed', 0.1, 0],
  ['size', 'Size', 0.1, 0.1], ['xp', 'XP', 1, 0],
];
const read = (type, key) => key.split('.').reduce((o, k) => o[k], type);
const write = (type, key, v) => { const ks = key.split('.'); ks.slice(0, -1).reduce((o, k) => o[k], type)[ks.at(-1)] = v; };

export function setupMonstersPart(world, panel, picker, preview) {
  const b = getResource(world, Bestiary);
  let type = b.types.find((t) => t.name === 'Aibatt') ?? b.types[0];
  const title = document.createElement('h3');
  title.textContent = 'Monsters';
  const box = document.createElement('div');
  box.className = 'monsters';
  box.innerHTML = `<div class="slot"><span>Monster</span><output></output><button id="admin-monster"></button></div>
    <label class="name"><span>Name</span><input id="admin-monster-name" type="text"></label>
    <div class="slot"><span>Model</span><output>${Object.keys(b.models).length}</output><button id="admin-monster-model"></button></div>
    <div class="fields"></div>
    <div class="save"><button id="admin-spawn">Spawn</button><button id="admin-copy">Copy</button><button id="admin-delete">Delete</button><button id="admin-clear">Remove all</button></div>`;
  panel.append(title, box);
  const $ = (sel) => box.querySelector(sel);
  const fields = FIELDS.map(([key, label, step, min]) => {
    const row = document.createElement('label');
    row.innerHTML = `<span>${label}</span><input type="number" step="${step}" min="${min}">`;
    const input = row.querySelector('input');
    input.id = 'admin-monster-' + key.replace('.', '-');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < min) return;
      write(type, key, v);
      if (key === 'damage.0' || key === 'damage.1') type.damage.sort((x, y) => x - y);
      changed();
    });
    input.addEventListener('change', () => input.blur());
    $('.fields').append(row);
    return [key, input];
  });
  // the editor shows `type`
  const show = () => {
    $('#admin-monster').textContent = `${type.name} · ${type.level}`;
    $('.slot output').textContent = b.types.length;
    $('#admin-monster-name').value = type.name;
    $('#admin-monster-model').textContent = type.model.replace(/^mvr_/, '');
    for (const [key, input] of fields) if (document.activeElement !== input) input.value = read(type, key);
  };
  // the type changed: Save will write it; the monsters of this type in the world get its new size
  const changed = () => {
    b.changes[type.id] = type;
    for (const e of query(world, [Monster])) {
      const m = getComponent(world, e, Monster);
      if (m.type === type) m.group.scale.setScalar(b.unit * type.size);
    }
    show();
  };
  $('#admin-monster-name').addEventListener('input', (e) => { type.name = e.target.value || type.name; changed(); });
  $('#admin-monster-name').addEventListener('change', (e) => e.target.blur());

  const typePicture = (id) => { const t = b.types.find((x) => String(x.id) === id); return modelPicture(t.model); };
  const modelPicture = (model) => preview(BASE + model + '.glb', { clip: b.models[model].clips.idle });
  $('#admin-monster').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (!picker.hidden && picker.dataset.slot === 'monster') { picker.hidden = true; return; }
    const items = b.types.map((t) => ({ name: `${t.name} · ${t.level}`, file: String(t.id) }));
    openPicker(picker, 'monster', 'Monsters', items, typePicture, () => String(type.id), (id) => {
      type = b.types.find((t) => String(t.id) === id);
      show();
    });
  });
  $('#admin-monster-model').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (!picker.hidden && picker.dataset.slot === 'model') { picker.hidden = true; return; }
    const items = Object.keys(b.models).map((m) => ({ name: m.replace(/^mvr_/, ''), file: m }));
    openPicker(picker, 'model', 'Models', items, modelPicture, () => type.model, (model) => {
      type.model = model;   // the monsters already in the world keep their model; a new spawn has the new one
      changed();
    });
  });

  // spawn: in front of the human, a little more for a big monster
  $('#admin-spawn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    const human = query(world, [Player])[0];
    if (human === undefined) return;
    const p = getComponent(world, human, Player), d = 1 + 0.4 * type.size;
    b.requests.push({ type, x: p.x + Math.sin(p.rot) * d, z: p.z + Math.cos(p.rot) * d, rot: p.rot + Math.PI });
  });
  $('#admin-copy').addEventListener('click', (e) => {
    e.currentTarget.blur();
    const id = Math.max(FIRST_ID - 1, ...b.types.map((t) => t.id)) + 1;
    type = { ...structuredClone(type), id, name: type.name + ' copy' };
    b.types.splice(b.types.findIndex((t) => t.level > type.level) >>> 0, 0, type);
    changed();
  });
  $('#admin-delete').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (b.types.length < 2 || !confirm(`Delete ${type.name}?`)) return;
    const i = b.types.indexOf(type);
    b.types.splice(i, 1);
    b.changes[type.id] = null;
    type = b.types[Math.min(i, b.types.length - 1)];
    picker.hidden = true;
    show();
  });
  $('#admin-clear').addEventListener('click', (e) => {
    e.currentTarget.blur();
    const gpu = getResource(world, Gpu);
    b.requests.length = 0;
    for (const m of query(world, [Monster])) {
      const { group, meshes } = getComponent(world, m, Monster);
      gpu.scene.remove(group);
      for (const mesh of meshes) mesh.material.dispose();
      destroyEntity(world, m);
    }
    gpu.shadowsDirty = true;
  });
  show();
}

// the Human part: returns a function that shows its values again (they change while it fights)
export function setupHumanPart(world, panel) {
  const title = document.createElement('h3');
  title.textContent = 'Human';
  const box = document.createElement('div');
  box.className = 'fields';
  const stats = () => { const e = query(world, [Player, Stats, Health])[0]; return e === undefined ? null : [getComponent(world, e, Stats), getComponent(world, e, Health)]; };
  const inputs = ['level', 'str', 'sta', 'points'].map((key) => {
    const row = document.createElement('label');
    row.innerHTML = `<span>${{ level: 'Level', str: 'STR', sta: 'STA', points: 'Points' }[key]}</span><input type="number" step="1" min="${key === 'points' ? 0 : 1}">`;
    const input = row.querySelector('input');
    input.id = 'admin-human-' + key;
    input.addEventListener('input', () => {
      const v = Math.round(Number(input.value)), got = stats();
      if (!got || !Number.isFinite(v) || v < Number(input.min)) return;
      const [s, h] = got;
      s[key] = v;
      if (key === 'level') s.xp = 0;
      const max = maxHp(s);
      h.hp = Math.min(max, h.hp + max - h.max);
      h.max = max;
    });
    input.addEventListener('change', () => input.blur());
    box.append(row);
    return [key, input];
  });
  const heal = document.createElement('div');
  heal.className = 'save';
  heal.innerHTML = '<button id="admin-heal">Full HP</button>';
  heal.querySelector('button').addEventListener('click', (e) => {
    e.currentTarget.blur();
    const got = stats();
    if (got) got[1].hp = got[1].max;
  });
  panel.append(title, box, heal);
  return () => {
    const got = stats();
    if (got) for (const [key, input] of inputs) if (document.activeElement !== input) input.value = got[0][key];
  };
}
