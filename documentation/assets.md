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
  Types: `plain`, `cliff`, `mountain`. Ground colors: `grass`, `sand`, `dirt`.
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
- `variant`: a number. Each number gives another shape of the same type, made from the seed. So there is no file
  per shape, and there is no limit on the number of shapes.

Examples:

```
rock/sharp/small/grey/1
rock/sharp/small/grey/2      the same kind of stone as 1, with another shape
rock/round/large/grey/1
rock/sharp/medium/sand/4
rock/flat/small/moss/3
plant/oak/small/green/1
plant/oak/large/autumn/2
plant/pine/medium/pine/1
plant/palm/large/green/1
water/pond/medium/clear/1
water/lake/large/swamp/2
```

## 4. The files

One folder per type, with one JSON file named after the family:

```
assets/
├── palettes.json
├── terrain/
│   ├── cliff/terrain.json
│   └── mountain/terrain.json
├── water/
│   ├── puddle/water.json
│   ├── pond/water.json
│   ├── lake/water.json
│   ├── river/water.json
│   └── ocean/water.json
├── rock/
│   ├── sharp/rock.json
│   ├── round/rock.json
│   └── flat/rock.json
└── plant/
    ├── oak/plant.json
    ├── pine/plant.json
    ├── palm/plant.json
    └── bush/plant.json
```

`assets/rock/sharp/rock.json` (the sizes are the `rock` presets of `pixel-scene`, in its units: the player is about 1
unit tall):

```json
{
  "tags": ["forest", "beach", "river", "mountain"],
  "blocks": true,
  "palettes": ["grey", "sand", "moss", "dark"],
  "sizes": {
    "small":  { "width": [0.3, 0.5],  "depth": [0.26, 0.44], "height": [0.14, 0.28] },
    "medium": { "width": [0.65, 0.95], "depth": [0.6, 0.85],  "height": [0.8, 1.2] },
    "large":  { "width": [1.2, 1.5],  "depth": [1.0, 1.3],   "height": [1.0, 1.5] }
  }
}
```

`assets/plant/oak/plant.json` (a tree has 2 parts, so each palette names the colors of both):

```json
{
  "tags": ["forest"],
  "blocks": true,
  "palettes": {
    "green":  { "trunk": "brown", "canopy": "green" },
    "autumn": { "trunk": "brown", "canopy": "autumn" }
  },
  "sizes": {
    "small":  { "trunk": 1.4, "canopy": [0.95, 1.08, 0.95] },
    "medium": { "trunk": 1.7, "canopy": [1.18, 1.32, 1.18] },
    "large":  { "trunk": 2.0, "canopy": [1.42, 1.58, 1.42] }
  }
}
```

`assets/palettes.json` holds every color, by part (`stone`, `trunk`, `canopy`, `water`, `ground`), and the themes
(`dbz`, `namek`). A theme changes all the palettes at once.

A world does not list names one by one. It asks by tags, for example "plants with the tag `forest`". Then a new type
with that tag shows up in every forest, and no world changes.

An asset made by hand (for example a tree made in Blender) is one more type, with fixed variants: its files are in
its folder, and `variant` picks one of them.

## 5. The order of placement

A world is made in this order. Each step keeps out of what the steps before it placed:

1. `terrain`: the ground, the cliffs, the mountains.
2. `water`: the ocean first, then the lakes, rivers, ponds, and puddles.
3. `building`.
4. `rock` and `plant`: the large ones first, then the small ones.
5. `creature` and `item`.

So a stone never stands in a pond, and a tree never stands in a house.

## 6. Where each type comes from

Most types already exist in `pixel-scene` version-3 (`web/gen/kinds/`), with other names:

- `rock/sharp`: the `rock` kind (a hull of random points with flat faces). `pebble` becomes `small`, `stone`
  becomes `medium`, and `crag` becomes `large`.
- `rock/round`: the `boulder` kind (a bumpy cube pushed towards a sphere). Its `small` stays `small`, `big` becomes
  `large`, and `medium` is new.
- `rock/flat`: new.
- `plant/oak`: the `tree` kind. Its `big` becomes `large`.
- `plant/bush`: the `bush` preset of the `tree` kind.
- `plant/palm`: the `palm` kind. `tall` becomes `large`, and `small` stays `small`.
- `plant/pine`: new. It uses the `pine` canopy palette.
- `water/puddle`, `water/pond`, `water/lake`, `water/ocean`: the presets of the `water` kind. Its `stream`
  becomes `water/river`.
- `terrain/cliff`, `terrain/mountain`: `web/gen/terrain.js` and the mountain borders of `web/gen/borders.js`.
- The palettes and themes: `web/gen/palettes.js`.
- `building`, `creature`, `item`: the `game` branch, `game/assets/`.

## 7. The plan

Do each step on a `try/` branch, then move it to `attempt_1` (see `branches.md`).

1. Save `pixel-scene` version-3: commit its current changes there, so the water we want cannot be lost.
2. Decide which code `attempt_1` starts from (see section 8).
3. Make the `assets/` folders and one JSON file per type from section 6, with the values of `pixel-scene`.
4. Write `assets/palettes.json` from `web/gen/palettes.js`.
5. Write the code that reads `assets/` and turns a name (`family/type/size/palette/variant`) into a shape. It
   works like `web/gen/registry.js` of `pixel-scene`, but it reads the JSON files.
6. Write the placement: the order of section 5, and worlds that ask by tags.
7. Make a test world with every type, in every size, in a row. Put a screenshot of each family in this folder.
8. Then add new types one at a time.

## 8. Open questions

- Which code does `attempt_1` start from: `pixel-scene` version-3 (the water we want, one player, JavaScript), the
  `game` branch (the online game, TypeScript, made in meters), or a new start that takes parts of both?
- `pixel-scene` uses its own units (the player is about 1 unit tall) and `game` uses meters. Which one do the asset
  files use?
