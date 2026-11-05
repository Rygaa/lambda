// Takes the test screenshots with 2 clients in Chromium (Playwright). The server must run with LAMBDA_DEBUG=1
// (teleport) on SERVER (default localhost:8080):
//   LAMBDA_DEBUG=1 node dist/server.js &
//   node tools/screenshots.cjs <out dir> [steps...]     steps: buildings mountain walk attack monster kill items pet players overview
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const SERVER = process.env.SERVER ?? "localhost:8080";
const OUT = process.argv[2] ?? "screenshots";
const STEPS = process.argv.slice(3);
const want = (step) => STEPS.length === 0 || STEPS.includes(step);
// screenshots at VIEW; between them the pages are small (SMALL), so the software renderer keeps up with the game
const VIEW = { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 900) };
const SMALL = { width: 640, height: 360 };
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function open(browser, name, query = "") {
  const page = await browser.newPage({ viewport: SMALL });
  page.on("pageerror", (e) => log(name, "pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && log(name, "console:", m.text().slice(0, 200)));
  await page.goto(`http://${SERVER}/?name=${encodeURIComponent(name)}${query}`);
  await page.waitForFunction(() => window.__lambda?.ready, null, { timeout: 240000 });
  return page;
}
// the client picture is frozen during the screenshot (it takes seconds with the software renderer)
const shot = async (page, file) => {
  // freeze the picture on this instant, stop my player (the server keeps running), take the shot at full size
  const m = await page.evaluate(() => (window.__lambda.freeze(true), window.__lambda.setMove(0, 0), window.__lambda.entities().find((e) => e.id === window.__lambda.localId)));
  await page.setViewportSize(VIEW);
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, file), timeout: 180000 });
  await page.setViewportSize(SMALL);
  await page.evaluate(() => window.__lambda.freeze(false));
  log("saved", file, m ? `(me at ${m.x.toFixed(1)}, ${m.z.toFixed(1)}, ${m.anim})` : "");
};
const me = (page) => page.evaluate(() => window.__lambda.entities().find((e) => e.id === window.__lambda.localId));
const ents = (page) => page.evaluate(() => window.__lambda.entities());
async function teleport(page, x, z) {
  await page.evaluate(([x, z]) => window.__lambda.teleport(x, z), [x, z]);
  for (let k = 0; k < 60; k++) {
    const m = await me(page);
    if (m && Math.hypot(m.x - x, m.z - z) < 0.6) break;
    await sleep(200);
  }
  await sleep(2500);
}
// walks toward (x, z) until within `stop` meters (straight line)
async function walkTo(page, x, z, stop, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const m = await me(page);
    const dx = x - m.x, dz = z - m.z, d = Math.hypot(dx, dz);
    if (d < stop) break;
    await page.evaluate(([a, b]) => window.__lambda.setMove(a, b), [dx / d, dz / d]);
    await sleep(120);
  }
  await page.evaluate(() => window.__lambda.setMove(0, 0));
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const a = await open(browser, "Aissa");
  log("client 1 ready");
  const buildings = await a.evaluate(() => window.__lambda.map.buildings.map((b) => ({ id: b.id, x: (b.footprint.minX + b.footprint.maxX) / 2, z: b.footprint.maxZ, cz: (b.footprint.minZ + b.footprint.maxZ) / 2 })));

  if (want("buildings")) {
    for (const b of buildings) {
      // my player in front of the building, a little to the right; the camera on the building
      await teleport(a, b.x + 1.5, b.z + 1.2);
      await a.evaluate(([x, z]) => window.__lambda.setLook(x, z, 1.4), [b.x, b.cz + 1.2]);
      await a.evaluate(() => window.__lambda.setMove(-0.2, 1));
      await sleep(250);
      await a.evaluate(() => window.__lambda.setMove(0, 0));
      await sleep(2500);
      await shot(a, `building-${b.id}.png`);
    }
    await a.evaluate(() => window.__lambda.setLook());
  }

  if (want("mountain")) {
    // a mountain with rocks at its foot (seed 1337: x 32, z -64), my player in front of it
    const [mx, mz] = (process.env.MOUNTAIN ?? "32,-64").split(",").map(Number);
    await teleport(a, mx, mz + 2.5);
    await a.evaluate(([x, z]) => window.__lambda.setLook(x, z, 1.4), [mx, mz - 1]);
    await sleep(2500);
    await shot(a, "mountain-rocks.png");
    await a.evaluate(() => window.__lambda.setLook());
  }

  if (want("walk") || want("attack")) {
    // an open place: a few meters from the spawn
    await teleport(a, 3, 3);
    await a.evaluate(() => window.__lambda.setMove(1, 0.3));
    await sleep(1800);
    if (want("walk")) await shot(a, "player-walk.png");
    await a.evaluate(() => window.__lambda.setMove(0, 0));
    await sleep(1200);
    if (want("attack")) {
      await a.evaluate(() => window.__lambda.setMove(0, 1));
      await sleep(150);
      await a.evaluate(() => window.__lambda.setMove(0, 0));
      await a.evaluate(() => window.__lambda.attack());
      // the swing: the attack clip is about half way
      for (let k = 0; k < 100; k++) {
        const t = await a.evaluate(() => { const L = window.__lambda; const an = L.c.anim.get(L.localId); return an?.state === "attack" ? an.time : -1; });
        if (t > 0.3) break;
        await sleep(20);
      }
      await shot(a, "player-attack.png");
      await sleep(1200);
    }
  }

  if (want("monster") || want("kill")) {
    // the nearest monster outside the safe zone with no other monster near it
    const m0 = await me(a);
    const all = (await ents(a)).filter((e) => e.kind === "monster" && Math.hypot(e.x, e.z) > 14);
    const alone = all.filter((p) => all.every((q) => q === p || Math.hypot(p.x - q.x, p.z - q.z) > 7));
    const monsters = alone.length ? alone : all;
    monsters.sort((p, q) => Math.hypot(p.x - m0.x, p.z - m0.z) - Math.hypot(q.x - m0.x, q.z - m0.z));
    let target = monsters[0];
    log("monster", target);
    await teleport(a, target.x + 2.5, target.z + 1.5);
    if (want("monster")) {
      // wait until a monster near me is in its attack (the jump)
      for (let k = 0; k < 120; k++) {
        const list = await ents(a);
        const mm = list.find((e) => e.id === target.id);
        // the jump at the player: just after the windup
        const t = await a.evaluate((id) => window.__lambda.c.anim.get(id)?.time ?? 0, target.id);
        if (mm && mm.anim === "attack" && t > 0.48 && t < 0.62) {
          await shot(a, "monster-attack.png");
          break;
        }
        await sleep(20);
      }
    }
    if (want("kill")) {
      for (let k = 0; k < 40; k++) {
        const list = await ents(a);
        const mm = list.find((e) => e.id === target.id);
        const m1 = list.find((e) => e.kind === "player");
        log("kill", k, mm ? `monster ${mm.anim} hp ${mm.hp} at ${mm.x.toFixed(1)},${mm.z.toFixed(1)}` : "monster gone", m1 ? `me ${m1.anim} hp ${m1.hp?.toFixed(1)} at ${m1.x.toFixed(1)},${m1.z.toFixed(1)}` : "");
        if (!mm || mm.anim === "dead") break;
        if (m1 && Math.hypot(m1.x - mm.x, m1.z - mm.z) > 6) await teleport(a, mm.x + 1.5, mm.z + 1);
        await walkTo(a, mm.x, mm.z, 1.4, 3000);
        // face it: one short step toward it, then hit
        const m = await me(a);
        const d = Math.hypot(mm.x - m.x, mm.z - m.z) || 1;
        await a.evaluate(([x, z]) => window.__lambda.setMove(x, z), [(mm.x - m.x) / d, (mm.z - m.z) / d]);
        await sleep(80);
        await a.evaluate(() => window.__lambda.setMove(0, 0));
        await a.evaluate(() => window.__lambda.attack());
        await sleep(800);
      }
      await sleep(1500);
      const items = (await ents(a)).filter((e) => e.kind === "item");
      log("items on the ground:", items.length);
      await shot(a, "monster-killed-loot.png");
    }
  }

  if (want("items")) {
    // kill an isolated monster, then pick up an item with the button
    const killNear = async () => {
      const m0 = await me(a);
      const all = (await ents(a)).filter((e) => e.kind === "monster" && Math.hypot(e.x, e.z) > 14);
      const alone = all.filter((p) => all.every((q) => q === p || Math.hypot(p.x - q.x, p.z - q.z) > 8));
      const list = alone.length ? alone : all;
      list.sort((p, q) => Math.hypot(p.x - m0.x, p.z - m0.z) - Math.hypot(q.x - m0.x, q.z - m0.z));
      const target = list[0];
      await teleport(a, target.x + 1.2, target.z + 0.8);
      for (let k = 0; k < 40; k++) {
        const now = await ents(a);
        const mm = now.find((e) => e.id === target.id);
        if (!mm || mm.anim === "dead") return;
        const m = now.find((e) => e.id === (m0.id));
        if (m && Math.hypot(m.x - mm.x, m.z - mm.z) > 6) await teleport(a, mm.x + 1.2, mm.z + 0.8);
        await walkTo(a, mm.x, mm.z, 1.3, 3000);
        const mp = await me(a);
        const d = Math.hypot(mm.x - mp.x, mm.z - mp.z) || 1;
        await a.evaluate(([x, z]) => window.__lambda.setMove(x, z), [(mm.x - mp.x) / d, (mm.z - mp.z) / d]);
        await sleep(80);
        await a.evaluate(() => window.__lambda.setMove(0, 0));
        await a.evaluate(() => window.__lambda.attack());
        await sleep(700);
      }
    };
    await killNear();
    log("killed; inventory", JSON.stringify(await a.evaluate(() => window.__lambda.inventory())));
    // walk onto the nearest item until the button shows
    for (let k = 0; k < 30; k++) {
      if (await a.isVisible("#pickup")) break;
      const items = (await ents(a)).filter((e) => e.kind === "item");
      const m = await me(a);
      if (!items.length) break;
      items.sort((p, q) => Math.hypot(p.x - m.x, p.z - m.z) - Math.hypot(q.x - m.x, q.z - m.z));
      await walkTo(a, items[0].x, items[0].z, 0.8, 600);
    }
    if (await a.isVisible("#pickup")) {
      // the picture freezes on this instant and the button is clicked at once (the pet is quick)
      const before = await a.evaluate(() => {
        const inv = window.__lambda.inventory();
        window.__lambda.freeze(true);
        document.getElementById("pickup").click();
        return inv;
      });
      await a.setViewportSize(VIEW);
      await sleep(2500);
      await a.screenshot({ path: path.join(OUT, "pickup-button.png"), timeout: 180000 });
      log("saved pickup-button.png");
      await a.setViewportSize(SMALL);
      await a.evaluate(() => window.__lambda.freeze(false));
      await sleep(600);
      log("after the button: inventory", JSON.stringify(before), "->", JSON.stringify(await a.evaluate(() => window.__lambda.inventory())));
    } else log("no item within reach (the pet took them all first)");
    await sleep(2500);
    log("inventory", JSON.stringify(await a.evaluate(() => window.__lambda.inventory())), "stats", JSON.stringify(await a.evaluate(() => window.__lambda.stats())));
    await shot(a, "inventory.png");

    // the pet: kill another monster, stand still, and catch the pet on its way to an item
    await killNear();
    const inv0 = await a.evaluate(() => window.__lambda.inventory());
    for (let k = 0; k < 200; k++) {
      const list = await ents(a);
      const myPet = list.find((e) => e.kind === "pet" && e.owner === (list.find((p) => p.name === "Aissa") ?? {}).id);
      const items = list.filter((e) => e.kind === "item");
      if (myPet && myPet.anim === "walk" && items.some((i) => Math.hypot(i.x - myPet.x, i.z - myPet.z) < 1.5)) {
        await shot(a, "pet-pickup.png");
        break;
      }
      await sleep(30);
    }
    await sleep(4000);
    log("the pet picked up:", JSON.stringify(inv0), "->", JSON.stringify(await a.evaluate(() => window.__lambda.inventory())));
  }

  if (want("pet")) {
    await teleport(a, 3, 3);
    await a.evaluate(() => window.__lambda.setMove(1, 0.2));
    await sleep(2500);
    await shot(a, "pet-follow.png");
  }

  if (want("players")) {
    const b = await open(browser, "Ami");
    log("client 2 ready");
    const m = await me(a);
    await teleport(b, m.x + 1.6, m.z + 0.4);
    await b.evaluate(() => window.__lambda.setMove(-1, 0));
    await sleep(200);
    await b.evaluate(() => window.__lambda.setMove(0, 0));
    await sleep(2500);
    await shot(a, "players-client1.png");
    await shot(b, "players-client2.png");
    await b.close();
  }

  if (want("overview")) {
    const o = await open(browser, "Vue", `&scale=1&look=${process.env.LOOK ?? "-60,-20"}`);
    await sleep(4000);
    await shot(o, "overview.png");
    await o.close();
  }
  await browser.close();
})();
