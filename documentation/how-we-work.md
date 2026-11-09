# How we work

Read this first in a new chat. It says how to work on Projet Lambda, where the code is, and how to test it.

## 1. Rules

- Branches, moving work to `attempt_1`, and pushing: `documentation/branches.md`. Short version: new work goes on a
  new `try/<name>` branch made from `attempt_1`; push only when the user asks.
- Commit messages are in French.
- Screenshots for the user always have labels (a number and a caption for each picture).
- For visual choices, show options and let the user decide. Keep things simple.
- Test scripts and pictures go in the scratchpad, never in the project.
- Keep `documentation/worlds.md` and `documentation/branches.md` up to date.

## 2. The engine

- Plain JavaScript, Three.js 0.170 from an importmap in `web/index.html`, no build step.
- ECS (`web/ecs/world.js`): components are plain data (`web/components.js`), resources are one of a kind
  (`web/resources.js`), and systems are functions `(world) => void` that run in the order set in `web/main.js`.
  New code follows this rule.
- The server is `python3 web/serve.py` (port 8643). It serves the files, and it writes one file: `saves/admin.json`.
- Open `http://localhost:8643/web/?world=rock-types&char=-2.5,-1`. The worlds and the address options are in
  `documentation/worlds.md`.

## 3. What exists

| What | Where |
| --- | --- |
| the human (the FlyFF male): parts, clips baked into frames at load | `web/lib/character.js`, `assets/character/player/` |
| walk, run, jump, attack (4 hits), what stops him | `web/systems/player.js`, `web/lib/tops.js` (rocks and buildings by their shape) |
| clothes, weapons, shields: models, list, import script | `assets/character/player/parts/`, `items.json`, `import-items.mjs` |
| the outfit: the Wardrobe resource, a new outfit is baked again | `web/systems/outfit.js` |
| the Admin menu: sliders, item slots with a picture grid, Save and Default | `web/systems/admin.js`, `web/lib/preview.js` |
| saved settings, loaded at start | `saves/admin.json` |

## 4. The FlyFF data

All FlyFF models and data are in `/Users/mohamedaissabenfodda/Workspace/data_flyff`:

- `models/*.glb`. Their textures are `.ktx2` files in `textures/model/`, and `import-items.mjs` shows how to turn
  them into `.png` (it needs the `zstd` command). The monster models are `mvr_<name>.glb`.
- `data/movers.ron`: the monsters, with their level, stats, attack, speed, and experience.
- `data/models.ron`: an entry with `kind: Mover, index: <mover id>` gives the model and the clips of a monster.
- `data/motions.ron`: the clips of each model (stand, walk, atk1, dmg1, die1, ...), with their hit frames.
- `data/items.ron`: the items. Many names are in German.

## 5. Testing without a screen

Use Playwright from `/Users/mohamedaissabenfodda/Workspace/projects/residanat/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright`,
with Chromium and `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

- `window.__nature = { world, tick }` gives the ECS world and one frame on demand.
- Wait with `waitForFunction(..., { polling: 500 })`.
- The game runs at about 0 fps there. For exact frames, set `requestAnimationFrame = () => 1` with `addInitScript`,
  call `__nature.tick(t)` yourself, and read the canvas with `toDataURL` in the same `evaluate`. In this mode,
  `page.screenshot` hangs.
- To test clicks in the Admin menu, slow the game instead (`requestAnimationFrame = (cb) => setTimeout(cb, 1000)`), so
  `page.screenshot` works.
