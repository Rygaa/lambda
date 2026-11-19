# Worlds

This guide says how to open a world and how to write one. The nature (water, rocks, plants, terrain) comes from
`pixel-scene` version-3 (commit `9da4216`), sorted with the names of `assets.md`.

## 1. Open a world

```bash
python3 web/serve.py
```

Then open `http://127.0.0.1:8643/web/?world=all-types`.

The options below work only on this computer (`localhost`, `127.0.0.1`: the tests). Online (`game.aissabenfodda.ca`)
the address holds only the room, `?room=<id>` (`web/lib/address.js`): the page reads nothing else and takes the rest
away from the address bar. The world comes from the game (the world saved in the room, the portals, else
`kame-island`), the mode from the account (an admin account has the Admin menu, every other one is a Vagabond:
"Accounts" below), the look is the default (Voxel), and the name is the username in a room (else `Player <number>`).

- `?world=<name>`: a file of `worlds/`. The default is `kame-island` (the start of the story).
- `?seed=<number>`: the same recipe with new shapes and new places.
- `?theme=dbz` or `?theme=namek`: other colours (see section 6).
- `?freeze`: time stops (for screenshots that must match pixel by pixel).
- `?char=<x>,<z>`: where the human stands. The default is the start of the world. `?nochar`: no human.
- `?player`: a player, not the admin: a Vagabond at level 1 (section "The Vagabond" below), with no Admin button,
  and nothing of `saves/admin.json` (outfit, stats). Nothing is saved: a reload starts a new Vagabond.
- `?look=normal` or `?look=voxel`: wins over the saved look (a test in `normal` does not wait for cubes).
- `?name=<name>`: the name the other players see over your head (default `Player <number>`). `?solo`: play alone
  (section "Play together").

Keys: the arrows (or W A S D, or Z Q S D) make the human walk, Shift makes it run, Space makes it jump, a click (or
`F`) attacks (click again for the next of 4 hits), and the camera follows it (with `?nochar`, the arrows move the
camera). The wheel zooms, `C` stops or starts the clouds. The `Admin` button at the top left opens a menu. Its `Look` part
switches between `Normal` and `Voxel` (the default): rocks, plants, cliffs, FlyFF objects, the human and the monsters
are drawn with small cubes, with the cube size in pixels (0.5 to 6, 1 by default; rocks, plants and cliffs stop at 1,
because nothing smaller than a pixel shows on them; the people always have cubes of 0.5 px, whatever the cube size:
`HUMAN_PX` in `web/lib/voxels.js`), the `Character cube size` (0.5 to 6, 0.5 by default: the cubes of the human you
play only, nothing else changes; `playerPx` of the Look) and its light (`like the shape` or `each face`). Only the picture changes: the shapes, what stops the human,
and the fights stay the same (`web/lib/voxels.js`, `web/systems/voxels.js`). Leaves, water, grass and the ground stay
as they are (the ground of a FlyFF map too). The cubes of a shape or a FlyFF model are made once and every copy uses
them, turned with it. They are made by workers, one per core of the computer but one, for the world and the bodies
alike (`web/lib/voxelPool.js`, `web/lib/voxelWorker.js`).

Since `try/voxel-perf`, the Voxel look loads much faster and with much less memory, with the same cubes:

- Making the cubes (`web/lib/voxelCore.js`) reads only the rows of the box that hold cubes, not the millions of empty
  cells around a shape: the inside fill and the merging of faces look only at the visible faces. The cubes made are
  exactly the same as before (checked voxel by voxel).
- Nothing is saved in the browser any more (IndexedDB took GBs): the cubes are made again at each load. Once a cube
  mesh is on the GPU, the page drops its own copy (`web/lib/voxels.js` toGeometry).
- The human and the monsters get their cubes once, not once per frame (the human has 907): the cubes of the first idle
  frame, each one tied to its place on a triangle of the body; in every frame each cube follows that place and goes
  back to the grid of the body (`web/lib/voxelBody.js`, drawn as instances of one cube). The places are taken 2 times
  closer than the cubes, so no hole opens where the body stretches. `?bodies=free` leaves the cubes off the grid,
  `?bodies=frames` makes the cubes of every frame as before (to compare).

The frames of the human, the monsters and the people (about 900 for the human: walk, run, jump, hits...) are not all
posed at load: each frame is posed the first time it is shown, then kept (`web/lib/bake.js` bakeClips, lazyFrames,
about 1.5 ms a frame). At load and for a new outfit only the first idle frame is posed, then the body is made of
cubes from it (`web/lib/voxelBody.js`) by a worker (`web/lib/shell.js`, `web/lib/shellWorker.js`), so the game goes on
meanwhile. The worker keeps the cubes of each part (the last 64): a new outfit makes again only the parts that changed
(a new sword: only the sword), then puts them together as if all were made at once. The outside of the body is found
a row of cells at a time. The human keeps its old outfit until the new one is ready: about 0.1 s for a new outfit
(before: about 2 s). The last 4 outfits stay in memory (Wardrobe `worn`, `web/systems/outfit.js`), so an outfit worn
before comes back at once. The frames and the cubes are the same as before (checked frame by frame on about 11 000
frames, and cube by cube against the old cube maker after many outfit changes).

The shadows of the world are drawn once into their own map; when only the human or the monsters move, they are drawn
alone on a copy of it (`web/systems/shadows.js`).

