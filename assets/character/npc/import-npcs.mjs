// Copies the FlyFF female (the body mvr_female.glb with its clips, and the parts the people of npcs.json can wear:
// heads, hair, the bare body, and a few outfits) from the FlyFF data folder into this folder and parts/, and turns
// their textures (.ktx2) into .png in parts/textures/. npcs.json (ours, not copied) says who wears what.
//   node assets/character/npc/import-npcs.mjs /path/to/data_flyff
// It needs the zstd command (brew install zstd). The texture helpers are in assets/flyff.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { copyTexture, texturesOf } from '../../flyff.mjs';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node import-npcs.mjs /path/to/data_flyff');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'parts'), TEX = path.join(OUT, 'textures');
fs.mkdirSync(TEX, { recursive: true });

const models = fs.readdirSync(path.join(SRC, 'models'));
const parts = [
  ...models.filter((f) => /^part_female(head|hair)\d+\.glb$/.test(f)).map((f) => f.slice(0, -4)),
  'part_femaleupper', 'part_femalelower', 'part_femalehand', 'part_femalefoot',          // the bare body
  ...models.filter((f) => /^part_fclo(china01|chinese01)/.test(f)).map((f) => f.slice(0, -4)),   // Chinese dresses
];
// some FlyFF clothes (the Chinese dress) keep another mask in the alpha of their texture, but their material is
// opaque (no alphaMode): their texture is made opaque, else the game would cut them away
const opaqueOf = (glb) => !(JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()).materials ?? []).some((m) => m.alphaMode);
const copy = (file, dir) => {
  const glb = fs.readFileSync(path.join(SRC, 'models', file + '.glb'));
  fs.writeFileSync(path.join(dir, file + '.glb'), glb);
  for (const name of texturesOf(glb)) copyTexture(SRC, name, TEX, opaqueOf(glb));
};
copy('mvr_female', HERE);
for (const file of parts) copy(file, OUT);
console.log(`mvr_female and ${parts.length} parts copied`);
