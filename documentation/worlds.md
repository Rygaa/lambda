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

Keys: the arrows move the camera, the wheel zooms, `C` stops or starts the clouds.

The worlds:

- `all-types`: every asset type in every size, in rows, with a mountain border, the ocean, a beach, and a dirt path.
- `walk-test`: one object of each of the first types, in a row.
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
- `rays`: the strength of the light rays, 0 to 1 (default 1).
- `borders`: what closes each side (section 4).
- `islands`: islands cut out of the ocean (section 4).
- `ground`: paints on the grass (section 5).
- `cliffs`: plateaus in levels, with rock walls and stairs (section 4). No `cliffs`: flat ground.
- `clearings`: open places with light: `amount` or `count` (at most 4), `radius` [min, max], `light` [min, max].
- `props`: one line per group of objects. Big objects are placed first.

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
- `plant/oak`: `small`, `medium`, `large`. Palettes `green`, `autumn`, `pine`.
- `plant/bush`: `medium`. Palettes `green`, `autumn`, `pine`. You walk through it.
- `plant/palm`: `small`, `large`. Palettes `green`, `autumn`, `pine` (the fronds; the trunk is always `palm`).
- `water/puddle`, `water/pond`, `water/lake`, `water/river`: `medium`. Palettes `clear`, `swamp`, `glacier`.
- `water/ocean`: `medium`, only for `borders`.

## 4. Terrain: cliffs, mountains, and the ocean

`"cliffs": { "count": 5, "levels": [1, 3], "size": [11, 18], "height": [1.2, 1.8] }` makes the ground in levels
(`web/gen/terrain.js`):

- `count`: the number of plateaus (default 3). Plateaus that touch become one.
- `levels`: how many levels each plateau has, one on top of the other (default [1, 3]).
- `size`: the width of a plateau (default [8, 14]).
- `height`: how high each plateau rises (default [1.2, 1.8]).
- `palette`: the stone palette of the walls (default `cliff`).
- `stairs`: the stone palette of the stairs (default `sand`).

Every level gets stairs down, so every level can be reached. Objects stand only on flat ground, and water stays on
the lowest level.

`"borders": { "west": "mountains", "east": "ocean" }` closes sides of the world (`web/gen/borders.js`). The sides are
`north` (top of the screen), `south` (towards the camera), `west`, and `east`.

- `mountains`: a band of cliffs 6 to 10 units in from the side, about 5 to 7 units high, with no stairs.
- `ocean`: the type `water/ocean`, 5 to 8 units in from the side, with a wavy shore. `{ "kind": "ocean", "width":
  [17, 19] }` makes a wider sea.

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

- An object lower than 25 % of a person does not stop a walker.
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
