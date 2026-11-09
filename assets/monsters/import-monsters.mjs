// Copies the FlyFF monsters from the FlyFF data folder: their models (with their clips inside) into models/, their
// textures as .png into models/textures/, and writes
//   monsters.json: one line per monster (data/movers.ron, ai 2) with its model and stats (web/lib/combat.js);
//   models.json: the clips of each model that the game plays, and the time of the blow in its attack clip;
//   levels.json: the experience each level needs and the stat points it gives (data/exp.ron).
//   node assets/monsters/import-monsters.mjs /path/to/data_flyff
// It needs the zstd command (brew install zstd). The helpers are in assets/flyff.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { ronBlocks, ronField, copyTexture, texturesOf } from '../flyff.mjs';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node import-monsters.mjs /path/to/data_flyff');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'models'), TEX = path.join(OUT, 'textures');
fs.mkdirSync(TEX, { recursive: true });
const read = (f) => fs.readFileSync(path.join(SRC, 'data', f), 'utf8').replaceAll('\r', '');   // the files end lines with \r\n

// the "class" of a mover -> its name and its size (FlyFF keeps the size elsewhere: these are ours)
const CLASS = { 1: ['small', 0.8], 2: ['normal', 1], 3: ['captain', 1.2], 4: ['giant', 2], 5: ['guardian', 1.5], 6: ['special', 1], 7: ['boss', 2.5] };
const FPS = 30;             // the frames of data/motions.ron
const HUMAN_SPEED = 0.1;    // the speed of the human in data/movers.ron, which walks at 2.4 (web/resources.js createTuning)
// our clip -> the FlyFF clips to try, in order (a model that has none of them stands instead)
const CLIPS = { idle: ['stand'], wander: ['idle1', 'stand'], walk: ['walk', 'stand'], attack: ['atk1', 'atk2', 'stand'], hit: ['dmg1', 'stand'], dead: ['die1', 'dmg1'] };

// the model of each mover: index -> file name without folder and extension
const modelOf = new Map();
for (const b of ronBlocks(read('models.ron'))) {
  const file = ronField(b, 'model')?.match(/Some\("models\/([^"]+)\.glb"\)/)?.[1];
  if (ronField(b, 'kind') === 'Mover' && file) modelOf.set(Number(ronField(b, 'index')), file);
}
// the hit frames of each clip of each model: "models/x.glb" -> clip -> [frames]
const motions = read('motions.ron'), hitsOf = (file, clip) => {
  const model = motions.slice(motions.indexOf(`"models/${file}.glb": {`));
  const body = model.slice(0, model.indexOf('\n    },'));
  return body.match(new RegExp(`"${clip}": \\(\\s*frames: \\d+,\\s*per_slerp: [\\d.]+,\\s*hits: \\[([^\\]]*)\\]`))?.[1]
    .split(',').map(Number).filter((n) => n > 0) ?? [];
};
// the clips of a .glb file: name -> duration in seconds
const clipsOf = (glb) => {
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  return Object.fromEntries((json.animations ?? []).map((a) => [a.name, Math.max(...a.samplers.map((s) => json.accessors[s.input].max[0]))]));
};

const monsters = [], models = {};   // models: model -> { clips, hitAt }
const num = (b, f) => Number(ronField(b, f));
for (const b of ronBlocks(read('movers.ron'))) {
  const id = num(b, 'id'), level = num(b, 'level'), model = modelOf.get(id);
  if (ronField(b, 'ai') !== '2' || !(level > 0 && level < 1000) || !model) continue;
  if (!models[model]) {
    const glb = fs.readFileSync(path.join(SRC, 'models', model + '.glb'));
    fs.writeFileSync(path.join(OUT, model + '.glb'), glb);
    for (const name of texturesOf(glb)) copyTexture(SRC, name, TEX);
    const have = clipsOf(glb);
    const clips = Object.fromEntries(Object.entries(CLIPS).map(([k, names]) => [k, names.find((n) => n in have)]));
    // the time of the blow in the attack clip; none in the data: the middle of the clip
    models[model] = { clips, hitAt: +((hitsOf(model, clips.attack)[0] ?? have[clips.attack] * FPS / 2) / FPS).toFixed(3) };
  }
  const [kind, size] = CLASS[num(b, 'class')] ?? CLASS[2];
  const atk = [num(b, 'atk_min'), num(b, 'atk_max')].map((n) => Math.max(1, n));
  monsters.push({
    id, name: JSON.parse(ronField(b, 'name')), model, level, class: kind, size,
    hp: num(b, 'add_hp'), damage: [Math.min(...atk), Math.max(...atk)], defense: Math.max(0, num(b, 'natural_armor')),
    attackDelay: Math.max(0.5, num(b, 're_attack_delay') / 1000), walkSpeed: +(num(b, 'speed') / HUMAN_SPEED * 2.4).toFixed(2),
    xp: Math.max(0, num(b, 'exp_value')),
  });
}
monsters.sort((a, b) => a.level - b.level || a.id - b.id);

// levels (the "character" list of data/exp.ron, one row per level): need[i] is the experience to go from level i + 1
// to i + 2, points[i] the stat points of reaching level i + 1
const exp = read('exp.ron'), rows = [...exp.slice(0, exp.indexOf('\n    ],')).matchAll(/exp1: (\d+),\s*exp2: \d+,\s*lp_point: (\d+)/g)];
const need = rows.slice(2).map((r) => Number(r[1])), points = rows.slice(1).map((r) => Number(r[2]));

const write = (name, data) => fs.writeFileSync(path.join(HERE, name), JSON.stringify(data, null, 1) + '\n');
write('monsters.json', { source: 'FlyFF data/movers.ron, models.ron, motions.ron (import-monsters.mjs)', monsters });
write('models.json', { source: 'FlyFF data/motions.ron and the clips of each .glb (import-monsters.mjs)', models: Object.fromEntries(Object.entries(models).sort()) });
write('levels.json', { source: 'FlyFF data/exp.ron (import-monsters.mjs)', need, points });
console.log(monsters.length, 'monsters,', Object.keys(models).length, 'models,', need.length, 'levels');
