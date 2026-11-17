# How we work

Read this first in a new chat. It says how to work on Projet Lambda, where the code is, and how to test it.

## 1. Rules

- `main` (it was `attempt_4`) is the only branch and the live game. All work goes directly on `main`: no test branch.
  The old branches and history were deleted. The text below still uses the old branch names
  (`documentation/branches.md`, section 0).
- Branches and pushing: `documentation/branches.md`. Short version: work on `main`; push only when the user asks.
  The old attempt branches are gone; to bring files from another branch, never `git merge`: copy the files with `git checkout <branch> -- <files>`. `attempt_2` is `attempt_1` plus the voxel
  look (the default, with a loading screen until all is in cubes), the FlyFF decor objects in our style, the sword hits
  of Quaternius, and the FlyFF city Flarine (`?world=flarine`). In Voxel the human always has cubes of 0.5 px. Two ki skills, the Kikoha (R) and the Kamehameha (T), dig holes in the ground. Which assets are FlyFF, ours or archived:
  `documentation/assets.md`, section 7. `attempt_3` is `attempt_2` plus play together: the pages open on the same
  world are together, and the monsters are shared (`documentation/worlds.md`, "Play together"). `attempt_4` is `attempt_3`
  without the Sidekick and Tripo bodies (`documentation/branches.md`).
- Commit messages are in French.
- Screenshots for the user always have labels (a number and a caption for each picture).
- For visual choices, show options and let the user decide. Keep things simple.
- Test scripts and pictures go in the scratchpad, never in the project.
- Keep `documentation/worlds.md` and `documentation/branches.md` up to date.
- `main` is the live game at `https://game.aissabenfodda.ca/` (section 6): the folder `project-lambda` runs it. Each
  time `main` changes, the site must run: do the checks of section 6 before saying the work is done.

## 2. The engine

- Plain JavaScript, Three.js 0.170 from an importmap in `web/index.html`, no build step.
- ECS (`web/ecs/world.js`): components are plain data (`web/components.js`), resources are one of a kind
  (`web/resources.js`), and systems are functions `(world) => void` that run in the order set in `web/main.js`.
  New code follows this rule.
- Set up a computer with one command: `./setup.sh` (section 7). It makes `.venv` (Python packages:
  `requirements.txt`), installs and starts PostgreSQL if it is missing, makes the database and its tables
  (`db/migrations/`) and brings in the old JSON saves once (`db/setup.py`).
- The server is `python3 web/serve.py` (port 8643; it runs itself with the Python of `.venv`). It serves the files of
  `web/`, `assets/` and `worlds/`, and keeps the accounts, logins, rooms, players and admin settings in PostgreSQL
  (`server/db.py`). It is also the network server: a WebSocket at `/net` that passes the messages of the players of one
  world to each other (`web/systems/net.js`). `--lan`: other computers of the network can open it.
- `http://localhost:8643/` is the home page (`web/home.html`): log in, then your worlds. On this computer the game also
  opens without a room: `http://localhost:8643/web/?world=rock-types&char=-2.5,-1`. Fights: `?world=combat&player&look=normal`. The worlds and the address options are in
  `documentation/worlds.md`.

## 3. What exists