A loading screen with a bar covers the page until the world is all there, in cubes (`web/systems/loading.js`). To
make a world load fast even the first time, make its cubes beforehand: open it once with `&bake`
(`?world=flarine&bake`); when the loading screen is gone, the page sends all its cubes to `web/serve.py`, which writes
`worlds/baked/<world>.bin` (`web/lib/voxelSaved.js`). The next loads read that file and need no worker: Flarine is
ready in about 20 s instead of 50. A job not in the file (the world, a shape, the outfit or the look changed since)
is made as before, so an old file is never wrong, only slower: bake again after a change. The files are big (Flarine:
hundreds of MB, most for the frames of the human), so git leaves them out (`.gitignore`). The menu also changes
the walk speed, the run speed, the jump height, and the zoom while the game runs (`web/systems/admin.js`), and the
clothes and weapons of the human: head, hair, clothes, gloves, shoes, cap, cloak, mask, weapon, and shield
(`web/systems/outfit.js`). Each slot opens a grid of pictures of its items, so you see an item before you put it on
(`web/lib/preview.js`). The menu has tabs, one part at a time: `Look`, `Moves` (the sliders), `Outfit` (the slots, each
with the picture of the item worn), `Monsters`, `Human` and `Objects`; `Save` and `Default` stay at the bottom, and the
menu opens on the last tab. The pictures (items, monster models, objects, potions) are PNG files of 96 px saved in
`pictures/` next to the models, so the page loads no 3D model for them; a model with no picture file is drawn in the
page as before. After an import of new models, `node assets/make-pictures.mjs` makes the missing pictures (`--all`:
all again, after a change of the drawing in `web/lib/preview.js`). The items are the FlyFF male parts and the FlyFF weapons and shields of
`assets/character/player/parts/`, listed in `items.json`; `import-items.mjs` makes both from the FlyFF data folder.
`Save` writes all these values (with the look) to `saves/admin.json` (through `web/serve.py`), and the game starts with them;
`Default` puts back the values of the code, without saving them (not the monsters or the stats). Trees,
water and cliff walls stop the human; it goes up and down stairs. Rocks and buildings stop it by their real shape: it
can jump onto a rock, walk on it, and fall off it (`web/lib/walk.js`).

Monsters and fights. The `Monsters` part of the Admin menu opens a grid of the 569 FlyFF monsters (one picture each).
A click on one opens its editor: name, model (a grid of the 127 models), level, HP, damage min and max, defense,
attack delay, walk speed, size, and XP. A change applies at once. `Spawn` puts the monster in front of the human
(its model is baked the first time, so it comes after a moment), `Copy` makes a new monster from it, `Delete` removes
it, `Remove all` removes the monsters in the world. `Save` writes the changed monsters to `saves/monsters.json`.
The `Human` part sets the level, STR, STA, and points of the human, and `Full HP` fills its HP.
The `Objects` part places FlyFF decor objects in any world: its button opens a grid of the 1018 objects (one picture
each, and a search box), `Size` shows the size of the chosen one, `Place` puts it in front of the human, facing it, and
`Remove all` removes the objects placed this way (`web/systems/adminObjects.js`). They are not saved.

A monster is calm: it stands, looks around, and walks near the place where it came. When the human hits it, it
follows the human and attacks it. It gives up, goes back, and heals when the human dies or goes too far (14 units
from its place). A dead monster plays its death clip, fades out, and is removed. The human gets its XP; a new level
gives stat points (the FlyFF table) and full HP. At 0 HP the human lies down for 3 seconds, then stands up in the
same place with full HP. The rules (damage, HP, chance to hit) are in `web/lib/combat.js`:

- HP = 100 + 10 × level + 5 × STA. Defense = STA / 2. Damage = 2 × STR + 2 × level, ±10 %.
- A blow hits 95 % of the time, 4 % less for each level the target is above the attacker (at least 40 %).
- The damage after the defense of the target is at least 1.

On screen: a bar with the name, level, and HP over each monster that was hit, the damage numbers (`miss` for a
miss), and at the bottom right the level, HP, and XP of the human, its STR and STA, and a `+` button for each while
it has points (`web/systems/hud.js`).

The Vagabond (`?player`), fights like League of Legends:

- It starts at level 1 in the vagrant clothes of FlyFF (`part_mvag01upper`, `hand`, `foot`), with a wooden sword
  (`item_weaswowooden`) and a wooden shield (`item_armshiwooden`) in its bag, not worn (`character.json` `vagrant`).
- The bag: the `I` key or the `Bag` button. It shows the human as it is dressed (a drag turns it, `web/lib/doll.js`)
  and all it wears around it: helmet, glasses or mask, clothes, gloves, cloak, boots, weapon, shield. A click on a worn
  item takes it off (no clothes: the bare body), `Take all off` takes off all, a click on an item of the bag wears it
  (what was worn goes to the bag), a click on a potion drinks it (`web/systems/inventory.js`). With no weapon, a click
  gives 2 punches (Quaternius `Punch_Jab`, `Punch_Cross`) that hit half as hard as the sword.
- MP: 50 + 5 × level, 1 back each second; the skills cost it. A level fills HP and MP.
- Skills (`assets/character/player/skills.json`, `web/lib/skills.js`, `web/systems/skills.js`): each level gives a
  skill point; the `K` key (or the `Skills` button) opens the window where a point opens a skill or raises it (up to
  level 5, 20 % more damage each level). Keys `1` to `4` start them; the bar at the bottom shows each one with its
  level, MP, cooldown, and grey when it cannot start (not learned, no sword or shield, no MP). Too soon, or no
  target, a short text says why. While a skill plays, the human does not walk, jump or attack.
- To test: the `Level +1` button of the bar gives the experience of the next level (its points, a skill point, full
  HP and MP).
