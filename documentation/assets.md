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
├── character/player/     the human: the FlyFF male (from the game Fly For Fun), its parts, clips and textures,
│                         from the voxel branch (web/lib/character.js)
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
- `plant/leafy`: new, not from `pixel-scene`: the 3 leafy plants of FlyFF (`obj_macoprgr04`, `05`, `06`), one per
  variant. `assets/plant/leafy/import-leafy.mjs` reads their stems and the leaves of their pictures, and writes them
  into `plant.json` (`models`). Its own builder, `leafy` (`web/gen/builders/leafy.js`), makes them in our style: stems
  with outlines, each leaf a sheet with a raised rib, no leaf clumps.
- `rock/slab`, `rock/stack`, `rock/cluster`, `rock/split`: new, not from `pixel-scene` (your request). They use the
  `rock-form` builder with its `form` value.
- `plant/pine`, `plant/fir`, `plant/cypress`, `plant/birch`, `plant/willow`, `plant/fruit`: new, not from
  `pixel-scene` (your request). They use the `tree` builder with its `form` value (the canopy shape).
- `water/puddle`, `water/pond`, `water/lake`, `water/ocean`: the presets of the `water` kind. Its `stream`
  became `water/river`. Each has one size, `medium`.
- The palettes and themes: `web/gen/palettes.js` became `assets/palettes.json`.
- `terrain/cliff`: the numbers of the recipe field `cliffs`, moved to a type file. `medium` has the numbers of the
  `coast` world, and `large` has those of the `mountains` world.
- `terrain/mountain`: the numbers of the mountain borders in `web/gen/terrain.js`, moved to a type file. It has one
  size, `medium`.
- Ground paints are still a field of a world recipe (`ground`, see `worlds.md`), not type files.
- `building/chichi-house`, `building/buu-house`, `building/capsule-ship`: the plans of the branch `voxel`
  (`game/assets/buildings/`), with their shapes and numbers. Each face names a stone palette in place of a texture.
  The colours are the main colours of their old textures. They have one size, `medium`, and one palette, `classic`.

A terrain type has no `variants`. It is part of the ground, not an object placed on it, so its shape comes from the
world seed and each world gets its own. Its name stops at the size: `terrain/mountain/medium`.

A building is a plan, with one variant: nothing in it is random, so its name ends with `/classic/1`.

- `building/kame-house`: the `kame` preset of the `house` kind (`web/gen/kinds/house.js`), brought back on
  `try/island-start` as its own builder, `kame-house`, with the stone palettes `pink` and `roof` added.
- `building/boat`: new, not from `pixel-scene` (your request): the builder `boat`. FlyFF has no boat, only flying boards.

Left out on purpose: the player and the slimes, the house `goku` (code, not plans), `raditz-pod` (its door
needs its own code, the `pod` block), the painted textures, the Blender pieces (ruins, old layouts), the first and
third person views, and the `dbz` world (a map of buildings).

## 7. FlyFF, ours, or archived

Every asset is in one of these groups.

**From FlyFF** (the game Fly For Fun): copied from the FlyFF data folder by a script, never changed by hand.

| Path | What | Script |
| --- | --- | --- |
| `assets/character/player/` (but `ual/`) | the human (the FlyFF male), its parts, clips, clothes, weapons and shields | `import-items.mjs` |
| `assets/character/npc/` (but `npcs.json`) | the FlyFF female (`mvr_female.glb`), its heads, hair, bare body and the Chinese dresses; the textures of opaque clothes made opaque | `import-npcs.mjs` |
| `assets/monsters/` | the 569 monsters, their 127 models and clips, their stats and the levels | `import-monsters.mjs` |
| `assets/objects/` (`objects.json`, `models/`) | the 1018 decor objects (chairs, fences, lamps, houses...), drawn in our style | `import-objects.mjs` |
| `worlds/maps/flarine.json` | the centre of Flarine: its ground, water, ground textures (as our paints) and its objects | `worlds/maps/import-map.mjs` |

**Ours**: made by our code (`web/gen/builders/`) from the numbers of a type file, in our style.

| Path | What |
| --- | --- |
| `assets/rock/` | every rock type (and the crystals, `rock/crystal`) |
| `assets/plant/` | every tree, the bush and the palm (`plant/leafy`: see below) |
| `assets/water/`, `assets/terrain/` | water, cliffs and mountains |
| `assets/building/` | the 3 building plans, the cave mouth, the Kame House (code of `pixel-scene` version-3), the boat, and the mine things (frame, rails, minecart, crates, torch: `web/gen/builders/mine.js`) |
| `assets/palettes.json`, `assets/render.json`, `assets/textures/` | the colours, the render settings, the sprites of grass, flowers and leaf clumps |

Two cases in between:

- `plant/leafy` is ours (our builder, our style), but its form is taken from the 3 leafy plants of FlyFF
  (`import-leafy.mjs` reads them).
- `assets/character/player/ual/` is neither: the sword hits of Quaternius (CC0, see its `License.txt`).

**Archived**: FlyFF objects we keep for now and will delete later, each with why, in `assets/objects/archived.json`:
2 objects that float in the air, the 3 leafy plants and the 46 trees. Their models are still in
`assets/objects/models/`, but no map places them: our oaks and our `plant/leafy` take the place of the trees and the
plants (recipe `trees` and `plants`, `worlds.md`).

## 8. The plan

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
8. To do: new types, one at a time: `rock/round/medium`, sizes for water, `terrain/mountain` in `small` and
   `large`. Done: `plant/pine` and the other new trees, `rock/slab` and the other new rocks.
9. Done: the type files `terrain/cliff` and `terrain/mountain`, with the numbers that were in the code.
10. To do: mountains made with noise, and chunks for huge maps.
11. Done: the builder `building` and the types `building/chichi-house`, `building/buu-house`, `building/capsule-ship`.
12. Done: doors, windows, and holes as `details` in palette colors (see `building/README.md`, section 10).
13. To do: the red signs on the Chichi dome, theme lines for the building palettes.
