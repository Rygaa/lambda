# Preview tool

Draws a building plan, so you can compare it with its reference image (step 5 of the building guide).

## Set up (once)

From the repo, with the `gpt` branch fetched (`git fetch origin gpt`):

```bash
./documentation/building/tools/preview/setup.sh
```

It copies the game renderer and the shape code from the `gpt` branch into `vendor/`, installs three.js, and builds `dist/bundle.js`. Playwright and Chromium are already installed in the cloud sessions.

## Use

```bash
node documentation/building/tools/preview/render.cjs <command> ...
```

| Command | What it draws |
| --- | --- |
| `game <plan.json> <out.png> [rotation]` | the game view, with the real game renderer. `rotation` turns the model, in degrees. |
| `turns <plan.json> <out.png>` | the game view from 4 sides (0, 90, 180, 270), in a grid: check that nothing floats or cuts through. |
| `view <plan.json> <out.png> [--from=x,y,z] [--target=x,y,z] [--half=4.2]` | a plain view from any direction, 800 × 600, not stretched. The default looks from the front, a little to the right and above, like a photo. `--target` is the point looked at; `--half` is half the view width in meters. |
| `compare <left image> <right image> <out.png>` | two images side by side at the same height (png, jpg, or webp). |

## Compare with the reference

1. Draw the plan from the angle of the reference: `view` with `--from` set so the main part faces you as on the reference.
2. Put it next to the reference: `compare reference.png view.png compare.png`.
3. Look at the length, height, depth, and outline of each part, and where it is highest. Fix the plan and draw again until it matches.
4. Check the game view (`game`) and the other sides (`turns`).

Example, for the Buu house (run from `documentation/building`):

```bash
node tools/preview/render.cjs view example/buu-house.json /tmp/side.png --target=0.3,1.2,0
node tools/preview/render.cjs compare example/buu-reference.png /tmp/side.png /tmp/compare.png
```

The result is `example/buu-compare-side.png`.