- The transformation (`try/transformation`), like Super Saiyan in Dragon Ball (`skills.json` `transform`,
  `web/lib/form.js`, `web/systems/transform.js`, `web/systems/aura.js`): it opens at level 15 (the slot `G Super` of
  the bar says `level 15` before). The `G` key starts it for 30 MP: the human plays its power-up clip without moving
  (`Power_Burst` of Mesh2Motion, CC0, moved onto its skeleton: it crouches, raises a fist, crouches, then opens its
  arms and legs wide like a scream) while gold cubes rise around it. From the key, its FlyFF hair gives way to a
  free anime hair (the hair of a VRoid sample model, CC0, `assets/character/player/vroid/`, fitted on the FlyFF head:
  `web/lib/superHair.js`), which shakes, lifts a little and flickers gold. When its arms open: a white flash, a ring
  of cubes, and its hair stands up in gold spikes in a blink: each strand bends where it leaves the scalp and its end
  goes up, opened out by where it grows (the strands of the back bend lower, so the open back of the FlyFF head stays
  covered). The hair is one mesh bent at rest and moved by the matrix of the head each frame; made of cubes, it has
  cubes of its own that follow its strands (none on the clear parts of its texture). The clip plays on and melts into
  idle, then it can move. Transformed, it hits 1.5 times harder, walks and
  runs 1.25 times faster, gold cubes rise around it, and it loses 3 MP a second; `G` again, no MP left, or death ends
  it, and it can start again 15 s later. Nothing is baked again for the gold form (the other frames are shared),
  when it opens and after each new outfit or look; a cap that hides the hair leaves it as it is. The gold hair casts
  no shadow in the Normal look (the shadow pass would draw its strands without their holes).

  | Key | Skill | Needs | MP, cooldown | What it does |
  | --- | --- | --- | --- | --- |
  | 1 | Dash Strike | sword | 15, 6 s | on the monster under the mouse, within 6: rushes behind it in a blink, turns, hits it ×1.5 |
  | 2 | Triple Slash | sword | 10, 5 s | a combo: press 2 again during a hit or 1.5 s after it, 3 hits (FlyFF Clean Hit, Brandish, Over Cutter), the last ×2; the cooldown starts after it |
  | 3 | Keen Wheel | sword | 20, 8 s | spins (FlyFF Keen Wheel), 3 blows on every monster within 2.5 |
  | 4 | Shield Bash | shield | 12, 10 s | rushes 2 forward (stops at the first monster), hits it and stuns it 1.5 s (Quaternius `Shield_Dash_RM`) |
  | R | Kikoha | nothing | 25, 6 s | the right arm straight forward, the palm open toward the enemy: a ball of ki grows in the palm (0.65 s), then flies forward going down (15 a second, up to 9) and bursts on the first monster or on the ground: every monster within 1.3 is hit ×2.5, and it digs a big crater (hole `large`) |
  | T | Kamehameha | nothing | 40, 12 s | the hands at the hip, a ball of ki grows (1.2 s), then both arms push a beam forward (up to 14) for 1.1 s: each monster it touches is hit ×3.5, and it digs a trench in the ground under it (hole `normal`) |

  The monster under the mouse gets its bar lit (`web/lib/screen.js`); a skill turns the human to it.
- Ki blasts (`web/systems/blasts.js`, the `blast` of a step in `skills.json`): the Kikoha and the Kamehameha are made
  of cubes snapped on a grid (in both looks), drawn in the fine pass in their own colours, not lit by the sun
  (`KI_FRAG`). They dig the ground (the Kikoha where it bursts, the Kamehameha where it passes) (`web/lib/craters.js`, `web/systems/craters.js`): cells
  of 0.1 go down whole cubes, the ground is not drawn there (`groundFrag` reads the depths as a texture) and cubes of
  earth are drawn instead, darker the deeper they are (`CRATER_FRAG`); dirt and grass fly out, the grass is gone, and
  walkers go down into the trench (`web/lib/walk.js` groundAt). FlyFF floor objects (the squares of Flarine) are not
  dug: the hole stays under them. The shape of a hole is one of the `holes` of `skills.json`, named by the `hole` of a
  blast, so it is one word to swap: `normal` (radius 0.65, 4 cubes deep) and `large` (radius 0.95, 6 cubes deep).
  The clips of the Kikoha and the Kamehameha are made of key poses (`character.json` `poses`, `web/lib/poses.js`):
  no free clip has them (searched: Quaternius, KayKit, Mixamo, itch.io). A skill clip can also be several clips one
  after the other (`sequences`, `web/lib/character.js`).
- Potions (`assets/items/potions.json`, FlyFF models copied by `assets/items/import-potions.mjs`): a dead monster
  drops an HP potion (half the time) and an MP potion (3 times in 10) at its place; the human picks them when it walks
  on them; they are gone after 60 s (`web/systems/drops.js`). Key `5` drinks an HP potion (+80 HP), `6` an MP potion
  (+40 MP).

The worlds:

- `kame-island`: the start of the story. A sand island in the middle of the ocean, with the Kame House, palms in pairs
  around it, and a small boat at the shore. Walk to the boat: it takes the human to `beach` (recipe `portals`, section 2).
- `beach`: where the boat lands: the ocean on the south, a beach with one line of palms, then a dirt path north between
  two rows of oaks, past 10 Aibatts (level 1), to Chichi's house at its end, under the mountains. Chichi stands in
  front of it: near her, E opens the Game modes window (section "Game modes" below), with a button for her quest "Too
  many Aibatts" (recipe `npcs`, section "Quests" below). Behind her house, a
  smaller path goes to a cave mouth in the mountain (`building/cave-mouth`): it opens `cave`. The human arrives on
  the sand next to the boat; the boat takes it back to `kame-island`.
- `cave`: the mine in the mountain, where the Aibatts come from (references: Pixel Mines Kit, Petixel Mines, Solaria
  Cave, Mine Tileset Pack, on itch.io). Four rooms and the tunnels between them cut in dark rock (recipe `cave`,
  section 4): the entrance hall, a crystal room on the west, the mine works on the east (rails, a minecart, crates)
  and the Captain Aibatt chamber at the far north. Theme `cave`, all in shadow (`"clouds": "cave"`); the light comes
  from torches, the lanterns of the mine frames and the glowing crystals (section 6, lamps), and daylight falls at
  the entrance (one clearing). Small Aibatts and Aibatts in the rooms. Walk back south out of the tunnel to go out to
  `beach`.
- `night-forest`: the world of the game mode Day Night (section "Game modes" below). 48 wide, at night (`"night": 1`):
  mountains on the north, west and east, the ocean and a beach on the south. A forest of pines, firs and a few oaks,
  a dirt path from the beach to the middle, and 4 clearings. 5 crates to check (one in each clearing, one at the end
  of the path) and 6 traps (on the path and in the clearings). The players start on the beach, the monster in the
  north.
