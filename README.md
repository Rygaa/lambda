# Projet Lambda

A top-down game in real 3D that looks like 2D pixel art. The style follows `documentation/style/3d-pixel-art-rendering/`. `documentation/style/rules.md` lists the rules we took from it.

The game itself is not started yet. For now this repo has the asset studio.

## Structure

```
packages/renderer/      the 3D pixel art look, ported from pixel-scene: color bands, outlines, god rays, clouds, grass
packages/asset-format/  asset.json: its schema, and the code that builds a 3D model from it
apps/asset-studio/      makes assets with Infer (port 9300, server on 9310)
assets/                 the asset library: buildings/, props/, ground/
```

Every 3D view uses `packages/renderer`, so an asset looks the same in the studio and later in the game.

## Asset studio

1. **New asset**: a name, a kind (building, prop, or ground), and a prompt, a reference image, or both. Both can change later.
2. **Shapes**: Infer reads the prompt, looks at the reference if there is one, and returns a plan of simple shapes (box, cylinder, wedge, pyramid, dome) and texture slots. Doors and windows are real small shapes; a door has the role `door`. Then Infer checks its work 2 times: the page renders the shapes in flat colors from the game camera and from above, and Infer compares them with the reference and fixes the plan. You see it in 3D, turn it, and can redo it with a note.
3. **Textures**: Infer paints each slot from the prompt and the reference. The studio shrinks each one to about 44 texels per meter (1 per game pixel) and 16 colors. You can redo one texture at a time.
4. **Mark ready**: saves a picture for the library. Only ready assets go into maps.

One asset is one folder: `asset.json`, `reference.png`, `thumbnail.png`, `textures/<slot>.png`, and `history/` with every shape plan and texture it replaced.

Setup:

```sh
cp apps/asset-studio/.env.example apps/asset-studio/.env.dev
```

Fill `INFER_API_KEY` and the Bucket values. Infer reads images for shape plans only from Bucket, so the studio uploads each reference there once. Bucket is not used for prompt-only assets.

## Run

Requirements: Node.js 24 and pnpm 11.3.0.

```sh
nvm use
pnpm install
pnpm studio   # http://127.0.0.1:9300
```

Checks:

```sh
pnpm typecheck
pnpm build
```
