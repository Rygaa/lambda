// The bag of the human (the Inventory resource): its window (the I key, or the Bag button of the skill bar) shows the
// weapon and the shield it wears and a grid of what it carries, each with its picture (lib/preview.js).
//   a click on a weapon or a shield in the bag puts it on (what was worn goes to the bag); a click on a worn one puts
//   it in the bag. The outfit changes at once (the Wardrobe resource), its new look is baked (systems/outfit.js).
//   a click on a potion, or its key (assets/items/potions.json: 5 HP, 6 MP), drinks one: HP and MP come back.
// The potions on the ground go into the bag in systems/drops.js.
import { query, getComponent, getResource, sendEvent } from '../ecs/world.js';
import { Player, Health, Mana } from '../components.js';
import { Inventory, Input, Wardrobe } from '../resources.js';
import { Damage } from '../events.js';
import { createPreview } from '../lib/preview.js';

const PARTS = '../assets/character/player/parts/', POTIONS = '../assets/items/models/';
const WORN = [['weapon', 'Weapon'], ['shield', 'Shield']];

let ui = null;   // its window, and what it last drew (setupInventorySystem)

export function setupInventorySystem(world) {
  const el = document.createElement('div');
  el.id = 'inventory';
  el.hidden = true;
  el.innerHTML = '<header><b>Bag</b><span>click: wear, drink</span><button data-close>×</button></header><div class="worn"></div><h3>Carried</h3><div class="grid"></div>';
  document.body.append(el);
  ui = { el, drawn: -1, preview: createPreview() };
  el.querySelector('[data-close]').addEventListener('click', () => { getResource(world, Inventory).open = false; });
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
  if (inv.open && ui.drawn !== inv.version) draw(world, inv, w);
}

// the slot of a weapon or a shield file (items.json), or null
const slotOf = (w, file) => (file ? WORN.map(([slot]) => slot).find((slot) => w.slots[slot].some((it) => it.file === file)) ?? null : null);
const nameOf = (w, slot, file) => w.slots[slot].find((it) => it.file === file)?.name ?? file;

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
function cell(url, name, count, onClick) {
  const b = document.createElement('button');
  b.className = 'cell';
  b.title = name;
  b.innerHTML = `<img alt=""><span></span>${count ? `<em>× ${count}</em>` : ''}`;
  b.querySelector('span').textContent = name;
  if (url) ui.preview(url).then((src) => { b.querySelector('img').src = src; }, () => {});
  b.addEventListener('click', (e) => { e.currentTarget.blur(); onClick(); });
  return b;
}

function draw(world, inv, w) {
  ui.drawn = inv.version;
  const worn = ui.el.querySelector('.worn'), grid = ui.el.querySelector('.grid');
  worn.replaceChildren(...WORN.map(([slot, label]) => {
    const file = w.outfit[slot], box = document.createElement('div');
    box.className = 'slot';
    box.append(Object.assign(document.createElement('small'), { textContent: label }),
      file ? cell(PARTS + file + '.glb', nameOf(w, slot, file), 0, () => inv.actions.push({ takeOff: slot })) : Object.assign(document.createElement('div'), { className: 'cell empty', textContent: 'none' }));
    return box;
  }));
  grid.replaceChildren(...inv.bag.map((it, k) => (it.potion
    ? cell(POTIONS + inv.potions[it.potion].model + '.glb', inv.potions[it.potion].name, it.count, () => inv.actions.push({ drink: it.potion }))
    : cell(PARTS + it.file + '.glb', nameOf(w, slotOf(w, it.file), it.file), 0, () => inv.actions.push({ wear: k })))));
  if (!inv.bag.length) grid.append(Object.assign(document.createElement('small'), { textContent: 'nothing' }));
}
