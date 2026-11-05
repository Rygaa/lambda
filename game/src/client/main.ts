// The client: it joins the server, makes the same map from the seed it gets, sends my commands and draws the
// state the server sends. The page is served by the server: http://<server address>:<port>/?name=<my name>
import { PixelRenderer } from "../engine/renderer/index.ts";
import { createComponents } from "../shared/components.ts";
import { loadConfig, type GameConfig } from "../shared/config.ts";
import { World } from "../shared/ecs.ts";
import { createRandom } from "../shared/noise.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { runSystems } from "../shared/systems.ts";
import { GameMap } from "../shared/worldgen.ts";
import { buildBuildings } from "./buildings.ts";
import { loadCharacterLibrary } from "./character.ts";
import { advanceAnims, applySnapshots, interpolate, predict, type ClientContext } from "./net.ts";
import { createRenderSystem } from "./render.ts";
import { buildGround, buildMountains, buildRocks, createGroundCoverManager } from "./terrain.ts";

const params = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;
const status = (text: string) => ($("status").textContent = text);

async function fetchJson(path: string) {
  const res = await fetch(`assets/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function askJoin(): Promise<{ name: string; server: string }> {
  const name = params.get("name");
  const server = params.get("server") ?? location.host;
  if (name) return Promise.resolve({ name, server });
  const form = $("join") as HTMLFormElement;
  form.style.display = "";
  ($("server") as HTMLInputElement).value = server;
  ($("name") as HTMLInputElement).focus();
  return new Promise((resolve) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      form.style.display = "none";
      resolve({ name: ($("name") as HTMLInputElement).value.trim() || "Joueur", server: ($("server") as HTMLInputElement).value.trim() || location.host });
    });
  });
}

async function main() {
  const configPromise = loadConfig(fetchJson);
  const join = await askJoin();
  status(`Connexion à ${join.server}…`);
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${join.server}/ws`);
  const send = (message: ClientMessage) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(message));
  const inbox: Extract<ServerMessage, { t: "snap" }>[] = [];
  const welcome = await new Promise<Extract<ServerMessage, { t: "welcome" }>>((resolve, reject) => {
    socket.addEventListener("open", () => send({ t: "hello", name: join.name }));
    socket.addEventListener("error", () => reject(new Error(`Impossible de joindre le serveur ${join.server}.`)));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.t === "welcome") resolve(message);
      else if (message.t === "snap") {
        inbox.push(message);
        if (inbox.length > 40) inbox.shift();
      } else if (message.t === "full") reject(new Error(message.reason));
    });
  });
  socket.addEventListener("close", () => status("Déconnecté du serveur."));

  status("Génération de la carte…");
  const config: GameConfig = await configPromise;
  const map = new GameMap(welcome.seed, config);
  const renderer = new PixelRenderer($("view"));
  // ?scale=1: smaller game pixels, to see more of the map (for overviews; the game uses 4)
  if (params.get("scale")) renderer.setPixelScale(Number(params.get("scale")));
  renderer.scene.add(buildGround(renderer, map), buildMountains(renderer, map), buildRocks(renderer, map), await buildBuildings(renderer, map));
  const updateGroundCover = createGroundCoverManager(renderer, map);
  status("Chargement du personnage…");
  const library = await loadCharacterLibrary(renderer, config.character);

  const world = new World();
  const c = createComponents(world);
  const ctx: ClientContext = { c, map, config, dt: 0, time: 0, random: createRandom(1), localId: welcome.id, inbox, serverClock: { offset: 0, ready: false }, now: performance.now() / 1000, realDt: 0 };
  const render = createRenderSystem(renderer, library, $("labels"));
  const systems = [applySnapshots, predict, interpolate, advanceAnims, render];

  // ------------------------------------------------------------ input
  const held = new Set<string>();
  let attackQueued = false;
  let seq = 0;
  let lastSend = 0;
  const debug: { move: [number, number] | null; frozen: boolean } = { move: null, frozen: false };
  addEventListener("keydown", (event) => {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    held.add(event.code);
    if ((event.code === "Space" || event.code === "KeyJ") && !event.repeat) attackQueued = true;
    if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
  });
  addEventListener("keyup", (event) => held.delete(event.code));
  addEventListener("blur", () => held.clear());
  $("view").addEventListener("mousedown", (event) => {
    if (event.button === 0) attackQueued = true;
  });
  const moveInput = (): [number, number] => {
    if (debug.move) return debug.move;
    // event.code is the key place: W A S D on QWERTY is Z Q S D on AZERTY. Screen up is -z.
    const x = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
    const z = (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0) - (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0);
    const len = Math.hypot(x, z) || 1;
    return [x / len, z / len];
  };

  // ------------------------------------------------------------ the frame
  let look = params.get("look")?.split(",").map(Number);
  const hud = $("hud");
  status("");
  renderer.onFrame((seconds) => {
    ctx.dt = seconds;
    const now = performance.now() / 1000;
    ctx.realDt = Math.min(0.5, now - ctx.now);
    ctx.now = now;
    const [mx, mz] = moveInput();
    const input = c.input.get(welcome.id);
    if (input) {
      input.moveX = mx;
      input.moveZ = mz;
    }
    // frozen (tests): the picture stays on one instant, the snapshots that come meanwhile are dropped
    if (debug.frozen) inbox.length = 0;
    runSystems(world, debug.frozen ? [render] : systems, ctx);
    // send my input 30 times a second, and at once for an attack
    if (attackQueued || ctx.now - lastSend > 1 / 30) {
      seq++;
      send({ t: "input", seq, moveX: mx, moveZ: mz, attack: attackQueued });
      const me = c.transform.get(welcome.id);
      const local = c.local.get(welcome.id);
      if (me && local) local.history.push({ seq, x: me.x, z: me.z });
      if (local && local.history.length > 120) local.history.shift();
      attackQueued = false;
      lastSend = ctx.now;
    }
    const me = c.transform.get(welcome.id);
    const target = look ? { x: look[0]!, z: look[1]! } : me;
    if (target) {
      renderer.setTarget({ x: target.x, y: look ? (look[2] ?? 0.8) : 0.8, z: target.z });
      updateGroundCover(target.x, target.z);
    }
    const h = c.health.get(welcome.id);
    const players = [...world.query(c.player)].length;
    hud.innerHTML = `<b>${escape(join.name)}</b> <span class="hp"><i style="width:${h ? (100 * h.hp) / h.max : 0}%"></i></span> ${h ? Math.ceil(h.hp) : 0}/${h?.max ?? 0}` +
      `<br>${players} joueur${players > 1 ? "s" : ""} · ${me ? `x ${me.x.toFixed(0)}, z ${me.z.toFixed(0)}` : ""}` +
      `<br><small>Marcher : ZQSD / WASD / flèches · Attaquer : Espace ou clic</small>`;
  });

  // hooks for the tests (Playwright)
  Object.assign(window, {
    __lambda: {
      ready: true,
      world, c, map, renderer, localId: welcome.id,
      setMove: (x: number, z: number) => (debug.move = x === 0 && z === 0 ? null : [x, z]),
      attack: () => (attackQueued = true),
      freeze: (on: boolean) => (debug.frozen = on),
      teleport: (x: number, z: number) => send({ t: "teleport", x, z }),
      // the camera looks at (x, y, z) instead of my player; no argument: back to my player
      setLook: (x?: number, z?: number, y?: number) => (look = x === undefined ? undefined : [x, z ?? 0, y ?? 0.8]),
      entities: () => [...world.query(c.net, c.transform)].map((e) => ({ id: e, kind: c.net.get(e)!.kind, ...c.transform.get(e)!, anim: c.anim.get(e)?.state, hp: c.health.get(e)?.hp, name: c.player.get(e)?.name })),
    },
  });
}

function escape(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

main().catch((error) => {
  console.error(error);
  status(String(error.message ?? error));
});
