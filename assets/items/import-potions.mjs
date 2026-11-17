// Copies the FlyFF models of the potions (potions.json "model") from the FlyFF data folder into models/, and turns
// their textures (.ktx2) into .png in models/textures/ (the helpers of assets/flyff.mjs, which need the zstd command).
//   node assets/items/import-potions.mjs /path/to/data_flyff
import fs from 'node:fs';
import path from 'node:path';
import { copyTexture, texturesOf } from '../flyff.mjs';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node import-potions.mjs /path/to/data_flyff');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'models'), TEX = path.join(OUT, 'textures');
fs.mkdirSync(TEX, { recursive: true });
const { potions } = JSON.parse(fs.readFileSync(path.join(HERE, 'potions.json'), 'utf8'));
for (const { model } of Object.values(potions)) {
  const glb = fs.readFileSync(path.join(SRC, 'models', model + '.glb'));
  fs.writeFileSync(path.join(OUT, model + '.glb'), glb);
  for (const name of texturesOf(glb)) copyTexture(SRC, name, TEX);
}
console.log(Object.keys(potions).length, 'potions');
