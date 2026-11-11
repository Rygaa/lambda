// Copies the FlyFF decor objects (models/obj_*.glb: chairs, boxes, fences, lamps, tents, houses, trees, rocks... 1018)
// from the FlyFF data folder: their models into models/, their textures as .png into models/textures/, and writes
// objects.json: name -> { model, scale, size }, which the worlds use (recipe "objects", documentation/worlds.md).
//   name: the FlyFF name without obj_ (rustiachair01), and a short English name for a few (NAMES below);
//   scale: 1, except the few models made far too big or too small (their maps scale them: SCALES below);
//   size: [width, height, depth] of the model in FlyFF units, before the scale.
//   node assets/objects/import-objects.mjs /path/to/data_flyff
// It needs the zstd command (brew install zstd). The helpers are in assets/flyff.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { copyTexture, texturesOf, boxOf } from '../flyff.mjs';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node import-objects.mjs /path/to/data_flyff');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'models'), TEX = path.join(OUT, 'textures');
fs.mkdirSync(TEX, { recursive: true });

const SCALES = { rustiachair01: 0.33, rustiapot01: 14, rustiafirewood01: 4 };
// short names for the first 30 (the flyff-objects world)
const NAMES = {
  'log-chair': 'rustiachair01', pot: 'rustiapot01', firewood: 'rustiafirewood01', bench: 'masaprbench01', 'small-bench': 'maflprbenc01',
  box: 'rustiabox02', 'treasure-box': 'rustiatreasurebox01', 'big-crate': 'madaprbigbox01', crate: 'madaprmiddlebox01',
  drum: 'madaprdrum01', 'wood-pot': 'rustiawoodpot01', 'fire-pot': 'dudkcoprfirepot01', fence: 'rustiafence01',
  'long-fence': 'masapufence01', 'fence-post': 'maflprfe01', 'signal-lamp': 'madaprsignallamp', 'street-light': 'masaprstli01',
  lamp: 'maflprla01', flag: 'rustiaflag01', banner: 'masaprflag01', scarecrow: 'masapuscarecrow01', 'pumpkin-pole': 'masapumkinpole01',
  'flower-bed': 'masaprflowerbed', wagon: 'masawagon01', 'small-wagon': 'madaprwagonsmall01', tent: 'dudkkitent01', hut: 'rustiahut01',
  'clay-pot': 'maflprpo01', rack: 'maflprrack01', 'big-tent': 'maflprte01',
};

const objects = {}, round = (x) => +x.toFixed(2);
const files = fs.readdirSync(path.join(SRC, 'models')).filter((f) => /^obj_.*\.glb$/.test(f)).sort();
for (const f of files) {
  const glb = fs.readFileSync(path.join(SRC, 'models', f)), box = boxOf(glb), model = f.slice(0, -4), name = model.slice(4).trim();
  if (!box) continue;
  fs.writeFileSync(path.join(OUT, f), glb);
  for (const tex of texturesOf(glb)) copyTexture(SRC, tex, TEX);
  objects[name] = { model, scale: SCALES[name] ?? 1, size: [box[3] - box[0], box[4] - box[1], box[5] - box[2]].map(round) };
}
for (const [name, flyff] of Object.entries(NAMES)) objects[name] = objects[flyff];
fs.writeFileSync(path.join(HERE, 'objects.json'), JSON.stringify({ source: 'FlyFF models/obj_*.glb (import-objects.mjs)', objects }) + '\n');
console.log(files.length, 'models,', Object.keys(objects).length, 'names');
