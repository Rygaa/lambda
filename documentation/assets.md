# Assets

This guide says how the assets of the game are sorted and named, and the plan to build it. It is made for many
assets: hundreds of stones, trees, and other things, not only the ones we have today.

## 1. The rule

An asset is sorted by what it does in the world, not by what it is made of.

So a mountain is not a big stone: it changes the shape of the ground, so it is `terrain`. A puddle and an ocean are
both `water`, because both are water.

## 2. Families and types

A family is what the asset does. A type is a real kind of thing inside a family, with its own shape rules or its own
behavior. Two things of different sizes are not two types.

- `terrain`: it changes the ground itself.
  Types: `plain`, `cliff`, `mountain`. Ground colors: `grass`, `sand`, `dirt`, `pavement`, `field`.
- `water`: it is water. It cuts the ground and uses the water of `pixel-scene` version-3.
  Types: `puddle` (you walk through it), `pond`, `lake`, `river`, `ocean`.
- `rock`: a stone placed on the ground.
  Types: `sharp`, `round`, `flat`.
- `plant`: it grows.
  Types: `oak`, `pine`, `palm`, `bush`.
- `building`: it is built.
  Types: `chichi-house`, `buu-house`, `capsule-ship`, `raditz-pod`.
- `creature`: it moves by itself.
  Types: `player`, `pet`, `monster`.
- `item`: it can be picked up.
  Types: `loot-cube`.

A new kind of thing is a new type in the right family, for example `rock/crystal` or `plant/cactus`.

## 3. The name of one asset

One stone or tree in the world has a name of 5 parts:

```
family/type/size/palette/variant
```

- `size`: `small`, `medium`, or `large`.
- `palette`: the colors. The shape does not change.
- `variant`: a number from 1. Each number gives another shape of the same type, made from the seed. So there is no
  file per shape, and there is no limit on the number of shapes.

Examples:

```
rock/sharp/small/grey/1
rock/sharp/small/grey/2      the same kind of stone as 1, with another shape
rock/round/large/grey/1
rock/sharp/medium/sand/4
rock/round/small/moss/3
plant/oak/small/green/1
plant/oak/large/autumn/2
plant/bush/medium/pine/1
plant/palm/large/green/1
water/pond/medium/clear/1
water/lake/medium/swamp/2
```

## 4. The files

One folder per type, with one JSON file named after the family. These exist today:

```
assets/
├── palettes.json         every colour, by family, and the themes
├── render.json           the camera, the sun, the material ids, the sprite atlases
├── textures/             the sprite atlases: grass tufts, flowers, leaf clumps
├── rock/
│   ├── sharp/rock.json
│   └── round/rock.json
├── plant/
│   ├── oak/plant.json
│   ├── bush/plant.json
│   └── palm/plant.json
└── water/
    ├── puddle/water.json
    ├── pond/water.json
    ├── lake/water.json
    ├── river/water.json
    └── ocean/water.json
```

`assets/rock/sharp/rock.json`:

```json
{
  "about": "A stone with flat faces: the hull of a few random points. ...",
  "builder": "sharp-rock",
  "variants": 6,
  "palettes": ["grey", "sand", "moss", "dark", "cliff"],
  "sizes": {
    "small": {"width": [0.3, 0.5], "depth": [0.26, 0.44], "height": [0.14, 0.28], "points": 8, "sink": [0.03, 0.05], "lean": 0},
    "medium": {"width": [0.65, 0.95], "depth": [0.6, 0.85], "height": [0.8, 1.2], "points": [9, 11], "sink": 0.12, "lean": 0.08},
    "large": {"width": [1.2, 1.5], "depth": [1.0, 1.3], "height": [1.0, 1.5], "points": 12, "sink": 0.12, "lean": 0}
  }
}
```

- `about`: what the type is, and what its values mean.
- `builder`: the code that makes its shapes, in `web/gen/builders/`. Two types can share a builder: `plant/oak` and
  `plant/bush` both use `tree`.
- `variants`: how many different shapes of each size a world makes.
- `palettes`: a list of palette names when the type has one colour family (a rock: `stone`). A type with more
  families names the colours of each: `plant/oak` has `"green": { "trunk": "brown", "canopy": "green" }`. The first
  palette is the default.
- `sizes`: the values of the builder for `small`, `medium`, and `large`. A type has only the sizes it needs.

The values are in the units of `pixel-scene`: a person is about 1 unit tall.

`assets/palettes.json` holds every colour, by family (`stone`, `trunk`, `canopy`, `water`, `ground`, `cover`), and
the themes (`dbz`, `namek`). A theme replaces palettes by name.

An asset made by hand (for example a tree made in Blender) will be one more type, with fixed variants: its files in
its folder, and `variant` picks one of them.

## 5. The order of placement

A world is made in this order. Each step keeps out of what the steps before it placed:

1. `terrain`: the ground, the cliffs, the mountains.
2. `water`: the ocean first, then the lakes, rivers, ponds, and puddles.
3. `building`.
4. `rock` and `plant`: the large ones first, then the small ones.
5. `creature` and `item`.

So a stone never stands in a pond, and a tree never stands in a house. Today the code does steps 1, 2, and 4: the
cliffs and borders, then the ocean, then every recipe line, the big objects first.

## 6. Where each type comes from

The types come from `pixel-scene` version-3 (commit `9da4216`, `web/gen/kinds/`), with these names:

- `rock/sharp`: the `rock` kind (a hull of random points with flat faces). `pebble` became `small`, `stone`
  became `medium`, and `crag` became `large`.
- `rock/round`: the `boulder` kind (a bumpy cube pushed towards a sphere). `small` stayed `small`, and `big` became
  `large`. It has no `medium` yet.
- `plant/oak`: the `tree` kind. `big` became `large`.
- `plant/bush`: the `bush` preset of the `tree` kind. It has one size, `medium`.
- `plant/palm`: the `palm` kind. `tall` became `large`, and `small` stayed `small`.
- `water/puddle`, `water/pond`, `water/lake`, `water/ocean`: the presets of the `water` kind. Its `stream`
  became `water/river`. Each has one size, `medium`.
- The palettes and themes: `web/gen/palettes.js` became `assets/palettes.json`.
- Terrain: the cliffs, the mountain borders, and the ground paints are still fields of a world recipe (`cliffs`,
  `borders`, `ground`, see `worlds.md`), not type files.

Left out on purpose: the player and the slimes, the houses (`kame`, `goku`), the Blender pieces (ruins, old
layouts), the first and third person views, and the `dbz` world (a map of buildings).

## 7. The plan

Do each step on a `try/` branch, then move it to `attempt_1` (see `branches.md`).

1. Done: `pixel-scene` version-3 is saved (commit `9da4216`).
2. Done: `attempt_1` starts from the nature of `pixel-scene` version-3, in JavaScript with no build step, in its
   units.
3. Done: the `assets/` folders and one JSON file per type, with the values of `pixel-scene`.
4. Done: `assets/palettes.json`.
5. Done: the code reads `assets/` and turns a name (`family/type/size/palette/variant`) into a shape
   (`web/gen/assets.js`, `web/gen/shapes.js`).
6. To do: worlds that ask by tags, for example "plants with the tag `forest`". Then a type file gets `"tags"`.
7. Done: the test world `worlds/all-types.json`, with every type in every size, in rows.
8. To do: new types, one at a time: `rock/flat`, `plant/pine`, `rock/round/medium`, sizes for water. Terrain type
   files (`terrain/cliff`, `terrain/mountain`) when the terrain gets more kinds.
