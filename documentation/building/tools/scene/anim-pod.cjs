// node anim-pod.cjs <plan.json> <outDir> <frames>: the game view of the pod, door from closed to open (pod.openMax)
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "web");
const [planFile, dir, n, from] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" }[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
server.listen(0, "127.0.0.1", async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1556, height: 1184 } });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index-low.html`);  // time stopped: the clouds stay still
    await page.evaluate(() => { const v = document.getElementById("view"); v.style.width = "1556px"; v.style.height = "1184px"; });
    await page.waitForFunction(() => window.sceneView);
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const N = Number(n);
    for (let k = Number(from || 0); k <= N; k++) {
      plan.pod.open = plan.pod.openMax * (0.5 - 0.5 * Math.cos((Math.PI * k) / N));
      const url = await page.evaluate(([p]) => window.sceneView([p], 0, 0, [], { x: 0, y: 1, z: 0 }, true), [plan]);
      fs.writeFileSync(path.join(dir, `g${String(k).padStart(2, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
      process.stdout.write(".");
    }
  } finally { await browser.close(); server.close(); console.log(" done"); }
});
