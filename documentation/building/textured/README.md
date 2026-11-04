# Textured buildings

The 3 example buildings (Chichi house, Buu house, Capsule Corp ship) with their textures painted on.
`scene-3-buildings.png` shows them side by side in the game view.

- `capsule/`, `buu/`, `chichi/`: the textured plans. The JSON is the plan from `../example/`, with one texture
  slot per face that carries a picture (`"file": "textures/<slot>.png"`).
- `infer-cache/`: every image Infer made (`<name>.png`) with the prompt it got (`<name>.txt`). The paint scripts
  only read this cache, so they run without Infer and without a key.

## Keep it simple

The textures are simple and shared: the same wood for every door, the same glass (`glass`) for every window and
porthole of the 3 buildings, the same tiles on every roof. Only signs and letters have their own picture.

## Scripts

| File | What it does |
| --- | --- |
| `painter.py` | Paints a plan: for every texel of every face it finds the exact 3D point (same triangles as `geometry.ts`), then asks the decals what color goes there. Decals: `Projected` (a flat picture pushed along a direction), `Cylindrical` (a picture wrapped around the vertical axis), `FaceDecal` (a picture on one face of a box). |
| `infer_client.py` | Asks Infer for an image (`INFER_API_KEY` in the environment, never in a file), keeps it in `infer-cache/`, and turns it into texels (real size, 16 colors, no dithering). |
| `jobs.py` | Every image asked from Infer: building, size in meters, main color, what to paint. `python3 jobs.py [name...]` makes the missing ones. |
| `paint_capsule.py`, `paint_buu.py`, `paint_chichi.py` | Place the pictures on each building (positions measured on its reference) and write `<building>/`. |

```bash
cd documentation/building/textured
python3 paint_buu.py                         # writes buu/buu-house.json and buu/textures/
INFER_API_KEY=... python3 jobs.py buu-clay   # asks Infer again for one image (delete its png in infer-cache/ first)
```

Draw a textured plan with `../tools/preview` (`render.cjs game`) or with `../tools/scene`.
