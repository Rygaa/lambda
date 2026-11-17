#!/usr/bin/env bash
# Prepares the scene tool. Run it once, after `git fetch origin gpt` and after tools/preview/setup.sh
# (it reuses the three.js of tools/preview). It takes the game renderer from the gpt branch, applies
# renderer.patch (see README.md), and builds the 3 bundles:
#   web/dist/bundle.js, bundle-low.js   the game as it is (PIXEL_SCALE 4)
#   web/dist/bundle-high.js, bundle-dbg.js   4x finer pixels (PIXEL_SCALE 1, PIXELS_PER_METER x4), for the characters
set -euo pipefail
cd "$(dirname "$0")"
[ -d ../preview/node_modules ] || { echo "run tools/preview/setup.sh first"; exit 1; }
rm -rf vendor && mkdir -p vendor web/dist web/assets
git -C "$(git rev-parse --show-toplevel)" archive origin/gpt packages/renderer packages/asset-format | tar -x -C vendor
(cd vendor && patch -s -p1 < ../renderer.patch)
cp vendor/packages/renderer/assets/*.png web/assets/
ln -sfn ../preview/node_modules node_modules
C=vendor/packages/renderer/src/constants.ts
build() { npx esbuild src/main.ts --bundle --format=esm --outfile="web/dist/$1" --log-level=error \
  --alias:@lambda/renderer=./vendor/packages/renderer/src/index.ts --tsconfig-raw='{}'; }
build bundle.js
build bundle-low.js
sed -i 's|^export const PIXEL_SCALE = 4;|export const PIXEL_SCALE = 1;|; s|^export const PIXELS_PER_METER = 480 / 11;|export const PIXELS_PER_METER = 4 * 480 / 11;|' $C
grep -q "PIXEL_SCALE = 1;" $C || { echo "constants.ts changed on gpt: update setup.sh"; exit 1; }
build bundle-high.js
build bundle-dbg.js
sed -i 's|^export const PIXEL_SCALE = 1;|export const PIXEL_SCALE = 4;|; s|^export const PIXELS_PER_METER = 4 \* 480 / 11;|export const PIXELS_PER_METER = 480 / 11;|' $C
echo "Scene tool ready. See README.md."
