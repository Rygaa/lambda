// node render.cjs game <plan.json> <out.png> [rotation]
// node render.cjs turns <plan.json> <out.png>
// node render.cjs scene <out.png> <gap> <plan.json>...
// node render.cjs view <plan.json> <out.png> <fx,fy,fz> <tx,ty,tz> <half>
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "web");
const readPlan = (f) => {
  const plan = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const t of plan.textures) if (t.file) {
    const p = path.join(path.dirname(f), t.file);
    if (fs.existsSync(p)) t.data = "data:image/png;base64," + fs.readFileSync(p).toString("base64");
  }
  return plan;
};
// CHARS='[{"file":"chars/3d_new.js","x":-4.5,"z":1.5,"rot":0}]' adds characters to "scene"; TARGET='{"x":0,"y":1,"z":0}' moves the view.
const readChar = (f) => { const s = fs.readFileSync(f, "utf8"); return JSON.parse(s.slice(s.indexOf("export default") + 14).trim().replace(/;\s*$/, "")); };
const CHARS = JSON.parse(process.env.CHARS || "[]").map((c) => (c.file ? { ...c, data: readChar(c.file) } : c));
const TARGET = process.env.TARGET ? JSON.parse(process.env.TARGET) : null;
const write = (f, url) => fs.writeFileSync(f, Buffer.from(url.split(",")[1], "base64"));
const [cmd, ...a] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary" }[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
server.listen(0, "127.0.0.1", async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const big = cmd === "scene";
    const [W, H] = process.env.VIEW ? process.env.VIEW.split(",").map(Number) : big ? [4000, 1600] : [1556, 1184];
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    page.on("console", (m) => { if (m.type() === "error" || m.text().startsWith("layout") || m.text().startsWith("flyff")) console.error("console:", m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${process.env.PAGE || "index.html"}`);
    await page.evaluate(([w, h]) => { const v = document.getElementById("view"); v.style.width = w + "px"; v.style.height = h + "px"; }, [W, H]);
    await page.waitForFunction(() => window.sceneView);
    if (cmd === "game") write(a[1], await page.evaluate(([p, r]) => window.sceneView([p], 0, r), [readPlan(a[0]), Number(a[2] || 0)]));
    else if (cmd === "turns") {
      for (const r of [0, 90, 180, 270]) write(a[1].replace(".png", `-${r}.png`), await page.evaluate(([p, r]) => window.sceneView([p], 0, r), [readPlan(a[0]), r]));
    } else if (cmd === "scene") write(a[0], await page.evaluate(([p, g, c, t, cl]) => window.sceneView(p, g, 0, c, t, cl), [a.slice(2).map(readPlan), Number(a[1]), CHARS, TARGET, process.env.CLOUDS !== "0"]));
    else if (cmd === "view") write(a[1], await page.evaluate(([p, f, t, h]) => window.angleView(p, f, t, h), [readPlan(a[0]), a[2].split(",").map(Number), a[3].split(",").map(Number), Number(a[4])]));
    console.log("wrote", cmd === "scene" ? a[0] : a[1]);
  } finally { await browser.close(); server.close(); }
});