| What | Where |
| --- | --- |
| the human (the FlyFF male): parts, clips made of frames, each one posed the first time it is shown (`try/instant-character`), the last 4 outfits kept; sword hits of another skeleton (Quaternius, CC0) moved onto it | `web/lib/character.js`, `web/lib/retarget.js`, `assets/character/player/`, `assets/character/player/ual/` |
| walk, run, jump, attack (4 hits), what stops him | `web/systems/player.js`, `web/lib/tops.js` (rocks and buildings by their shape) |
| clothes, weapons, shields: models, list, import script | `assets/character/player/parts/`, `items.json`, `import-items.mjs` |
| the outfit: the Wardrobe resource, a new outfit is baked again | `web/systems/outfit.js` |
| baking any FlyFF model: load, fix, pose each frame, fine-pass meshes | `web/lib/bake.js` |
| the Admin menu: tabs (Look, Moves, Outfit, Monsters, Human, Objects), sliders, item slots with a picture grid, Save and Default; the pictures of the models saved as PNG files (`pictures/` next to the models), made by `assets/make-pictures.mjs` | `web/systems/admin.js`, `web/lib/preview.js`, `assets/make-pictures.mjs` |
| the monsters: models, list (`monsters.json`), clips per model (`models.json`), levels, import script | `assets/monsters/`, `import-monsters.mjs` |
| the monsters in the game: bake, spawn, calm or angry, death | `web/lib/monsters.js`, `web/systems/monsters.js` |
| fights: stats, damage, chance to hit, XP and levels; blows; the bars and numbers on screen | `web/lib/combat.js`, `web/systems/combat.js`, `web/systems/hud.js` |
| the Monsters and Human parts of the Admin menu | `web/systems/adminFight.js` |
| what stops a walker (the human and the monsters) | `web/lib/walk.js` |
| the look, Normal or Voxel (the switch in the Admin menu, Voxel by default): the converter to cubes, the cubes of the bodies made in a worker that keeps each part (`web/lib/shell.js`, `web/lib/shellWorker.js`), the workers that make them and save them, the cubes of a world made beforehand (`?bake`, `worlds/baked/`), and the swap of what is drawn | `web/lib/voxels.js`, `web/lib/voxelPool.js`, `web/lib/voxelWorker.js`, `web/lib/voxelSaved.js`, `web/systems/voxels.js` |
| the loading screen: a bar until the world is all there in cubes | `web/systems/loading.js` |
| (`try/voxel-perf`) the human and the monsters made of cubes once, the cubes moved with the body (the human always 0.5 px: `try/human-cubes`); the cube maker reads only the rows with cubes, nothing saved in IndexedDB; the shadows of the world drawn once | `web/lib/voxelBody.js`, `web/lib/voxelCore.js`, `web/systems/shadows.js` |
| the 1018 FlyFF decor objects (chairs, boxes, fences, lamps, houses, trees...): models, list (`objects.json`: name, scale for the few made too big or too small, size), import script; in the worlds (recipe `objects`) and the Objects part of the Admin menu, at our sizes, in cubes with the look | `assets/objects/`, `import-objects.mjs`, `web/systems/objects.js`, `web/systems/adminObjects.js` |
| the FlyFF objects in the style of our world: textures turned into our stone and green leaf palettes, drawn with the world | `web/lib/objectStyle.js`, `web/render/shaders.js` (DECOR_FRAG) |
| a part of a FlyFF map as a world (recipe `map`): import script, map files, heights, water, paints, objects at FlyFF size, archived objects, our trees and big-leaf plants for its trees and leafy plants; grass in squares around the camera in a big world | `worlds/maps/`, `web/gen/map.js`, `assets/objects/archived.json`, `web/systems/coverChunks.js` |
| the Vagabond (`?player`): its bag (the human dressed and turning, every worn item taken off or put on: helmet, glasses, clothes, gloves, cloak, boots, weapon, shield; drink), MP, skills on keys 1-4 with skill points, the monster under the mouse, potions dropped by monsters; the recipe `monsters` and their return | `web/systems/inventory.js`, `web/lib/doll.js`, `web/lib/skills.js`, `web/systems/skills.js`, `assets/character/player/skills.json`, `web/lib/screen.js`, `web/systems/drops.js`, `assets/items/` |
| the Kikoha (R) and the Kamehameha (T): ki made of cubes that digs holes in the ground (shapes named in `skills.json` `holes`); their clips made of key poses, skill clips made of several clips | `web/systems/blasts.js`, `web/lib/craters.js`, `web/systems/craters.js`, `web/lib/poses.js` |
| (`try/island-start`) the start of the story: `?world=kame-island`, the Kame House, a boat that takes the human to `?world=beach` (recipe `portals`) | `web/gen/builders/kame-house.js`, `web/gen/builders/boat.js`, `web/systems/portals.js`, `worlds/kame-island.json`, `worlds/beach.json` |
| (`try/island-start`) the people who do not fight (Chichi: the FlyFF female), the talk window, the quests and their line at the top left; the cave (`?world=cave`): crystals, theme and clouds `cave` | `assets/character/npc/`, `web/lib/npc.js`, `web/systems/npcs.js`, `assets/quests/quests.json`, `web/systems/quests.js`, `web/gen/builders/crystal.js`, `worlds/cave.json` |
| (`try/transformation`) the transformation at level 15 (key G), like Super Saiyan: power-up clip (Mesh2Motion, CC0), gold aura of cubes, flash, a free VRoid hair (CC0) that bends into gold Super Saiyan spikes (moved by the head matrix), stronger and faster, MP each second | `web/lib/form.js`, `web/lib/superHair.js`, `web/systems/transform.js`, `web/systems/aura.js`, `skills.json` `transform`, `assets/character/player/m2m/`, `assets/character/player/vroid/` |
| play together (`attempt_3`): the WebSocket of the server, the other players (Peer) and their ki blasts, the host that runs the monsters and the guests that send it their blows | `web/serve.py`, `web/systems/net.js` |
| the home page: log in or make an account, my worlds (Play, Leave or Delete), new world, join a friend with its code | `web/home.html` |
| accounts and rooms in PostgreSQL: tables `accounts`, `sessions`, `rooms`, `room_players`, `settings`; the player of each account in each room saved and put back; admin accounts (`admin` column, the `Admins` tab) | `db/migrations/`, `server/db.py`, `web/serve.py`, `web/lib/room.js`, `web/systems/room.js` |
| the setup of a computer: one command | `setup.sh`, `requirements.txt`, `db/setup.py` |
| the address: online only `?room=<id>`, every other option only on this computer | `web/lib/address.js` |
| saved settings and stats, changed monsters, loaded at start | table `settings` (`admin`, `monsters`); `saves/admin.json` is only the first value, brought in by `./setup.sh` |

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
- The look is Voxel by default: a world is ready only when the loading screen is gone
  (`document.getElementById('loading')` missing or with `dataset.done`); tick until then. With millions of cubes,
  swiftshader takes minutes a frame: use the graphics card instead (`--use-angle=metal --enable-gpu
  --ignore-gpu-blocklist`).
