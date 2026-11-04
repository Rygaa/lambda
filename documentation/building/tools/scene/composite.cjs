// node composite.cjs <out.png> <gap> <plan.json>...   (env CHARS, TARGET, VIEW=w,h, CLOUDS)
// The scene in game pixels (PIXEL_SCALE 4) with the characters drawn 4x finer on top (PIXEL_SCALE 1).
const http = require("http"), fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "web");
const [out, gap, ...planFiles] = process.argv.slice(2);
const readPlan = (f) => {
  const plan = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const t of plan.textures) if (t.file) { const p = path.join(path.dirname(f), t.file); if (fs.existsSync(p)) t.data = "data:image/png;base64," + fs.readFileSync(p).toString("base64"); }
  return plan;
};
const plans = planFiles.map(readPlan);
const CHARS = JSON.parse(process.env.CHARS || "[]"), TARGET = process.env.TARGET ? JSON.parse(process.env.TARGET) : null;
const [W, H] = (process.env.VIEW || "1600,1000").split(",").map(Number);
// The fine pass can be a smaller box at the middle of the view (WebGL limits its size).
const [WH, HH] = (process.env.VIEW_HIGH || `${W},${H}`).split(",").map(Number);
const clouds = process.env.CLOUDS !== "0";
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary" }[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
server.listen(0, "127.0.0.1", async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const shot = async (page, mode, file, W, H) => {
    const p = await browser.newPage({ viewport: { width: W, height: H } });
    p.on("pageerror", (e) => console.error("page error:", e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/${page}`);
    await p.evaluate(([w, h]) => { const v = document.getElementById("view"); v.style.width = w + "px"; v.style.height = h + "px"; }, [W, H]);
    await p.waitForFunction(() => window.sceneView);
    const r = await p.evaluate(([pl, g, c, t, cl, m]) => window.sceneView(pl, g, 0, c, t, cl, m), [plans, Number(gap), CHARS, TARGET, clouds, mode]);
    fs.writeFileSync(file, Buffer.from(r.url.split(",")[1], "base64"));
    await p.close();
    return { file, ex: r.ex, ey: r.ey, scale: r.scale, W, H };
  };
  try {
    const low = await shot("index-low.html", "charsHidden", out.replace(".png", "-low.png"), W, H);
    const high = await shot("index-high.html", "charsOnly", out.replace(".png", "-high.png"), WH, HH);
    fs.writeFileSync(out.replace(".png", "-meta.json"), JSON.stringify({ W, H, low, high }));
    execFileSync("python3", [path.join(__dirname, "composite.py"), out.replace(".png", "-meta.json"), out], { stdio: "inherit" });
  } finally { await browser.close(); server.close(); }
});
