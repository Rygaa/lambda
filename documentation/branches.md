# Branches

This guide says how to work with `attempt_1`, the official branch of Projet Lambda, and with the other branches.

## 1. The idea

- `attempt_1` is the official version: stable, well structured, and it changes little.
- Every other branch is a place to try ideas. A try can be messy, and it can fail.
- A piece moves to `attempt_1` only when it works and is clean.
- `attempt_2` is made from `attempt_1`, with the same rules. It adds the voxel look (the `Look` switch: Normal or
  Voxel) and the 1018 FlyFF decor objects in the style of our world (the recipe `objects` and the Objects part of the
  Admin menu). It came from `try/voxel-switch`, `try/flyff-objects` and `try/flyff-style`, without their variants:
  the objects are only in our style (not with their FlyFF textures). Then came `try/attack-move` and
  `try/ual-attacks`: the human keeps walking while it hits, and its 4 sword hits come from Quaternius (CC0). Then came
  `try/flarine-city`: the centre of the FlyFF city Flarine as a world (`?world=flarine`, the recipe `map`), with our
  oaks and our big-leaf plants in place of its FlyFF trees and plants (the archived FlyFF objects:
  `assets/objects/archived.json`; which assets are FlyFF, ours or archived: `assets.md`, section 7). Then came
  `try/voxel-fast`: the Voxel look by default, a loading screen until the world is all in cubes, and the cubes of a
  world made beforehand (`&bake`, `worlds/baked/`). Then came `try/combat`: fights like League of Legends in the small
  world `?world=combat`, a player (`?player`) who starts as a Vagabond with its bag, MP, 4 skills opened with skill
  points, and potions dropped by the monsters (`worlds.md`, "The Vagabond").

The official copy is on GitHub, in `Rygaa/lambda`.

## 2. What is in `attempt_1`

| Path | What it is |
| --- | --- |
| `assets/` | the asset files: one folder per type (`assets/<family>/<type>/<family>.json`), the colours (`palettes.json`), the render settings (`render.json`), and the sprite textures |
| `worlds/` | the world recipes (see `documentation/worlds.md`) |
| `web/` | the code that makes and draws the worlds, in the browser (`web/serve.py`) |
| `documentation/branches.md` | this guide |
| `documentation/how-we-work.md` | how to work on the project, where the code is, and how to test it: read it first in a new chat |
| `documentation/assets.md` | how the assets are sorted and named, and the plan to build it |
| `documentation/worlds.md` | how to open a world, and how to write one |
| `documentation/building/` | how to build a building from a reference image, with examples and tools (see its `README.md`) |
| `documentation/style/` | the style rules (`rules.md`) and the article they come from |

The code here makes and draws the nature only: water, rocks, plants, and terrain, seen from the top. There is no
player, server, or building yet. Some guides name paths that are not here: `packages/renderer` and
`apps/asset-studio/` are on the `gpt` branch, and `game/` is on the `game` and `voxel` branches. These paths are real
only after they move here.

## 3. The rules of `attempt_1`

1. Never try an idea on `attempt_1`. Try it on another branch.
2. Only finished work comes here: it works, it is tested, and it has no leftovers of the try.
3. Keep changes few and small. One commit does one thing.
4. Update the documentation in the same commit as the change.
5. A new folder at the top of the repo is a decision. Add it to section 2 in the same commit.
6. Never force push, and never rewrite the history of this branch.

## 4. Try an idea

Start a new branch from `attempt_1`. Its name is `try/` and the idea:

```bash
git switch attempt_1
git pull git@github.com:Rygaa/lambda.git attempt_1
git switch -c try/my-idea
```

On a `try/` branch, everything is allowed. If the idea needs code from an old branch, copy that code in (see section
5 for the command).

When the try is done, add it to the table in section 6, even if it failed. Keep the branch: a failed try shows what not
to do again.

## 5. Move an idea to `attempt_1`

1. Decide what worked. Keep only that.
2. Copy only the files you need:

   ```bash
   git switch attempt_1
   git checkout try/my-idea -- path/to/the/files
   ```

