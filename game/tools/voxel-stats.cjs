// Measures the voxels in a client (Chromium, Playwright): load times, terrain chunks, quads.
// The server must run with LAMBDA_DEBUG=1. node tools/voxel-stats.cjs [voxel per meter...]   e.g. 8 16 43.6
const { chromium } = require("playwright");
const SERVER = process.env.SERVER ?? "localhost:8080";
const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ["16"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    const t0 = Date.now();
    await page.goto(`http://${SERVER}/?name=Stats&voxel=${size}${process.env.QUERY ?? ""}`);
    await page.waitForFunction(() => window.__lambda?.ready, null, { timeout: 600000 });
    const ready = Date.now() - t0;
    // the mountain with rocks (seed 1337)
    await page.evaluate(() => window.__lambda.teleport(32, -61.5));
    await sleep(8000);
    const r = await page.evaluate(() => {
      const L = window.__lambda;
      let quads = 0;
      L.renderer.scene.traverse((o) => { if (o.isMesh && o.geometry?.index && o.material?.uniforms?.uUseMap?.value) quads += o.geometry.index.count / 6; });
      return { timings: L.timings, terrain: L.voxelStats(), quadsInScene: quads };
    });
    console.log(`voxel 1/${size} m: page ready in ${(ready / 1000).toFixed(1)} s`, JSON.stringify(r));
    await page.close();
  }
  await browser.close();
})();
