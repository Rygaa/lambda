# Worlds

This guide says how to open a world and how to write one. The nature (water, rocks, plants, terrain) comes from
`pixel-scene` version-3 (commit `9da4216`), sorted with the names of `assets.md`.

## 1. Open a world

```bash
python3 web/serve.py
```

Then open `http://127.0.0.1:8643/web/?world=all-types`.

- `?world=<name>`: a file of `worlds/`. The default is `meadow`.
- `?seed=<number>`: the same recipe with new shapes and new places.
- `?theme=dbz` or `?theme=namek`: other colours (see section 6).
- `?freeze`: time stops (for screenshots that must match pixel by pixel).
- `?char=<x>,<z>`: where the human stands. The default is the start of the world. `?nochar`: no human.

Keys: the arrows (or W A S D, or Z Q S D) make the human walk, Shift makes it run, Space makes it jump, a click (or
`F`) attacks (click again for the next of 4 hits), and the camera follows it (with `?nochar`, the arrows move the
camera). The wheel zooms, `C` stops or starts the clouds. The `Admin` button at the top left opens a menu. Its `Look` part
switches between `Normal` and `Voxel` (the default): rocks, plants, cliffs, FlyFF objects, the human and the monsters
are drawn with small cubes, with the cube size in pixels (0.5 to 6, 1 by default; rocks, plants and cliffs stop at 1,
because nothing smaller than a pixel shows on them; 0.5 is too much for the human: its 907 frames need 5 GB, the page
gets 3.7) and its light (`like the shape` or `each face`). Only the picture changes: the shapes, what stops the human,
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
(`web/lib/preview.js`). The items are the FlyFF male parts and the FlyFF weapons and shields of
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

The worlds:

- `all-types`: every asset type in every size, in rows, with a mountain border, the ocean, a beach, and a dirt path.
- `walk-test`: one object of each of the first types, in a row.
- `tree-types`: one tree of each type in a row, with no light beams, to compare their shapes.
- `rock-types`: 3 rocks of each rock type, one row per type, with no light beams.
- `flyff-objects`: the 30 FlyFF decor objects of `assets/objects`, in 5 rows.
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
- `clouds`: how much of the ground the cloud shadows cover: `none`, `few`, or `some` (default).
- `pavement`: how the `pavement` paint looks: `tiles` (grey slabs, default) or `bricks` (brown bricks, each row half
  a brick off the one before, like the streets of Flarine).
- `rays`: the strength of the light rays, 0 to 1 (default 1).
- `borders`: what closes each side (section 4).
- `islands`: islands cut out of the ocean (section 4).
- `ground`: paints on the grass (section 5).
- `cliffs`: plateaus in levels, with rock walls and stairs (section 4). No `cliffs`: flat ground.
- `clearings`: open places with light: `amount` or `count` (at most 4), `radius` [min, max], `light` [min, max].
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

## 7. What stops a walker

One rule for every object (`web/gen/collision.js`):

- A rock or a building stops a walker by its real shape (`web/lib/tops.js`): a walker stands on its top, steps up at
  most 0.12 at once (so a slope steeper than about 30° stops it), and must jump to get higher.
- Any other object lower than 25 % of a person does not stop a walker.
- A tree stops a walker only with its trunk. A bush never does.
- Water stops a walker, except puddles.
- A cliff stops a walker: only stairs go up or down.

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