- A big world (Flarine) loads fast only with its cubes made beforehand: open it once with `&bake`
  (`documentation/worlds.md`). Without the file it still works, in about a minute.
- The Browser pane of the app stops the game while it is hidden (no frames): test there only when it is shown.
- Play together: open two pages (two `browser.newContext()`) on the same world with `&name=`; tick both. The first one
  is the host. A page with `?solo` plays alone.

## 6. The live game (game.aissabenfodda.ca)

`main` is played online at `https://game.aissabenfodda.ca/` (the home page, then the game). It runs on this computer
from the folder `project-lambda`, with the database `lambda`. Two programs run, each in its own terminal:

- the game server: `cd /Users/mohamedaissabenfodda/Workspace/projects/project-lambda && python3 web/serve.py` (port 8643);
- the Cloudflare tunnel: `cloudflared tunnel run lambda` (`~/.cloudflared/config.yml` sends `game.aissabenfodda.ca` to
  `http://localhost:8643`).

The site serves the files of the folder as they are, so a change is online at once (the players reload their page).
After each change of `main`:

1. If the tables changed (a new file in `db/migrations/`), run `./setup.sh`.
2. If `web/serve.py` or `server/` changed, stop the game server and start it again (the players reconnect by themselves).
3. Check that the site answers: `curl -s -o /dev/null -w "%{http_code}\n" https://game.aissabenfodda.ca/` must say
   `200`. `502` (Bad Gateway): the game server is stopped (`lsof -iTCP:8643 -sTCP:LISTEN`), start it again. `530` or no
   answer: the tunnel is stopped, start it again.
4. Tests use another port (`LAMBDA_DB=lambda_test python3 web/serve.py 8651`, after `LAMBDA_DB=lambda_test ./setup.sh`),
   never 8643 or the database `lambda`: the players are there.

## 7. Set up a new computer

```bash
git clone git@github.com:Rygaa/lambda.git && cd lambda && ./setup.sh
```

`./setup.sh` (macOS with Homebrew, or Debian/Ubuntu) does all of it, and running it again only does what is missing:

1. Python 3.11 or newer, and the packages of `requirements.txt` in `.venv` (not in git);
2. PostgreSQL: installed (`postgresql@18` with Homebrew, `postgresql` with apt) and started if it does not answer;
3. the database: `lambda` (or the variable `LAMBDA_DB`),
   made if missing; the migrations of `db/migrations/` not applied yet (table `schema_migrations`); the old JSON saves
   of `saves/` brought in once per database (marked `json-saves` in `schema_migrations`: deleted accounts never come
   back; `db/setup.py`). The first account made in a database is an admin.

Then `python3 web/serve.py` and open `http://127.0.0.1:8643/`. A change of the tables is a new file
`db/migrations/NNN_<what>.sql`: `./setup.sh` applies it.

