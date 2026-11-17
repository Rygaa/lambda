#!/usr/bin/env bash
# Prepares the preview tool. Run it once, from anywhere inside the repo, after `git fetch origin gpt`.
# It takes the game renderer and the shape code from the gpt branch, installs three.js, and builds dist/bundle.js.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf vendor && mkdir -p vendor assets dist
git -C "$(git rev-parse --show-toplevel)" archive origin/gpt packages/renderer packages/asset-format | tar -x -C vendor
cp vendor/packages/renderer/assets/*.png assets/
npm install --silent --no-audit --no-fund
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/bundle.js --log-level=error \
  --alias:@lambda/renderer=./vendor/packages/renderer/src/index.ts --tsconfig-raw='{}'
echo "Preview tool ready. Try: node render.cjs game <plan.json> out.png"