3. Clean them: remove the debug code, the old variants, and the settings that were only for the try.
4. Put them in the right place, and update the documentation.
5. Check that it works from `attempt_1`, not only from the try.
6. Commit, then push to GitHub:

   ```bash
   git push git@github.com:Rygaa/lambda.git attempt_1
   ```

Never use `git merge` to bring a branch into `attempt_1`:

- A merge brings the whole try, not only the good part.
- `voxel`, `game`, `backup`, and `claude/building-docs` are already in the history of `attempt_1`. `git merge voxel`
  says "Already up to date" and copies nothing, so use `git checkout` as above.

## 6. The branches

These branches stay as they are. Read them and copy from them, but do not build on them.

| Branch | What it has | State |
| --- | --- | --- |
| `gpt` | the asset studio with Infer, `packages/renderer`, `packages/asset-format`, `assets/` | old try, same commit as GitHub `main` |
| `game` | the online game: one server, island map, 4 buildings, monsters, items, inventory, pet cube | old try |
| `voxel` | `game` plus the voxel engine, terrain chunks in Web Workers, exploding stones, Kikoha, zoom, FPS | old try, the most recent |
| `docs` | `documentation/`, `game/README.md`, `game/assets/README.md` | replaced by `attempt_1` |
| `backup` | documentation only, up to Raditz's space pod | old state of the documentation |
| `claude/building-docs` | documentation only, up to the Capsule Corp ship | old state of the documentation |
| `claude/work`, `main-2` | only a `.gitignore` | empty start |
| `try/nature` | the nature of `pixel-scene` version-3 (commit `9da4216`), sorted with the names of `assets.md` | try, moved to `attempt_1` |
| `try/mountain-ends` | the free ends of mountain borders stop tier by tier on wavy lines, not in one flat cut | try, moved to `attempt_1` |
| `try/no-wall-rocks` | no small rocks stuck on the cliff walls, and the rule against such fake details | try, moved to `attempt_1` |
| `try/plants` | tree, bush, and palm leaves are one medium leaf with 2 tiny ones, not round spots (the tree shapes stay the same) | try, moved to `attempt_1` |
| `try/tree-types` | 6 new tree types: pine, fir, cypress, birch, willow, fruit (the canopy `form` of the `tree` builder) | try, moved to `attempt_1` |
| `try/rock-types` | 4 new rock types: slab, stack, cluster, split (the `rock-form` builder) | try, moved to `attempt_1` |
| `try/character` | the fixed human of `backup` (the FlyFF male of the `voxel` branch), drawn 4 times finer than the world | try, moved to `attempt_1` |
| `try/walk` | the human walks with the arrows (idle and walk clips), the camera follows it | try, moved to `attempt_1` |
| `try/admin` | the human runs with Shift; the Admin button opens a menu for the walk speed, the run speed, and the zoom | try, moved to `attempt_1` |
| `try/jump` | Space makes the human jump (the 4 parts of the jump clip); the Admin menu changes the jump height | try, moved to `attempt_1` |
| `try/attack` | a click (or F) attacks, 4 hits in a row; rocks and buildings stop the human by their real shape, so it can jump onto them | try, moved to `attempt_1` |
| `try/clothes` | the Admin menu changes the clothes of the human: every male part of the FlyFF data (head, hair, clothes, gloves, shoes, cap, cloak, mask) | try, moved to `attempt_1` |
| `try/items` | the weapons and shields of the FlyFF data in the Admin menu (held on the hand and shield bones); each slot opens a grid of pictures of its items; Save and Default buttons (saves/admin.json) | try, moved to `attempt_1` |
| `try/how-we-work` | `documentation/how-we-work.md`: the rules, the code map, the FlyFF data, and how to test, for a new chat | try, moved to `attempt_1` |
| `try/monsters` | the 569 FlyFF monsters (127 models, their clips); the Admin menu edits them and spawns them; they fight back when hit; the human has STR, STA, levels, and XP; HP bars and damage numbers | try, moved to `attempt_1` |
| `try/voxel-switch` | a `Look` switch in the Admin menu: Normal, or Voxel (the converter of the `voxel` branch, ported to `web/`), with the cube size and light; the cubes are made by one worker per core and saved in the browser | try, moved to `attempt_2` |
| `try/flyff-objects` | (made from `try/voxel-switch`) the 1018 FlyFF decor objects imported (chairs, boxes, fences, lamps, houses, trees...), placed by the recipe `objects` or by the Objects part of the Admin menu (a grid with a search box), drawn with their textures and made of cubes by the `Look` switch; the `flyff-objects` world shows 30 | try, moved to `attempt_2` |
| `try/flyff-style` | (made from `try/flyff-objects`) the FlyFF objects in the style of our world: drawn with the world, their textures turned into our stone and green leaf palettes and smoothed ("flat palettes", picked over one palette per part and one per texel); the default, with FlyFF textures as a choice in the Look part of the Admin menu; their sizes brought to ours (big ones shrink most, at most 6 m) | try, moved to `attempt_2` |
| `try/attack-move` | (made from `attempt_2`) the human keeps walking while it attacks: its legs walk or run and the rest of it hits (clips mixed by bones, `attack1Walk`, `attack1Run`...), the hit goes where it faces | try, moved to `attempt_2` |
| `try/ual-attacks` | (made from `try/attack-move`) the 4 hits of the human are sword hits of the Universal Animation Library 1 and 2 of Quaternius (CC0, `assets/character/player/ual/`), moved onto the FlyFF skeleton (`web/lib/retarget.js`); its legs still walk or run while it hits; when no hit follows, the hit ends with its way back (`recover`) melting into idle, walk or run, instead of jumping to idle | try, moved to `attempt_2` |
| `try/flarine-city` | (made from `attempt_2`) the centre of the FlyFF city Flarine (3 squares, bridges, river) as a world, as in FlyFF: the recipe `map` (`worlds/maps/flarine.json`, made by `worlds/maps/import-map.mjs` from the FlyFF land files and objects), with its ground heights, river, ground textures as our paints, and 2389 decor objects at FlyFF size; walkers follow the ground, the river stops them, they walk on bridges and floors (`addReachable`); its streets in brown bricks (`"pavement": "bricks"`); grass in squares around the camera (`web/systems/coverChunks.js`); the FlyFF objects turned the right way; the FlyFF trees, leafy plants and floating objects archived (`assets/objects/archived.json`), with our oaks and `plant/leafy` (the form of the 3 FlyFF plants, in our style) in place of the trees and plants | try, moved to `attempt_2` |
| `try/voxel-fast` | (made from `attempt_2`) the Voxel look by default (cubes of 1 px; 0.5 px is too much for the human: 5 GB); a loading screen until the world is all in cubes; the cubes of a shape or a FlyFF model made once and shared by its copies; the ground of a FlyFF map not in cubes; giant trees get bigger cubes; leaves seen from both sides no longer dark in cubes; the cubes of a world made beforehand (`&bake`, `worlds/baked/<world>.bin`, not in git): Flarine ready in about 20 s in a new browser, instead of never | try, moved to `attempt_2` |
| `try/voxel-perf` | (made from `attempt_2`) the Voxel look much faster with the same cubes: the cube maker reads only the rows that hold cubes (`web/lib/voxelCore.js`), nothing saved in IndexedDB, no copy of the cubes kept in the page; the human and the monsters made of cubes once and their cubes moved with the body, on its grid (`web/lib/voxelBody.js`); the shadows of the world drawn once, the bodies alone when they move. Flarine with no saved file: 59 s and 3.4 GB before, 17 s and 0.26 GB after (Normal: 12 s), FPS the same; 4 monsters: 45 s and 7.6 GB before, 5 s and 0.5 GB after; test world `voxel-bench`. Backup of `attempt_2` before it: `attempt_2-backup-2026-11-12` | try, moved to `attempt_2` |
| `try/combat` | (made from `attempt_2`) fights like League of Legends in a small world (`?world=combat`): a player (`?player`) starts as a Vagabond with a wooden sword and shield in its bag (not worn), punches without a weapon, MP, 4 skills on keys 1-4 opened with skill points (Dash Strike behind the monster under the mouse, the combo Triple Slash, Keen Wheel, Shield Bash), monsters placed by the recipe `monsters` that come back, HP and MP potions they drop | try, moved to `attempt_2` |
