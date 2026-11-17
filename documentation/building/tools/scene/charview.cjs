// node charview.cjs <char.js> <out.png> <mode parts|screen> <fx,fy,fz>
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "web");
const [file, out, mode, from] = process.argv.slice(2);
const src = fs.readFileSync(file, "utf8");
const data = JSON.parse(src.slice(src.indexOf("export default") + 14).trim().replace(/;\s*$/, ""));
const tex = {};
for (const p of data.screen || []) if (p.tex && !tex[p.tex]) tex[p.tex] = "data:image/png;base64," + fs.readFileSync(path.join(path.dirname(file), p.tex)).toString("base64");
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
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => window.charView);
    const url = await page.evaluate(([d, m, t, f]) => window.charView(d, m, t, f, 0.95), [data, mode, tex, from.split(",").map(Number)]);
    fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
    console.log("wrote", out);
  } finally { await browser.close(); server.close(); }
});
