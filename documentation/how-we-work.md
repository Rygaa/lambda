# How we work

Read this first in a new chat. It says how to work on Projet Lambda, where the code is, and how to test it.

## 1. Rules

- Branches, moving work to `attempt_1`, and pushing: `documentation/branches.md`. Short version: new work goes on a
  new `try/<name>` branch made from `attempt_1`; push only when the user asks. `attempt_2` is `attempt_1` plus the
  voxel look and the FlyFF decor objects in our style.
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
- The server is `python3 web/serve.py` (port 8643). It serves the files, and it writes two files: `saves/admin.json`
  and `saves/monsters.json`.
- Open `http://localhost:8643/web/?world=rock-types&char=-2.5,-1`. The worlds and the address options are in
  `documentation/worlds.md`.

## 3. What exists

| What | Where |
| --- | --- |
| the human (the FlyFF male): parts, clips baked into frames at load; sword hits of another skeleton (Quaternius, CC0) moved onto it | `web/lib/character.js`, `web/lib/retarget.js`, `assets/character/player/`, `assets/character/player/ual/` |
| walk, run, jump, attack (4 hits), what stops him | `web/systems/player.js`, `web/lib/tops.js` (rocks and buildings by their shape) |
| clothes, weapons, shields: models, list, import script | `assets/character/player/parts/`, `items.json`, `import-items.mjs` |
| the outfit: the Wardrobe resource, a new outfit is baked again | `web/systems/outfit.js` |
| baking any FlyFF model: load, fix, pose each frame, fine-pass meshes | `web/lib/bake.js` |
| the Admin menu: sliders, item slots with a picture grid, Save and Default | `web/systems/admin.js`, `web/lib/preview.js` |
| the monsters: models, list (`monsters.json`), clips per model (`models.json`), levels, import script | `assets/monsters/`, `import-monsters.mjs` |
| the monsters in the game: bake, spawn, calm or angry, death | `web/lib/monsters.js`, `web/systems/monsters.js` |
| fights: stats, damage, chance to hit, XP and levels; blows; the bars and numbers on screen | `web/lib/combat.js`, `web/systems/combat.js`, `web/systems/hud.js` |
| the Monsters and Human parts of the Admin menu | `web/systems/adminFight.js` |
| what stops a walker (the human and the monsters) | `web/lib/walk.js` |
| the look, Normal or Voxel (the switch in the Admin menu): the converter to cubes, the workers that make them and save them, and the swap of what is drawn | `web/lib/voxels.js`, `web/lib/voxelPool.js`, `web/lib/voxelWorker.js`, `web/systems/voxels.js` |
| the 1018 FlyFF decor objects (chairs, boxes, fences, lamps, houses, trees...): models, list (`objects.json`: name, scale for the few made too big or too small, size), import script; in the worlds (recipe `objects`) and the Objects part of the Admin menu, at our sizes, in cubes with the look | `assets/objects/`, `import-objects.mjs`, `web/systems/objects.js`, `web/systems/adminObjects.js` |
| the FlyFF objects in the style of our world: textures turned into our stone and green leaf palettes, drawn with the world | `web/lib/objectStyle.js`, `web/render/shaders.js` (DECOR_FRAG) |
| a part of a FlyFF map as a world (recipe `map`): import script, map files, heights, water, paints, objects at FlyFF size, archived objects, our trees and big-leaf plants for its trees and leafy plants; grass in squares around the camera in a big world | `worlds/maps/`, `web/gen/map.js`, `assets/objects/archived.json`, `web/systems/coverChunks.js` |
| saved settings and stats, changed monsters, loaded at start | `saves/admin.json`, `saves/monsters.json` |

## 4. The FlyFF data

All FlyFF models and data are in `/Users/mohamedaissabenfodda/Workspace/data_flyff`:

- `models/*.glb`. Their textures are `.ktx2` files in `textures/model/`; `assets/flyff.mjs` turns them into `.png`
  (it needs the `zstd` command) and reads the `.ron` files. The monster models are `mvr_<name>.glb`, with their
  clips inside.
- The `.ron` files end their lines with `\r\n`: remove the `\r` before you read them.
- `data/movers.ron`: the monsters (`ai: 2`), with their level, stats, attack, speed, and experience.
- `data/exp.ron`: the experience of each level and the stat points it gives.
- `data/models.ron`: an entry with `kind: Mover, index: <mover id>` gives the model and the clips of a monster.
- `data/motions.ron`: the clips of each model (stand, walk, atk1, dmg1, die1, ...), with their hit frames.
- `data/items.ron`: the items. Many names are in German.
- `models/obj_*.glb`: 1018 decor objects (chairs, boxes, fences, lamps, tents, houses, trees, rocks of each region).
  Their size is the one next to the FlyFF human, except a few (their maps scale them). The ones we will delete later
  (the FlyFF trees and leafy plants, the objects that float in the air) are listed, with why, in `assets/objects/archived.json`.

Which assets come from FlyFF, which are ours, and which are archived: `documentation/assets.md`, section 7.

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
