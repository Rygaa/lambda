# Projet Lambda: the game

An online game in the style of `documentation/building/tools/scene` (the renderer and the shape code of the `gpt`
branch, copied into `src/engine/`). One server has the authority; players join it with its address in a browser.

## Run it

Needs Node.js 22 or newer.

```bash
cd game
npm install
npm run build
npm start
```

The server prints the addresses players can use, for example:

```
Lambda server ready on port 8080. Players join with one of:
  http://localhost:8080/
  http://192.168.1.20:8080/
```

A player opens that address in a browser (Chrome, Firefox, Edge), types a name and clicks "Rejoindre". The address
can also carry the name: `http://192.168.1.20:8080/?name=Aissa`.

| Setting | Default | |
| --- | --- | --- |
| `PORT` | `8080` | the port of the page and of the WebSocket (`/ws`) |
| `SEED` | `terrain.json` seed (1337) | another seed makes another map |
| `MAX_PLAYERS` | `16` | |
| `LAMBDA_DEBUG` | off | `1` lets clients teleport (only for the test screenshots) |

```bash
PORT=9000 SEED=42 npm start
```

From another network, open the port on the router (TCP) or put the server behind a tunnel.

**Controls:** move with W A S D (Z Q S D on an AZERTY keyboard, the same keys) or the arrows; attack with Space,
J, or a left click.

## What is in the game

- **The map** (256 × 256 m, about a minute to cross on foot) is made from a seed with noise: an island in the sea,
  beaches, ponds, dirt patches, mountains with snow on top (they block the way), rocks (they block) and stones.
  The server sends only the seed: every client makes the same map with the same code.
- **The 4 buildings**, exactly one of each: Chichi's house, Buu's house, the Capsule Corp ship and Raditz's pod.
  Each goes on flat, dry ground, with a free margin around it, far from the others, and nothing else on it.
- **My character** (the FlyFF male) walks, stands, attacks, is hit and dies, with the clips of `mvr_male.glb`.
  It comes back at the spawn 3 seconds after it dies, and heals slowly.
- **Monsters**: 60 red cubes. They wander, chase a player they see (9 m), give up when too far (16 m), and hit
  in front of them. A dead one leaves 2 to 4 small cubes of color on the ground (they stay 3 minutes), and a new
  monster comes 5 seconds later, far from the players. They do not go into the 8 m around the spawn.
- **Online**: every player sees the other players, the same monsters and the same items.

## How the code is made

```
game/
├── assets/            the data and the models, by kind (see assets/README.md)
├── src/
│   ├── engine/        copied from the gpt branch: renderer/ (PixelRenderer) and asset-format/ (shapes)
│   ├── shared/        the code of both the server and the client
│   │   ├── ecs.ts         World, Store, System
│   │   ├── components.ts  every component (data only)
│   │   ├── systems.ts     every system (all the game logic)
│   │   ├── prefabs.ts     the components each kind of entity starts with
│   │   ├── worldgen.ts    the map from the seed
│   │   ├── noise.ts       seeded random numbers, simplex noise
│   │   ├── protocol.ts    the network messages
│   │   └── config.ts      the types of the asset files
│   ├── server/        main.ts: the simulation, the WebSocket, the page
│   └── client/        main.ts, net.ts (client systems), render.ts (render system), terrain.ts, buildings.ts, character.ts
├── web/index.html
└── tools/             map-preview.ts (the map from above), screenshots.cjs (the test screenshots)
```

### Strict ECS

- An **entity** is a number.
- A **component** is plain data in a store: `transform`, `velocity`, `collider`, `player`, `input`, `health`,
  `melee`, `monster`, `ai`, `anim`, `item`, `lifetime`, `dead`, `net`, `spawner` (and on the client `interp`,
  `local`). No methods, no three.js objects.
- A **system** is a function `(world, context)`. All the logic is there.

The server runs, 20 times a second: `spawners`, `steerPlayers`, `playerAttacks`, `monsterAI`, `meleeHits`,
`movement`, `separation`, `health`, `deaths`, `lifetimes`, `animations` (`src/shared/systems.ts`).

The client has its own world with the same components and the same ids as the server. Each frame it runs
`applySnapshots` (the server state into the world), `predict` (the shared `steerPlayers` and `movement` on my own
player, so it moves at once), `interpolate` (the others, 0.12 s behind the server, between two states),
`advanceAnims`, and `render` (it keeps a three.js object for each entity, inside the system).

### Network

- Client → server: `hello` (name), then `input` 30 times a second (move direction, attack pressed, number).
- Server → client: `welcome` (my entity id, the seed), then `snap` 20 times a second: every entity within 45 m
  (and every player), with position, facing, animation, life and label. An entity missing from a `snap` is gone.
- The server checks everything (speed, walls, reach, damage). The client only sends what the keys say.

### The look

The renderer is the one of the game (`PixelRenderer`: 4 screen pixels per game pixel, 43.6 game pixels per meter,
outlines, flat bands, cloud shadows, god rays, dust, grass tufts). Two small additions in `src/engine/renderer/`:

- `uChar` (from `documentation/building/tools/scene/renderer.patch`): the character gets its outline but no fold
  lines on its round arms.
- `rowMap` on the ground material: one texture gives the ground row of each 25 cm cell (grass, sand, dirt), and
  water where it is 255. So the whole island is one ground mesh, with its coast and its foam line.

## Tests

```bash
npm run build
node dist/map-preview.js map.png            # the map from above, 4 px per meter
LAMBDA_DEBUG=1 npm start &
W=1920 H=1080 node tools/screenshots.cjs shots   # 2 clients in Chromium (Playwright): buildings, walk, attack, ...
```
