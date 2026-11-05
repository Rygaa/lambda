// The game server: the only one, it has the authority. It runs the ECS world, takes the players' commands,
// and sends each player the state around them, TICK_RATE times a second. It also serves the client page.
//   PORT=8080 SEED=1337 node dist/server.js
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { createComponents, type Entity } from "../shared/components.ts";
import { World } from "../shared/ecs.ts";
import { createRandom, hashSeed } from "../shared/noise.ts";
import { spawnMonsterSpawner, spawnPlayer } from "../shared/prefabs.ts";
import { ANIM_STATES, NET_KINDS, round2, TICK_RATE, VIEW_RADIUS, type ClientMessage, type NetEntity, type ServerMessage } from "../shared/protocol.ts";
import { playerSpawnPoint, runSystems, SERVER_SYSTEMS, type SimContext } from "../shared/systems.ts";
import { GameMap } from "../shared/worldgen.ts";
import { assetsDir, loadConfigFromDisk } from "./assets.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8080);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 16);
// LAMBDA_DEBUG=1: the clients may teleport (for the screenshots of the tests). Off by default.
const DEBUG = process.env.LAMBDA_DEBUG === "1";

const config = await loadConfigFromDisk(root);
const seed = Number(process.env.SEED ?? config.terrain.seed);
const t0 = Date.now();
const map = new GameMap(seed, config);
console.log(`Map ${map.size} x ${map.size} m, seed ${seed} (${Date.now() - t0} ms): ${map.rocks.length} rocks, ${map.stones.length} stones`);
for (const b of map.buildings) console.log(`  ${b.id} at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);

const world = new World();
const c = createComponents(world);
const context: SimContext = { c, map, config, dt: 1 / TICK_RATE, time: 0, random: createRandom(hashSeed(seed, "server", Date.now())) };
spawnMonsterSpawner(world, c, config);

type Client = { socket: WebSocket; entity: Entity; attack: boolean; ack: number };
const clients = new Set<Client>();

// ---------------------------------------------------------------- static files (the client page)
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".css": "text/css",
};
const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file: string | null = null;
  const clean = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (url.pathname === "/" || url.pathname === "/index.html") file = path.join(root, "web", "index.html");
  else if (clean.startsWith("assets" + path.sep) || clean.startsWith("assets/")) file = path.join(assetsDir(root), clean.slice("assets/".length));
  else if (clean.startsWith("dist/")) file = path.join(root, clean);
  if (!file || !file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(file).pipe(res);
});

// ---------------------------------------------------------------- players
const wss = new WebSocketServer({ server: http, path: "/ws" });
const send = (socket: WebSocket, message: ServerMessage) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(message));

wss.on("connection", (socket) => {
  let client: Client | null = null;
  socket.on("message", (data) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message.t === "hello" && !client) {
      if (clients.size >= MAX_PLAYERS) {
        send(socket, { t: "full", reason: `Le serveur est plein (${MAX_PLAYERS} joueurs).` });
        socket.close();
        return;
      }
      const name = String(message.name ?? "").trim().slice(0, 16) || `Joueur ${clients.size + 1}`;
      const p = playerSpawnPoint(map, context.random, config.character.radius);
      const entity = spawnPlayer(world, c, config, name, p.x, p.z);
      client = { socket, entity, attack: false, ack: 0 };
      clients.add(client);
      send(socket, { t: "welcome", id: entity, seed, tickRate: TICK_RATE });
      console.log(`+ ${name} joined (entity ${entity}), ${clients.size} player(s)`);
    } else if (message.t === "input" && client) {
      const input = c.input.get(client.entity);
      if (!input) return;
      const len = Math.hypot(Number(message.moveX) || 0, Number(message.moveZ) || 0);
      const k = len > 1 ? 1 / len : 1;
      input.moveX = (Number(message.moveX) || 0) * k;
      input.moveZ = (Number(message.moveZ) || 0) * k;
      if (message.attack) client.attack = true;
      client.ack = Math.max(client.ack, Number(message.seq) || 0);
    } else if (message.t === "teleport" && client && DEBUG) {
      const t = c.transform.get(client.entity);
      const x = Number(message.x), z = Number(message.z);
      if (t && map.isFree(x, z, config.character.radius)) {
        t.x = x;
        t.z = z;
      }
    }
  });
  socket.on("close", () => {
    if (!client) return;
    clients.delete(client);
    console.log(`- ${c.player.get(client.entity)?.name} left, ${clients.size} player(s)`);
    world.destroy(client.entity);
  });
});

// ---------------------------------------------------------------- the simulation
let tick = 0;
function step() {
  for (const client of clients) {
    const input = c.input.get(client.entity);
    if (input) {
      input.attack = client.attack;
      input.seq = client.ack;
    }
    client.attack = false;
  }
  runSystems(world, SERVER_SYSTEMS, context);
  context.time += context.dt;
  tick++;
  world.takeDestroyed();

  const all: { e: Entity; x: number; z: number; data: NetEntity }[] = [];
  for (const e of world.query(c.net, c.transform)) {
    const t = c.transform.get(e)!;
    const anim = c.anim.get(e);
    const h = c.health.get(e);
    const label = c.player.get(e)?.name ?? c.item.get(e)?.color ?? "";
    all.push({
      e, x: t.x, z: t.z,
      data: [e, NET_KINDS.indexOf(c.net.get(e)!.kind), round2(t.x), round2(t.z), round2(t.rot), ANIM_STATES.indexOf(anim?.state ?? "idle"), round2(anim?.time ?? 0), round2(h?.hp ?? 0), h?.max ?? 0, label],
    });
  }
  for (const client of clients) {
    const me = c.transform.get(client.entity);
    if (!me) continue;
    const ents = all.filter((a) => c.player.has(a.e) || Math.hypot(a.x - me.x, a.z - me.z) < VIEW_RADIUS).map((a) => a.data);
    send(client.socket, { t: "snap", tick, time: round2(context.time), ack: client.ack, ents });
  }
}

let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += (now - last) / 1000;
  last = now;
  let steps = 0;
  while (acc >= context.dt && steps < 5) {
    step();
    acc -= context.dt;
    steps++;
  }
  if (steps === 5) acc = 0;
}, 1000 / TICK_RATE / 2);

http.listen(PORT, "0.0.0.0", () => {
  if (DEBUG) console.log("LAMBDA_DEBUG=1: teleport allowed (tests only).");
  console.log(`\nLambda server ready on port ${PORT}. Players join with one of:`);
  console.log(`  http://localhost:${PORT}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) if (net.family === "IPv4" && !net.internal) console.log(`  http://${net.address}:${PORT}/`);
  }
});
