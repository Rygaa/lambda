// The bag of the human (the Inventory resource): its window (the I key, or the Bag button of the skill bar) shows the
// human as it is dressed now, turned with a drag (lib/doll.js), all it wears around it (helmet, glasses or mask,
// clothes, gloves, cloak, boots, weapon, shield), and under it a grid of what it carries, each with its picture
// (lib/preview.js).
//   a click on a worn item takes it off: it goes to the bag (no clothes: the bare body). "Take all off" takes off all.
//   a click on an item of the bag puts it on (what was worn in its slot goes to the bag). The outfit changes at once
//   (the Wardrobe resource), its new look is baked (systems/outfit.js) and the doll shows it when it is ready.
//   a click on a potion, or its key (assets/items/potions.json: 5 HP, 6 MP), drinks one: HP and MP come back.
// The potions on the ground go into the bag in systems/drops.js.
import { query, getComponent, getResource, sendEvent } from '../ecs/world.js';
import { Player, Health, Mana } from '../components.js';
import { Inventory, Input, Wardrobe, Time, Voxels } from '../resources.js';
import { Damage } from '../events.js';
import { createPreview } from '../lib/preview.js';
import { createDoll } from '../lib/doll.js';

const PARTS = '../assets/character/player/parts/', POTIONS = '../assets/items/models/';
// the slots it wears, around the doll: the left column, then the right one
const WORN = [['cap', 'Helmet', '⛑'], ['mask', 'Glasses', '◐'], ['upper', 'Clothes', '♜'], ['hand', 'Gloves', '✋'],
  ['cloak', 'Cloak', '❦'], ['foot', 'Boots', '▙'], ['weapon', 'Weapon', '⚔'], ['shield', 'Shield', '⛨']];
const CELLS = 12;   // the bag shows at least this many cells (the empty ones too)
const ON_HEAD = new Set(['cap', 'mask']);

let ui = null;   // its window, and what it last drew (setupInventorySystem)

export function setupInventorySystem(world) {
  const el = document.createElement('div');
  el.id = 'inventory';
  el.hidden = true;
  el.innerHTML = `<header><b>Inventory</b><span>drag: turn · click: take off, wear</span><button data-close title="close (I)">×</button></header>
    <div class="paper"><div class="col left"></div><div class="stage"><canvas></canvas><i class="busy">dressing…</i></div><div class="col right"></div></div>
    <footer><button data-strip>Take all off</button></footer><h3>Bag <small></small></h3><div class="grid"></div>`;
  document.body.append(el);
  ui = { el, drawn: -1, preview: createPreview(), doll: null, dressed: undefined, drag: null };
  el.querySelector('[data-close]').addEventListener('click', () => { getResource(world, Inventory).open = false; });
  el.querySelector('[data-strip]').addEventListener('click', (e) => {
    e.currentTarget.blur();
    for (const [slot] of WORN) getResource(world, Inventory).actions.push({ takeOff: slot });
  });
  const stage = el.querySelector('.stage');
  stage.addEventListener('pointerdown', (e) => { ui.drag = e.clientX; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (ui.drag === null) return; ui.doll?.turn((e.clientX - ui.drag) * 0.02); ui.drag = e.clientX; });
  stage.addEventListener('pointerup', () => { ui.drag = null; });
  stage.addEventListener('pointercancel', () => { ui.drag = null; });
}

export function inventorySystem(world) {
  const inv = getResource(world, Inventory), input = getResource(world, Input), w = getResource(world, Wardrobe);
  const pressed = (k) => input.pressed.some(({ key }) => key.toLowerCase() === k);
  if (pressed('i')) inv.open = !inv.open;
  for (const [id, potion] of Object.entries(inv.potions)) if (pressed(potion.key)) inv.actions.push({ drink: id });

  for (const act of inv.actions.splice(0)) {
    if (act.drink) drink(world, inv, act.drink);
    else if (act.wear !== undefined) {
      const item = inv.bag[act.wear], slot = slotOf(w, item?.file);
      if (!slot) continue;
      const old = w.outfit[slot];
      w.outfit[slot] = item.file;
      if (old) inv.bag[act.wear] = { file: old }; else inv.bag.splice(act.wear, 1);
      w.dirty = true;
      inv.version++;
    } else if (act.takeOff && w.outfit[act.takeOff]) {
      inv.bag.push({ file: w.outfit[act.takeOff] });
      w.outfit[act.takeOff] = null;
      w.dirty = true;
      inv.version++;
    }
  }

  ui.el.hidden = !inv.open;
  if (!inv.open) return;
  if (ui.drawn !== inv.version) draw(inv, w);
  // the doll: made once the window opens, it shows the new outfit when its bake is done
  ui.doll ??= createDoll(ui.el.querySelector('canvas'));
  if (ui.dressed !== w.dressed) {
    ui.dressed = w.dressed;
    ui.doll.show(w.dressed, getResource(world, Voxels).palette.texture);
  }
  ui.el.querySelector('.busy').hidden = !(w.busy || w.dirty);
  ui.doll.draw(getResource(world, Time).dt);
}

