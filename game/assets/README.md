# game/assets

Everything the game draws or reads as data, sorted by kind of asset. The code is in `game/src/`. The server
reads these files from the disk, and the client fetches them (the server serves this folder at `/assets/`).
Both read the same files, so they make the same map.

```
assets/
├── buildings/          one folder per building: building.json + textures/
│   ├── chichi-house/
│   ├── buu-house/
│   ├── capsule-ship/
│   └── raditz-pod/     no textures: its colors are in the "pod" block
├── terrain/
│   ├── terrain.json    how the map is made from the seed (size, coast, ponds, dirt, mountains, buildings)
│   └── ground-cover/   the grass tufts and flowers atlases of the renderer
├── props/
│   └── rocks.json      rocks (they block the way) and stones (you walk over them)
├── characters/
│   └── player/         the player character: character.json + the FlyFF parts (*.glb), clips, textures/
├── monsters/
│   └── red-cube/       monster.json: the red cube (size, color, life, speed, ranges, damage, how many)
└── items/
    └── loot-cubes.json what a monster drops: small cubes of color
```

## Why this layout

- **One folder per kind** (buildings, terrain, props, characters, monsters, items): you find an asset by what it is.
  It follows the asset kinds of `asset-format` (`buildings/`, `props/`, `ground/`), with the kinds the game adds.
- **One folder per asset when it has files of its own** (a building and its textures, the character and its
  models). Then the asset can be copied or removed as one folder. Assets that are only numbers are one JSON file.
- **Data, not code.** Sizes, colors, speeds, life and damage are in the JSON files, not in the code. Change a
  number here, restart the server, reload the clients.
- **Made from a seed, not stored.** The map (terrain, rocks, stones, mountains, where the buildings go) is not
  stored: it is made by `src/shared/worldgen.ts` from `terrain.json`, `rocks.json` and the seed. So `props/` and
  `terrain/` hold the rules, not the result.

## Where each asset comes from

| Asset | From |
| --- | --- |
| `buildings/chichi-house`, `buu-house`, `capsule-ship` | `documentation/building/textured/<name>/` (the plan, renamed `building.json`, and `textures/`, unchanged) |
| `buildings/raditz-pod` | `documentation/building/example/raditz-pod.json` (drawn by `buildPod`, copied from `tools/scene/src/main.ts`) |
| `terrain/ground-cover/` | `packages/renderer/assets/` of the `gpt` branch |
| `characters/player/` | `documentation/building/tools/scene/web/char/` (the FlyFF male: parts, `mvr_male.glb` clips, textures) |
| `terrain.json`, `rocks.json`, `monster.json`, `loot-cubes.json`, `character.json` | written for the game |

## The files

- `building.json`: the plan format of `documentation/building/README.md` (`shapes`, `textures`; `faces` is a list).
  `pod` (Raditz only): the sphere with its door cut out.
- `terrain.json`: `size` (meters, 256), `seed` (the default; the server can take another with `SEED=`), `cell`
  (meters per cell of the ground grid), `coast`, `ponds`, `dirt`, `mountains` (noise scale, threshold, height,
  colors, `blockAbove`: from this height a mountain blocks the way), `buildings` (how far from the center, the free
  margin around each, the space between them), `spawn`.
- `rocks.json`: `rocks` (grid spacing, rock fields from noise, more at the foot of the mountains, sizes, colors) and
  `stones`.
- `character.json`: the parts and the clip of each animation (`idle`, `walk`, `attack`, `hit`, `dead`), the speed,
  life, attack reach, arc, damage and period.
- `monster.json`: the red cube: size, color, life, speeds, `aggroRange` (it sees a player), `leashRange` (it gives
  up), attack reach, damage, windup and period, `count` on the map, `respawnSeconds`, `safeZoneRadius` (it does not
  go near the spawn).
- `loot-cubes.json`: size, colors, how many cubes a monster drops, how long they stay on the ground.