- `all-types`: every asset type in every size, in rows, with a mountain border, the ocean, a beach, and a dirt path.
- `walk-test`: one object of each of the first types, in a row.
- `tree-types`: one tree of each type in a row, with no light beams, to compare their shapes.
- `burn-test`: a small forest (oaks, pines, a fir, a bush), wooden crates with a barrel, and a rock, to try the voxel
  fire (`"burn": true`): the first button at the top, or B, sets fire to the nearest object that can burn; the fire
  jumps from tree to tree and gets weaker; the second button turns the rain on or off. The rock does not burn.
- `burn-forest`: the same fire in a bigger forest (40 units: 34 oaks, 26 pines, 18 firs, 16 bushes, 3 crates, 6 rocks)
  with 3 clearings; you start in a clearing. B again sets fire to the nearest object that did not burn.
- `rock-types`: 3 rocks of each rock type, one row per type, with no light beams.
- `flyff-objects`: the 30 FlyFF decor objects of `assets/objects`, in 5 rows.
- `combat`: a small meadow with 9 monsters in 3 groups (4 Aibatt level 1, 3 Mushpang level 3, 2 Burudeng level 5),
  to try the fights and the skills: `?world=combat&player&look=normal`.
- `voxel-bench`: a small world with a bit of everything (cliffs, rocks, trees, 3 FlyFF houses, tents, lamps, a fence
  and a bench), to measure the cost of the cubes.
- `flarine`: the centre of the FlyFF city Flarine (its 3 squares, the bridges and the river), as in FlyFF (recipe
  `map`, section 2).
- `meadow`: ponds and puddles.
- `lakes`: a lake, a river, ponds, and puddles.
- `rocky`: an autumn forest with many rocks.
- `mountains`: cliffs in levels, with stone stairs.
- `coast`: mountains on the west, the ocean on the east.

A mistake in a recipe shows its message at the bottom of the page.

### Play together

The pages open on the same world (and the same `?seed`) are together, on one computer or on several
(`python3 web/serve.py --lan`, then `http://<the computer of the server>:8643/web/?world=beach&player&name=Krilin`).
`web/serve.py` is also a WebSocket server (`/net?room=<world>&name=<name>`): it gives each page a number, says who
comes and who goes, and passes each message on to the others of the world (`web/systems/net.js`). Without the server,
or with `?solo`, the page plays alone.

- The other players: their body in their outfit (with the cubes of the people), where they walk, their clip (walk,
  hits, skills, dead...), their name, level and HP over their head (a green bar), and their ki blasts, which dig the
  ground here too. Each page sends its player 15 times a second. Players walk through each other.
- The monsters are shared. The first page of a world is its host: it runs the monsters (`web/systems/monsters.js`)
  and sends them 10 times a second; the other pages (guests) show them where the host says. A blow of a guest is
  counted on its own page (its numbers show at once) and sent to the host, which takes the HP off: the monster gets
  angry at the first player who hits it and follows that player. Its blows hit that player, with the defense of that
  player. The player who kills a monster gets its experience, its potions and its count in a quest.
- When the host goes, the page that came next is the host: it runs the monsters from where they are, and the
  monsters of the world recipe still come back.
- The text at the top right says where the page is: `online · 2 players · host`, `online · 2 players`, `connecting`,
  or `alone · no server`. A page alone sends a `ping` every 20 s: a Cloudflare tunnel closes a WebSocket that sends
  nothing (after about 2 minutes, measured). When the connection is lost, the page plays alone and tries again every
  5 s; back with others, it drops its own monsters and shows those of the host. The server prints each join and leave
  (`[net] Krilin (#2) joins beach: 2 player(s)`).
- A fixed link with a Cloudflare tunnel: `cloudflared tunnel run lambda` next to `python3 web/serve.py`, with
  `~/.cloudflared/config.yml` sending `game.aissabenfodda.ca` to `http://localhost:8643`; then
  `https://game.aissabenfodda.ca/web/?world=beach&player&name=<name>`. A test branch is online under its path
  (`/game_01/web/`, `python3 web/serve.py 8701 --prefix=/game_01`): `how-we-work.md`, section 6.