// the slot of an item file (items.json) the human can take off, or null
let slots = null;
const slotOf = (w, file) => {
  slots ??= new Map(WORN.flatMap(([slot]) => w.slots[slot].map((it) => [it.file, slot])).reverse());
  return (file && slots.get(file)) ?? null;
};
const nameOf = (w, file) => w.slots[slotOf(w, file)]?.find((it) => it.file === file)?.name ?? file;

// drinks one potion of the bag: its HP and MP come back (not over the max), a text says how much
export function drink(world, inv, id) {
  const e = query(world, [Player, Health, Mana])[0], k = inv.bag.findIndex((it) => it.potion === id);
  if (e === undefined || k < 0 || getComponent(world, e, Player).dead > 0) return;
  const p = getComponent(world, e, Player), h = getComponent(world, e, Health), m = getComponent(world, e, Mana), potion = inv.potions[id];
  const hp = Math.min(potion.hp ?? 0, h.max - h.hp), mp = Math.min(potion.mp ?? 0, m.max - m.mp);
  h.hp += hp;
  m.mp += mp;
  if (--inv.bag[k].count <= 0) inv.bag.splice(k, 1);
  inv.version++;
  sendEvent(world, Damage, { x: p.x, y: (p.y ?? 0) + 1.2, z: p.z, text: potion.hp ? `+${Math.round(hp)} HP` : `+${Math.round(mp)} MP`, human: true, kind: id });
}

// one cell: its picture, its name, and what a click does
function cell(url, name, count, tip, onClick, onHead = false) {
  const b = document.createElement('button');
  b.className = 'cell';
  b.title = `${name}\n${tip}`;
  b.innerHTML = `<img alt=""><span></span>${count ? `<em>${count}</em>` : ''}`;
  b.querySelector('span').textContent = name;
  if (url) ui.preview(url, { onHead }).then((src) => { b.querySelector('img').src = src; }, () => {});
  b.addEventListener('click', (e) => { e.currentTarget.blur(); onClick(); });
  return b;
}

function draw(inv, w) {
  ui.drawn = inv.version;
  const slot = ([s, label, mark]) => {
    const file = w.outfit[s], box = document.createElement('div');
    box.className = 'slot';
    box.dataset.slot = s;
    box.append(file ? cell(PARTS + file + '.glb', nameOf(w, file), 0, 'click: take off', () => inv.actions.push({ takeOff: s }), ON_HEAD.has(s))
      : Object.assign(document.createElement('div'), { className: 'cell empty', textContent: mark }),
    Object.assign(document.createElement('small'), { textContent: label }));
    return box;
  };
  ui.el.querySelector('.left').replaceChildren(...WORN.slice(0, 4).map(slot));
  ui.el.querySelector('.right').replaceChildren(...WORN.slice(4).map(slot));
  ui.el.querySelector('[data-strip]').disabled = !WORN.some(([s]) => w.outfit[s]);
  ui.el.querySelector('h3 small').textContent = `${inv.bag.length} / ${Math.max(CELLS, inv.bag.length)}`;
  const items = inv.bag.map((it, k) => (it.potion
    ? cell(POTIONS + inv.potions[it.potion].model + '.glb', inv.potions[it.potion].name, it.count, 'click: drink', () => inv.actions.push({ drink: it.potion }))
    : cell(PARTS + it.file + '.glb', nameOf(w, it.file), 0, 'click: wear', () => inv.actions.push({ wear: k }), ON_HEAD.has(slotOf(w, it.file)))));
  const empty = Array.from({ length: Math.max(0, CELLS - items.length) }, () => Object.assign(document.createElement('div'), { className: 'cell empty' }));
  ui.el.querySelector('.grid').replaceChildren(...items, ...empty);
}
