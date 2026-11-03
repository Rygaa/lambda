#!/usr/bin/env node
// Renders building plans, to check them against their reference image. Run ./setup.sh once first.
//
//   node render.cjs game    <plan.json> <out.png> [rotation]   game view (real game renderer); rotation turns the model, in degrees
//   node render.cjs turns   <plan.json> <out.png>              the game view from 4 sides (0, 90, 180, 270), in a 2 × 2 grid
//   node render.cjs view    <plan.json> <out.png> [--from=x,y,z] [--target=x,y,z] [--half=4.2]
//                                                              plain view from any direction (default: from the front, a little
//                                                              to the right and above, like a photo); 800 × 600, not stretched
//   node render.cjs compare <left image> <right image> <out.png>   two images side by side, same height (png, jpg, or webp)
//
// Playwright and Chromium are already installed in the cloud sessions.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = __dirname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const readPlan = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeDataUrl = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
const dataUrlOf = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync(file).toString("base64")}`;
};
const vec = (text, fallback) => (text ? text.split(",").map(Number) : fallback);

// Draws images side by side or in a grid, in the page, and returns a PNG data URL.
async function montage(page, urls, columns, cellHeight) {
  return page.evaluate(async ({ urls, columns, cellHeight }) => {
    const images = await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
    const widths = images.map((i) => Math.round((i.width * cellHeight) / i.height));
    const cellWidth = Math.max(...widths);
    const rows = Math.ceil(images.length / columns), gap = 6;
    const canvas = document.createElement("canvas");
    canvas.width = columns * cellWidth + (columns - 1) * gap;
    canvas.height = rows * cellHeight + (rows - 1) * gap;
    const c = canvas.getContext("2d");
    c.fillStyle = "#111"; c.fillRect(0, 0, canvas.width, canvas.height);
    c.imageSmoothingEnabled = false;
    images.forEach((img, k) => c.drawImage(img, (k % columns) * (cellWidth + gap), Math.floor(k / columns) * (cellHeight + gap), widths[k], cellHeight));
    return canvas.toDataURL("image/png");
  }, { urls, columns, cellHeight });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
  const args = rest.filter((a) => !a.startsWith("--"));
  if (!["game", "turns", "view", "compare"].includes(command) || args.length < (command === "compare" ? 3 : 2)) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 12).join("\n").replace(/^\/\/ ?/gm, ""));
    process.exit(1);
  }
  if (command !== "compare" && !fs.existsSync(path.join(ROOT, "dist/bundle.js"))) throw new Error("Run ./setup.sh first.");
  const server = await serve();
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1556, height: 1184 } });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    if (command === "compare") {
      writeDataUrl(args[2], await montage(page, [dataUrlOf(args[0]), dataUrlOf(args[1])], 2, 450));
    } else {
      await page.waitForFunction(() => window.gameView && window.angleView);
      const plan = readPlan(args[0]);
      if (command === "game") {
        writeDataUrl(args[1], await page.evaluate(([p, r]) => window.gameView(p, r), [plan, Number(args[2] || 0)]));
      } else if (command === "turns") {
        const urls = [];
        for (const r of [0, 90, 180, 270]) urls.push(await page.evaluate(([p, r]) => window.gameView(p, r), [plan, r]));
        writeDataUrl(args[1], await montage(page, urls, 2, 298));
      } else {
        const url = await page.evaluate(([p, f, t, h]) => window.angleView(p, f, t, h),
          [plan, vec(flags.from, [0.17, 0.17, 0.97]), vec(flags.target, [0, 1.2, 0]), Number(flags.half || 4.2)]);
        writeDataUrl(args[1], url);
      }
    }
    console.log("wrote", command === "compare" ? args[2] : args[1]);
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
