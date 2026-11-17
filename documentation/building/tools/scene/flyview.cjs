// node charview.cjs <char.js> <out.png> <mode parts|screen> <fx,fy,fz>
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "web");
const [clip, time, out, from] = process.argv.slice(2);
const SINGLE = process.env.SINGLE === "1";
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary" }[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
server.listen(0, "127.0.0.1", async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message)); page.on("console", (m) => { if (m.text().startsWith("flyff")) console.error(m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => window.flyffView);
    const url = await page.evaluate(([c, t, f, s, h, ce, w]) => window.flyffView(c, t, f, h, s, ce, w), [clip, Number(time), from.split(",").map(Number), SINGLE, Number(process.env.HALF || 0.95), (process.env.CENTER || "0,0.81,0").split(",").map(Number), process.env.WIRE === "1"]);
    fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
    console.log("wrote", out);
  } finally { await browser.close(); server.close(); }
});