- The home page (`web/home.html`, at `/`), like the server list of Don't Starve Together: `Log in` or `Create
  account`, then `MY WORLDS` (the rooms the account made or joined, the last played first: name, code, owner, players,
  where its player is and its level, when, who is online now; `Play`, and `Leave`, or `Delete` for its owner),
  `NEW WORLD` (a name: the room is made and the game opens) and `JOIN A FRIEND` (a code). Online the game opens only
  from there: `/web/` without a room, or not logged in, goes back to the home page (a link with a room logs in first,
  then opens it).
- Accounts: a username (3 to 20 letters, digits or `_`) and a password (6 characters or more), no email. A cookie the
  page cannot read keeps the browser logged in until `Log out` (home page). The server keeps them in PostgreSQL (tables
  `accounts` and `sessions`, `server/db.py`), the password as a salted PBKDF2 hash; a wrong password waits 1 s. Logged
  in, the name of a player for the others is its username.
- Admins: an account with `admin` true in the table `accounts`. The first account made in a database is an admin. Online only an admin has the
  Admin menu (log in, the page opens again with it); the others are Vagabonds. The server refuses the admin saves
  (the table `settings`, read and written at `/saves/admin.json` and `/saves/monsters.json`, and `worlds/baked/`) to the others. The `Admins` tab of the menu lists the
  accounts with a box each: ticked, the account is an admin. An admin cannot change its own box, so there is always
  one. A request that did not come through the Cloudflare tunnel (no `Cf-Connecting-Ip` header: this computer, the
  tests) counts as an admin (`web/serve.py`).
- Rooms (worlds): made on the home page; in the game, the bar at the top right shows its name, `Copy link` (the home
  page with `?room=<code>`, for a friend) and `Home`. Only the pages of one room and one world are together. The room
  keeps the player of each account (table `room_players`: its world, where it stands, its stats and level, HP, MP,
  skills, bag, outfit and quests; `web/serve.py`, `web/lib/room.js`, `web/systems/room.js`). Each page writes its
  player every 10 s, when it closes, at a portal and before `Home`. Played again (even when everybody left, or from
  another browser), the room puts each account back in its world, where it was. Only `web/`, `assets/` and `worlds/`
  are served as files: a page only reads its own player (`GET /rooms/<code>`).
- A hidden tab gets no animation frames: with other players, a worker timer runs the game 20 times a second, so a
  hidden host still runs its monsters and the spawns of the guests.
- The outfit of a player is sent only when it changes, or when a player comes.
- Not shared: the gold form of the transformation (another player shows its clips, not its gold hair or aura), the
  bag, the quests, the people (each page has its own Chichi), and the admin menu (a spawn of a guest is sent to the
  host).

### Quests

`assets/quests/quests.json` lists the quests (`web/systems/quests.js`). A person of `npcs.json` gives each one, and
it goes through its steps in order: `talk` (lines, then a button to go on), `kill` (a number of monsters of one id:
the human must kill them, then talk to the person again), `goal` (a text on the screen). While a quest runs, its
title and its step are shown at the top left. A portal takes them along (`portals` above); a reload starts them again.

- "Too many Aibatts" (Chichi, `beach`): Aibatts came out of the cave in the mountain; kill 10 of them, then come back.
  Chichi then says that they all come from the cave behind her house, led by the Captain Aibatt: defeat it in `cave`,
  then come back to her.

### Game modes

Near Chichi, E opens the Game modes window (`web/systems/game.js`; a person with `"modes": true` in `npcs.json`). It
lists the modes, with a Start button, and a button that opens her talk. Only the owner of the room can start (on this
computer, any page); the server keeps the round of the room (`server/games.py`, not saved in the database). It takes
every player of the room, in any of its worlds (at least 2), picks one at random to be the monster, and sends them all
to the world of the mode. Each page keeps where it was and its player, and goes back there after the round, as it was
(the room save in the world of the mode keeps that place too). A page that opens the world of a mode with no round for
it goes back.

Day Night (`night-forest`):

- The monster has a sword; F or a click hits, and 3 blows kill a player. It sees a small circle around itself, and a
  dot at the side of the screen for each flashlight that is on out of sight.
- A player cannot attack. F turns its flashlight on and off: a ring of light in front of it, which everyone sees.
  Near a crate, it holds E for 3 s to check it.
- The monster burns a tree: B near it, one every 10 s. It burns for 5 s (flames and an orange light every page shows),
  then it is gone until the end of the round: no tree to hide behind (the props keep their entity: `land.props[i].entity`;
  the server sends which ones burn).
- Each player the monster kills gives it one disguise (R): for 20 s it wears the clothes of that player, with no sword
  and no circle of its own. A blow or a burn ends it.
- A trap (a red ring) stops anyone who walks on it, the monster or a player, for 5 s; it works again 20 s after.
- No skills, transformation or potions, and no names over the other players (they would show where they hide).
- The players win when the 5 crates are checked; the monster wins when every player is dead. A dead player lies there
  and watches. The banner says who won, and 6 s later everyone goes back. A player gone from the room for 45 s is dead;
  the monster gone for 45 s: the players win.

The recipe of the world of a mode has `"game"`: `mode`, `checks` (the crates, [[x, z], ...]: put a crate prop there),
`traps` ([[x, z], ...]), `monster` (its start), `players` (their starts, one per player), `back` (`{ world, char }`:
where a page with no kept place goes back).

## 2. A recipe

A world is a JSON file in `worlds/`. The code reads it, makes the shapes with math (`web/gen/builders/`), and places
them.

```json
{
  "name": "Meadow",
  "seed": 11,
  "size": 40,
  "clearings": { "amount": "many", "radius": [3, 3.6] },
  "props": [
    { "asset": "plant/oak/medium", "amount": "some", "spacing": 4.6, "avoid": "clearings" },
    { "asset": "rock/sharp/small", "amount": "lots", "palette": ["grey", "sand"] }
  ]
}
```

The fields of a world:

- `seed`: the same seed gives the same world.
- `size`: the width of the square world, in world units (a person is about 1 unit tall).
- `theme`: the colours of the whole world (section 6). `?theme=` in the address wins.
- `start`: where the camera starts, `[x, z]`. Default: the first clearing.
- `clouds`: how much of the ground the cloud shadows cover: `none`, `few`, `some` (default), or `cave` (all of it: only
  the clearings are lit, like pools of light in a cave).
- `pavement`: how the `pavement` paint looks: `tiles` (grey slabs, default) or `bricks` (brown bricks, each row half
  a brick off the one before, like the streets of Flarine).
- `rays`: the strength of the light rays, 0 to 1 (default 1).
- `night`: how dark, 0 (day, default) to 1: the world and the people are dark and blue, and only the rings of the
  lamps (and of the flashlights of a game mode) show their colours (`web/render/shaders.js` uNight).
- `burn`: `true`: the button at the top (or B) sets fire to the nearest object that can burn, voxel by voxel
  (`web/systems/burn.js`). Each voxel has a material (`assets/materials.json`, by the role of its part, or the palette of
  a stone part: the wooden crates) and a state: normal, heating (red), burning, embers, burnt (black), ash, gone. A
  material says if it burns, how easily it catches fire, how long it burns and glows, and what is left (`char`: it stays
  black, the wood; `gone`: it turns to ash and is gone where it is, the leaves). A burning voxel heats the voxels next
  to it (most the one above, least the one under it) and the voxels over it up to 5 high (hot air goes up), so the fire
  climbs in tongues. A light wind (one direction for every world) makes it spread faster with the wind, leans the hot
  air and the flames, and carries the embers and the flakes of ash. Each object is dry in some places and wet in others:
  dry patches catch first, wet ones resist. A heated voxel that does not catch fire cools down again. The fire can die
  out by itself: a voxel may resist (`resists`), each voxel keeps only part of the strength of the fire that lit it
  (`keeps`), and a fire too weak gives no heat. A burning object sends a spark to an object less than 2 units away (more
  often when closer, stronger and with the wind), and where it lands a weaker fire starts: a forest fire gets weaker from
  tree to tree, and a clearing, a path or water stops it. Rain (the second button) puts the burning voxels out (they
  stay black) and slows the fire.
  A piece of leaves that is no longer joined, voxel by voxel, to the wood or the ground falls as one piece (a small one
  slower) and breaks up where it lands: what burns burns on a little, green leaves fall apart, the rest crumbles. So
  nothing floats.
- `game`: the world of a game mode (section "Game modes").
- `borders`: what closes each side (section 4).
- `islands`: islands cut out of the ocean (section 4).
- `ground`: paints on the grass (section 5).
- `cliffs`: plateaus in levels, with rock walls and stairs (section 4). No `cliffs`: flat ground.
- `cave`: the world is solid rock, with rooms and tunnels cut in it (section 4). Not with `cliffs`, `borders` or `map`.
- `clearings`: open places with light: `amount` or `count` (at most 4), `radius` [min, max], `light` [min, max];
  `at`: [[x, z], ...] places them instead of scattering them.
- `props`: one line per group of objects. Big objects are placed first.
- `map`: a part of a FlyFF map, `worlds/maps/<name>.json`, as in FlyFF (`web/gen/map.js`). It gives the ground, so a
  world with a map has no `size`, `cliffs`, `borders` or `ground`. `worlds/maps/import-map.mjs` makes the file from the
  FlyFF land files (`.lnd`) and the objects (`objects.ron`) of a folder, for a square of the map:
  `node worlds/maps/import-map.mjs /path/to/flarine_city flarine 6871 3109 7231 3469`. Everything keeps its FlyFF size
  next to the human: 1 FlyFF unit is 0.645 world units (the FlyFF human is 1.63 tall, ours 1.05), so the Flarine centre
  is 232 units wide (a house 9 high). What comes from FlyFF:
  - the ground heights (one every 4 FlyFF units): the ground goes up and down, walkers follow it, and the camera follows
    its height;
  - the water (the river at height 96 in FlyFF, our y = 0): it stops a walker deeper than 0.15, except on a bridge;
  - the ground textures as our paints: the FlyFF default ground is `sand`, the bricks of Flarine are `pavement` (with `"pavement": "bricks"`), the
    rocky grounds are `dirt`, the lawn is grass;
  - the decor objects at their place, turn, size, and height. They are not brought to our sizes. They stop a walker by
    their real shape, up to 2.2 over the ground around them (`web/lib/tops.js` `addReachable`): it walks on their floors
    and bridges, walls and fences stop it, and it goes under arches and leaves.
  The archived FlyFF objects (`assets/objects/archived.json`: kept for now, to delete later) are left out: the ones that
  float in the air and hide the human (the big roof and the propellers over the Flarine squares), and the FlyFF trees
  and leafy plants, which become our trees and big-leaf plants (`trees` and `plants` below). The import names any other object that floats more than 5 FlyFF units over
  the ground: archive it there, then import again.
  A world this big has grass and flowers only 32 units around the camera, in squares of 16 made as it walks
  (`web/systems/coverChunks.js`).
- `trees`: with a `map`, our tree type that takes the place of its FlyFF trees, `"family/type/size"` (Flarine:
  `"plant/oak/large"`). Each is scaled (in steps of 1/4) to about the height of the FlyFF tree. No `trees`: no trees.
- `plants`: the same for the FlyFF leafy plants of a `map` (Flarine: `"plant/leafy/medium"`, made from them). The map
  says which FlyFF plant was at each place, and `plant/leafy` has the same one there. No `plants`: none.
- `objects`: FlyFF decor objects (the 1018 of `assets/objects`: chairs, boxes, fences, lamps, tents, houses, trees,
  rocks...), one line per object type: `{ "object": "bench", "at": [[x, z, turn], ...] }` (turn in radians, default
  0). The names are in `assets/objects/objects.json`: the FlyFF name without `obj_` (`rustiachair01`), and a short
  name for the first 30 (`bench`). They are placed where `at` says, nothing else moves for them. They are drawn in the
  style of our world (`web/lib/objectStyle.js`): with the world, so with our pixels, light bands and 1 px outline,
  each colour of their textures turned into the nearest of our stone palettes or our green leaf palettes (green and
  pine, lit like our leaves), then smoothed so few specks are left (the pictures stay). Their sizes are brought to
  ours: next to the human, FlyFF objects are a little bigger when small and much bigger when big (a house 17 m
  high), so a height h becomes 0.7 h / (1 + 0.7 h / 6): a bench 0.9, a lamp 1.2, a house 4, a tree 3.8, never more
  than 6 (`objectScale`). They follow the `Look` switch: cubes never smaller than 1 px, like the rocks; a big object
  gets bigger cubes, so the computer does not run out of memory. The cubes of a model are made once for each cube size
  and shared by its copies. Each one stops a walker by a circle, and no grass
  grows under it (`web/systems/objects.js`).
- `portals`: circles on the ground that take the human to another world: `{ "at": [x, z], "radius": 1.2, "to": "beach",
  "char": [x, z] }`. When the human walks into one, the page opens the world `to` (`worlds/<to>.json`) with the human at
  `char`: both are kept in the session (`sessionStorage`) and the page reloads, so the address does not change. A portal works only after the human has
  been out of it, so arriving in one does not send it back (`web/systems/portals.js`). A player (a Vagabond, or the player of a room) takes
  itself along: its stats, HP, MP, skills, bag, outfit and quests are kept in the session (`sessionStorage`) and put
  back in the next world; a reload without a portal starts a new Vagabond. The boat of `kame-island` is
  one: put the portal where the object is, a little wider than it.
- `npcs`: people who do not fight, one line each: `{ "id": "chichi", "at": [x, z, turn] }` (an id of
  `assets/character/npc/npcs.json`). Each one is the FlyFF female in the parts it wears, plays its idle clip, has its
  name over its head, stops walkers, and turns to the human when it comes near. Near it, `E` (or a click on its name)
  opens the talk (`web/systems/npcs.js`, `web/lib/npc.js`).
- `monsters`: FlyFF monsters placed in the world, one line per monster type: `{ "id": 21, "at": [[x, z], ...] }` (the
  `id` of `assets/monsters/monsters.json`). They spawn when the human is there, and each comes back at its place 15 s
  after its death (`web/systems/monsters.js`).

## 3. A line of `props`

- `asset`: `family/type/size`, for example `rock/sharp/small` (see `assets.md`). The type is the file
  `assets/<family>/<type>/<family>.json`.
- `amount`: `none`, `few`, `some`, `many`, or `lots` (objects per 100 m²: 0, 0.3, 1, 2.5, 6).
- `count`: an exact number instead of `amount`.
- `params`: changes values of the size, for example `{ "height": [0.1, 0.2] }`. A `[min, max]` value is picked
  for each shape.
- `palette`: a palette name of the type, or a list (one is picked for each object). None: the first palette of
  the type.
- `spacing`: keep this far from the other spaced objects of the same type (tree crowns).
- `gap`: free space around each object (default 0.3).
- `near`: place around the objects of a family: `water` (along its shore), `rock`, or `plant`. Also `cliffs` (at
  the foot of the walls) and `cliff-tops` (on top, just behind the edge).
- `avoid`: `"clearings"`: keep out of the clearings.
- `on`: only on this ground: `grass` or a paint (`sand`, `dirt`, `pavement`, `field`), all around the object.
- `at`: exact places `[[x, z, turn], ...]` instead of scattering.

Each object gets a name of 5 parts: `family/type/size/palette/variant`, for example `rock/sharp/small/grey/2`.

The types today:

- `rock/sharp`: `small`, `medium`, `large`. Palettes `grey`, `sand`, `moss`, `dark`, `cliff`.
- `rock/round`: `small`, `large`. The same palettes.
- `rock/crystal`: a cluster of six-sided columns with pointed tips, on a small stone (`web/gen/builders/crystal.js`).
  `small`, `medium`, `large`. Palettes `crystal-cyan`, `crystal-pink`, `crystal-gold` (bright: they shine in a dark
  cave).
- `rock/slab`: one flat, wide stone. `rock/stack`: 2 or 3 flat stones piled up. `rock/cluster`: one stone with 2 or 3
  smaller ones at its foot. `rock/split`: one stone split in two halves. All four: `small`, `medium`, `large`, the
  same palettes, and a new form each time.
- `plant/oak`: `small`, `medium`, `large`. Palettes `green`, `autumn`, `pine`.
- `plant/bush`: `medium`. Palettes `green`, `autumn`, `pine`. You walk through it.
- `plant/leafy`: the 3 leafy plants of FlyFF, with the same stems and leaves at the same places, in our style (one per
  variant). `medium`. Palettes `green`, `autumn`, `pine`. You walk through it.
- `plant/palm`: `small`, `large`. Palettes `green`, `autumn`, `pine` (the fronds; the trunk is always `palm`).
- `plant/pine`: 3 cones stacked. `plant/fir`: taller and narrower, 5 cones. `plant/cypress`: tall and narrow, like a
  flame. All three: `small`, `medium`, `large`. Palettes `pine`, `green`.
- `plant/birch`: a thin white trunk. `plant/willow`: a bell that hangs low. `plant/fruit`: low, wide, and round.
  All three: `small`, `medium`, `large`. Palettes `green`, `autumn`.
- `water/puddle`, `water/pond`, `water/lake`, `water/river`: `medium`. Palettes `clear`, `swamp`, `glacier`.
- `water/ocean`: `medium`, only for `borders`.
- `building/chichi-house`, `building/buu-house`, `building/capsule-ship`: `medium`. Palette `classic`. Their front
  always faces the camera.
- `building/kame-house`: the Kame House of Dragon Ball Z (pink walls, red tile roof, KAME HOUSE on the gable), made by
  code (`web/gen/builders/kame-house.js`). `medium`. Palette `classic`. Its front always faces the camera.
- `building/cave-mouth`: a pile of rock blocks with a black arched hole, to put against a mountain, with a portal in
  front of the hole. `medium`. Palette `classic`.
- `building/mine-frame`: two wooden posts and a beam across a tunnel, with a lantern hanging from it (it shines).
  `small`, `medium`, `large` (width between the posts 1.8, 2.4, 3.2). A walker goes under the beam.
- `building/rails`: a piece of mine rails, steel on wooden sleepers. `small` (1.2 long), `medium` (2 long). Lay the
  pieces end to end.
- `building/minecart`: a wooden tub on wheels, full of ore and crystals. `medium`.
- `building/crates`: wooden crates and a barrel. `small` (1 or 2 crates), `medium` (2 or 3).
- `building/torch`: a torch on a pole (it shines). `medium`.
  The five of them are made by `web/gen/builders/mine.js`, palette `classic`. They turn with `at`, and what runs
  along a tunnel (a frame, the rails, a cart) runs along its local z: give it the turn atan2(dx, dz) of the tunnel.
- `building/boat`: a small wooden row boat, pointed at its bow, open, with seats and two oars
  (`web/gen/builders/boat.js`). `small`. Palette `classic`. It turns with `at`: a turn of
  0 points its bow to the east, -1.57 to the camera.
- `terrain/cliff`: `medium`, `large`, only for `cliffs`. Palettes `cliff`, `sand`, `grey`, `moss`, `dark`.
- `terrain/mountain`: `medium`, only for `borders`. Palettes `cliff`, `sand`, `grey`, `moss`, `dark`.

## 4. Terrain: cliffs, mountains, and the ocean

`"cliffs": { "asset": "terrain/cliff/large", "count": 5 }` makes the ground in levels (`web/gen/terrain.js`):

- `asset`: the type and size. Its file has the numbers: `levels`, `width`, and `height`.
- `count`: the number of plateaus (default 3). Plateaus that touch become one.
- `palette`: the stone palette of the walls (default: the first of the type).
- `stairs`: the stone palette of the stairs (default `sand`).

Every level gets stairs down, so every level can be reached. Objects stand only on flat ground, and water stays on
the lowest level.

`"borders": { "west": "terrain/mountain/medium", "east": "water/ocean/medium" }` closes sides of the world
(`web/gen/borders.js`). The sides are `north` (top of the screen), `south` (towards the camera), `west`, and `east`.

- `terrain/mountain/medium`: a band of cliffs 6 to 10 units in from the side, about 5 to 7 units high, with no stairs.
  `{ "asset": "terrain/mountain/medium", "palette": "sand" }` gives it a palette.
  It goes on past the world. Where the next side has no mountain, it stops tier by tier just past the corner, each
  tier on its own wavy line with a ledge between, like the side itself. So the camera never sees it stop in one flat,
  straight wall at the end of the terrain grid. Two mountain sides meet at the corner instead.
- `water/ocean/medium`: 5 to 8 units in from the side, with a wavy shore. `{ "asset": "water/ocean/medium", "width":
  [17, 19] }` makes a wider sea.

All the walls of one world have one palette, so cliffs and mountains in the same world must ask for the same one.
A world with two gives an error.

A cave: `"cave": { "palette": "cliff", "top": "void", "height": 2.2, "rooms": [[x, z, r], ...], "tunnels": [{
"path": [[x, z], ...], "width": 2.8 }], "pillars": [[x, z, r], ...] }` (`web/gen/terrain.js` buildCave). The whole
world is rock `height` high, and the rooms (wavy circles) and the tunnels (a width that swells and narrows) are cut
out of it down to the ground; a pillar is rock left standing in a room. The walls are drawn in `palette`, the top of
the rock in `top` (`void`: near black, the dark over the cave, which takes no lamp light). Its floor has no grass:
paint it (`dirt`), it gets cracks and pebbles. Lines with `"near": "cliffs"` go along the walls (rubble, crystals);
with `"avoid": "paths"` they keep off the middle of the tunnels (a lane 2 wide stays free). The rock just south of the
floor (3.5 units deep) is a low ledge, 0.5 high: the camera looks down at about 33°, so a high rock there would hide
whoever walks behind it.

`"islands": [{ "at": [36, 55], "radius": 5.6, "bar": [33.5, 43], "barWidth": 2.6 }]` cuts islands out of every
ocean, with a sand bar out to the point `bar`.

## 5. Terrain: ground paints

`"ground"` lays paints on the grass, in order (`web/gen/ground.js`):

- `{ "paint": "sand", "beach": 3 }`: along the shores of the ocean, 3 units in.
- `{ "paint": "dirt", "path": [[x, z], ...], "width": 2 }`: a road along the points.
- `{ "paint": "pavement", "rect": [x0, z0, x1, z1] }`: a rectangle.
- `{ "paint": "field", "circle": [x, z, r] }`: a disc.

The colours are the `ground` palettes of `assets/palettes.json`.

## 6. Colours and themes

All colours are in `assets/palettes.json`, by family: `stone`, `trunk`, `canopy`, `water`, `ground`, and `cover`
(the flowers and sprouts in the grass). A new palette is one more line there: the shaders are built from it.

A theme replaces palettes by name, so every world works with every theme:

- `dbz`: Dragon Ball Z colours: yellow-green grass, tan rocks, a deep blue sea.
- `namek`: planet Namek: blue grass, blue trees, and a blue sea.
- `cave`: inside a cave: dark blue-grey ground, paths and flowers, dark blue-grey rocks and walls.

Lamps: an asset type with `"light"` shines (`web/gen/assets.js`): `{ "sizes": { size: [height, radius] }, "color":
"#rrggbb" or { palette: "#rrggbb" }, "flicker": true }`. Around it, the post pass draws flat rings of its colour
(3 bands, `web/render/shaders.js`); a flame flickers. The 24 lamps nearest to the camera shine. Today: `rock/crystal`
(`medium`, `large`, in the colour of their palette), `building/torch`, `building/mine-frame`.

## 7. What stops a walker

One rule for every object (`web/gen/collision.js`):

- A rock or a building stops a walker by its real shape (`web/lib/tops.js`): a walker stands on its top, steps up at
  most 0.12 at once (so a slope steeper than about 30° stops it), and must jump to get higher.
- An object with simple colliders (`colliders` on its shape: circles under its solid parts, the mine things) stops a
  walker by them instead of its real shape. A walker is a circle, tested whole against every circle (trees, water,
  colliders): it slides along them and never sticks (`web/lib/footprints.js` bumps).
- Any object lower than 25 % of a person does not stop a walker, rocks and crystals too (small crystals are that low).
- A tree stops a walker only with its trunk. A bush never does.
- Water stops a walker, except puddles.
- A cliff stops a walker: only stairs go up or down. A walker keeps 0.3 away from the foot of a wall (walls lean out
  at their foot), so it never sinks into one.

## 8. Add a new type

A new type that an existing builder can make (for example a bigger lake) is only a new JSON file:
`assets/water/sea/water.json`, then `"asset": "water/sea/medium"` in a recipe.

A new kind of shape needs a builder too:

1. Make `web/gen/builders/<name>.js`. It calls `defineBuilder` with a `name` and a `build` function. `build`
   returns the shape: its meshes, `height`, and `radius` (see `web/gen/registry.js`).
2. Add its `import` to `web/gen/builders/index.js`.
3. Make the type file, with `"builder": "<name>"`.

A new building is only a new JSON file too: `assets/building/<name>/building.json`, with `"builder": "building"`.
Make its plan from a reference image with `documentation/building/README.md`, then give each face a stone palette:

```json
{ "id": "walls", "type": "box", "size": [3.6, 1.14, 2.4], "position": [0, 0.16, 0], "faces": { "all": "cream" } }
```

`"all"` is for the faces it does not name. A new colour is one more stone palette in `assets/palettes.json`.

Doors, windows, and holes go in a `details` list next to `shapes`, one line each:

```json
{ "form": "rect", "at": [1.12, 0.585, 3.6], "facing": [0, 0, 1], "size": [0.5, 0.85], "palette": "wood", "frame": { "palette": "wood-dark", "width": 0.03 } }
```

Follow the rules of `documentation/building/README.md`, section 10, so that they show right.

A new terrain type only needs a file, with `"builder": "mountain"` or `"builder": "cliff"`, for example
`assets/terrain/volcano/terrain.json`, then `"terrain/volcano/medium"` in `borders`.
