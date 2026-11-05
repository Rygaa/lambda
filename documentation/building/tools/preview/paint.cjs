// node paint.cjs <plan.json> <out.png>
// Paints red the quads of the door of a plan with a "pod" block (example/raditz-pod.json), on the closed sphere,
// in 4 views (the game angle, the front, the right side, the top): the check made with the user before cutting the door
// (example/raditz-pod-door-faces.png). Build dist/faces.js first (see door.cjs).
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = __dirname;
(async () => {
  const [planFile, out] = process.argv.slice(2);
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/html" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/faces.html`);
  await page.waitForFunction(() => window.paintedView);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const views = [[0, 0.65, 1], [0, 0.05, 1], [1, 0.05, 0], [0, 1, 0.001]];   // game angle, front, right side, top
  const urls = [];
  for (const from of views) urls.push(await page.evaluate(([p, f]) => window.paintedView(p, p.pod.center,
    (e, a) => e > p.pod.box[0] && e < p.pod.box[1] && Math.abs(a) < p.pod.box[2], f, [0, 1, 0], 1.6), [plan, from]));
  const img = await page.evaluate(async (urls) => {
    const ims = await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
    const c = document.createElement("canvas"); c.width = 1606; c.height = 1206;
    const g = c.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, c.width, c.height);
    ims.forEach((im, k) => g.drawImage(im, (k % 2) * 806, Math.floor(k / 2) * 606));
    return c.toDataURL("image/png");
  }, urls);
  fs.writeFileSync(out, Buffer.from(img.split(",")[1], "base64"));
  await browser.close(); server.close(); console.log("wrote", out);
})();
