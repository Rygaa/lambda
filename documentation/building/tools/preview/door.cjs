// node door.cjs <plan.json> <outDir> [frames=16]
// The door of a plan with a "pod" block (example/raditz-pod.json), from closed to open (pod.openMax), in plain views:
// outDir/d<k>.png, 3 views side by side (the game angle, from the front right, from the right side), with flat colors.
// Run ./setup.sh first, then build the page once:
//   npx esbuild src/faces.ts --bundle --format=esm --outfile=dist/faces.js --log-level=error --tsconfig-raw='{}'
// (the hinge bar and the arms are drawn only by the scene tool, tools/scene, buildPod)
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = __dirname;
(async () => {
  const [planFile, dir, n = "16"] = process.argv.slice(2);
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/html" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/faces.html`);
  await page.waitForFunction(() => window.doorView);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const pod = plan.pod;
  const views = [[[0, 0.65, 1], [0, 0.85, 0.5]], [[0.75, 0.9, 1], [0, 0.85, 0.5]], [[1, 0.08, 0], [0, 0.85, 0.5]]];
  const N = Number(n);
  fs.mkdirSync(dir, { recursive: true });
  for (let k = 0; k <= N; k++) {
    const angle = pod.openMax * (0.5 - 0.5 * Math.cos((Math.PI * k) / N));
    const urls = [];
    for (const [f, t] of views) urls.push(await page.evaluate(([p, a, f, t]) =>
      window.doorView(p, p.pod.center, p.pod.box, p.pod.hinge, a, f, t, 2.0, p.pod.look), [plan, angle, f, t]));
    const img = await page.evaluate(async (urls) => {
      const ims = await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
      const c = document.createElement("canvas"); c.width = 3 * 400 + 12; c.height = 300;
      const g = c.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, c.width, c.height);
      ims.forEach((im, k) => g.drawImage(im, k * 406, 0, 400, 300));
      return c.toDataURL("image/png");
    }, urls);
    fs.writeFileSync(path.join(dir, `d${String(k).padStart(2, "0")}.png`), Buffer.from(img.split(",")[1], "base64"));
  }
  await browser.close(); server.close(); console.log("wrote", dir);
})();
