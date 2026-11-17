// Makes the pictures of the admin menu and the bag (web/lib/preview.js) once, so the page does not load and draw a
// 3D model for each picture: one PNG of 96 px per model, in the folder pictures/ next to it, drawn by the same code as
// in the page (createPreview). The models: the clothes, weapons and shields of the human (items.json; a cap or a mask
// as it sits on the head), the monster models at the start of their stand clip (monsters/models.json), the FlyFF decor
// objects (objects/objects.json) and the potions (items/potions.json).
// It starts web/serve.py on its own port and draws in Chromium (Playwright, documentation/how-we-work.md, section 5).
//   node assets/make-pictures.mjs          makes the pictures that are missing (after an import: new models)
//   node assets/make-pictures.mjs --all    makes them all again (after a change of web/lib/preview.js)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAYWRIGHT = '/Users/mohamedaissabenfodda/Workspace/projects/residanat/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright';
const PORT = 8659;
const BATCH = 24;
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT);
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const pictureOf = (glb) => glb.replace(/([^/]*)\.glb$/, 'pictures/$1.png');

// [the .glb from the root, the options of the picture]
const jobs = new Map();
for (const [slot, list] of Object.entries(read('assets/character/player/items.json').slots)) {
  for (const { file } of list) jobs.set(`assets/character/player/parts/${file}.glb`, { onHead: slot === 'cap' || slot === 'mask' });
}
for (const [model, { clips }] of Object.entries(read('assets/monsters/models.json').models)) jobs.set(`assets/monsters/models/${model}.glb`, { clip: clips.idle });
for (const { model } of Object.values(read('assets/objects/objects.json').objects)) jobs.set(`assets/objects/models/${model}.glb`, {});
for (const { model } of Object.values(read('assets/items/potions.json').potions)) jobs.set(`assets/items/models/${model}.glb`, {});
const all = process.argv.includes('--all');
const todo = [...jobs].filter(([glb]) => fs.existsSync(path.join(ROOT, glb)) && (all || !fs.existsSync(path.join(ROOT, pictureOf(glb)))));
console.log(`${jobs.size} models, ${todo.length} pictures to make`);
if (!todo.length) process.exit(0);

const server = spawn('python3', ['web/serve.py', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise((ok) => server.stdout.once('data', ok));
const base = `http://127.0.0.1:${PORT}/web/`;
const importmap = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  // a page of web/ with only the picture maker in it
  await page.route(base + 'pictures.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html>${importmap}
    <script type="module">import { createPreview } from './lib/preview.js'; window.preview = createPreview({ saved: false });</script>` }));
  await page.goto(base + 'pictures.html');
  await page.waitForFunction(() => window.preview);
  let made = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const pictures = await page.evaluate((list) => Promise.all(list.map(([glb, opts]) => window.preview('../' + glb, opts).catch((e) => 'error: ' + e.message))), batch);
    batch.forEach(([glb], k) => {
      if (!pictures[k].startsWith('data:image/png;base64,')) return console.log(`${glb}: ${pictures[k]}`);
      const file = path.join(ROOT, pictureOf(glb));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(pictures[k].split(',')[1], 'base64'));
      made++;
    });
    console.log(`${Math.min(i + BATCH, todo.length)} / ${todo.length}`);
  }
  console.log(`${made} pictures made`);
} finally {
  await browser.close();
  server.kill();
}
