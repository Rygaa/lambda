// Copies the parts of the FlyFF male (heads, hair, every piece of clothing) and every weapon and shield from the
// FlyFF data folder into parts/, turns their textures (.ktx2: BC1, BC2 or BC3 blocks, zstd) into .png in
// parts/textures/, and writes items.json: the list of each slot that the admin menu shows (web/systems/admin.js).
//   node assets/character/player/import-items.mjs /path/to/data_flyff
// It needs the zstd command (brew install zstd). The texture helpers are in assets/flyff.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { copyTexture, texturesOf } from '../../flyff.mjs';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node import-items.mjs /path/to/data_flyff');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'parts'), TEX = path.join(OUT, 'textures');
fs.mkdirSync(TEX, { recursive: true });

// the "parts" value of an item (data/items.ron) -> its slot; 26 to 29 are the costume pieces
const SLOT = { 2: 'upper', 27: 'upper', 4: 'hand', 28: 'hand', 5: 'foot', 29: 'foot', 6: 'cap', 26: 'cap', 8: 'cloak', 12: 'mask' };
const IGNORE = { 0: 'head', 1: 'hair' };   // base_parts_ignore: the part of the body a cap hides
// weapon_type -> where it is held (an attach point of the skeleton); the others: the right hand
const HOLD = { 4: ['knuckle'], 20: ['rhand', 'lhand'], 21: ['lhand'] };   // knuckles, yoyos (one in each hand), bows

const slots = { head: [], hair: [], upper: [], hand: [], foot: [], cap: [], cloak: [], mask: [], weapon: [], shield: [] };
const files = new Set();
const add = (slot, file, name, extra = {}) => { files.add(file); slots[slot].push({ name, file, ...extra }); };

const models = fs.readdirSync(path.join(SRC, 'models'));
for (const m of models.filter((f) => /^part_malehead\d+\.glb$/.test(f)).sort()) add('head', m.slice(0, -4), 'Head ' + m.match(/\d+/)[0]);
for (const m of models.filter((f) => /^part_malehair\d+\.glb$/.test(f)).sort()) add('hair', m.slice(0, -4), 'Hair ' + m.match(/\d+/)[0]);
for (const f of ['part_maleupper', 'part_malelower', 'part_malehand', 'part_malefoot']) files.add(f);   // the bare body

const items = fs.readFileSync(path.join(SRC, 'data/items.ron'), 'utf8');
for (const [, body] of items.matchAll(/\(\s*id: \d+,(.*?)\n    \)/gs)) {
  const model = body.match(/part_models: Some\(\("models\/([^"]+)\.glb"/)?.[1];
  const slot = SLOT[body.match(/parts: (\d+)/)?.[1]];
  if (!model || !slot || body.match(/sex: (\d+)/)[1] === '1' || files.has(model)) continue;
  if (!fs.existsSync(path.join(SRC, 'models', model + '.glb'))) continue;
  const hides = IGNORE[body.match(/base_parts_ignore: (\d+)/)[1]];
  add(slot, model, body.match(/name: "([^"]*)"/)[1] || model, hides ? { hides } : {});
}
// weapons (parts 10) and shields (parts 11): one model, not skinned, held on an attach point. bothHands: no shield
for (const [, body] of items.matchAll(/\(\s*id: \d+,(.*?)\n    \)/gs)) {
  const model = body.match(/model: Some\("models\/([^"]+)\.glb"\)/)?.[1], parts = body.match(/parts: (\d+)/)?.[1];
  if (!model || (parts !== '10' && parts !== '11') || files.has(model)) continue;
  if (!fs.existsSync(path.join(SRC, 'models', model + '.glb'))) continue;
  const name = body.match(/name: "([^"]*)"/)[1] || model;
  if (parts === '11') { add('shield', model, name, { hold: ['shield'] }); continue; }
  add('weapon', model, name, { hold: HOLD[body.match(/weapon_type: (\d+)/)[1]] ?? ['rhand'], ...(body.match(/handed: (\d+)/)[1] === '2' ? { bothHands: true } : {}) });
}

// the .glb files and their textures
let n = 0;
for (const file of files) {
  const glb = fs.readFileSync(path.join(SRC, 'models', file + '.glb'));
  fs.writeFileSync(path.join(OUT, file + '.glb'), glb);
  for (const name of texturesOf(glb)) copyTexture(SRC, name, TEX);
  if (++n % 100 === 0) console.log(n, '/', files.size);
}
fs.writeFileSync(path.join(HERE, 'items.json'), JSON.stringify({ source: 'FlyFF data/items.ron (import-items.mjs)', slots }, null, 1) + '\n');
console.log(files.size, 'parts;', Object.entries(slots).map(([k, v]) => `${k} ${v.length}`).join(', '));
