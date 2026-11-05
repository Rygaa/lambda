# Scene tool

Draws several plans side by side on grass, with characters, in the game view. Its characters can be drawn with
4x finer pixels than the rest, while the buildings stay exactly as in the game.

## Set up (once)

After `git fetch origin gpt` and `tools/preview/setup.sh`:

```bash
./documentation/building/tools/scene/setup.sh
```

It copies the renderer from the `gpt` branch into `vendor/`, applies `renderer.patch`, and builds `web/dist/`.

## renderer.patch

Only for this tool, the game itself is not changed:

- `__freeze`, `__noDust`, `__KEY` (set by the pages in `web/`): stop the time, drop the dust, paint empty pixels magenta,
  so two shots can be laid on each other.
- `snapError`: the camera snap of each shot, to align them.
- `uChar` on the solid material: 1 on characters. They keep their outline, but get no fold lines (the lines the
  game draws where two flat faces meet, which looked like streaks on the round arms).
- `__DBG` 1 to 5: debug views (no outlines, outline map, raw texture, see-through pixels, normals).

## Commands

```bash
cd documentation/building/tools/scene
T=../../textured
# 3 buildings + the FlyFF male, buildings at the game's pixels, the character 4x finer
VIEW=4000,1600 VIEW_HIGH=1200,1200 TARGET='{"x":0,"y":1.2,"z":0}' \
CHARS='[{"flyff":{"clip":"genstand","time":0.3},"x":0.6,"z":2.4,"rot":0}]' \
node composite.cjs /tmp/scene.png 2 $T/chichi/chichi-house.json $T/buu/buu-house.json $T/capsule/capsule-ship.json
# the same scene, everything at the game's pixels
CHARS='[{"file":"chars/3d_new.js","x":-4.5,"z":1.5,"rot":0}]' node render.cjs scene /tmp/scene.png 2 <plan.json>...
# the character alone in the debug views (DBG=0,...,5)
DBG=0,2,4 VIEW=4000,1600 VIEW_HIGH=1200,1200 CHARS='...' node dbg.cjs /tmp/dbg.png 2 <plan.json>...
```

`composite.cjs` takes 2 shots and lays them on each other (`composite.py`):
1. `web/index-low.html`: the scene at `PIXEL_SCALE` 4, the characters hidden (they still cast their shadow).
2. `web/index-high.html`: only the characters, at `PIXEL_SCALE` 1 (the buildings still cast their shadows on them).

Limit: a building in front of a character does not hide it yet.

## Characters

- `web/char/`: the FlyFF male (`part_male*.glb`, the clips in `mvr_male.glb`, textures in PNG). `src/main.ts`
  (`loadFlyff`) poses it with one frame of a clip and freezes it (the game material has no skinning). It also fixes the
  export: the wrong second bone of some vertices (`fixSecondBones`), the triangles on transparent texels, the faces
  turned the wrong way, and the slits where two parts meet (`weldSeams`: the waist, wrists, ankles and neck).
- `chars/3d_new.js`: the "3D New" character (colored parts, no skin).

`images/`: the scene with the character, before/after the fixes, and the debug views.

## Raditz's pod

A plan with a `pod` block (`example/raditz-pod.json`) is drawn by `buildPod` in `src/main.ts`, not by the game's
`buildAssetObject`: the sphere of its 2 domes, the door cut out of its quads and turned around its hinge by `pod.open`
degrees, the porthole (small triangles colored by where they lie), the white inside, the hinge bar and the 2 arms,
all with the game materials. `example/raditz-pod-scene.png` is the scene with the 3 other buildings, closed and open:

```bash
VIEW=6400,1800 node render.cjs scene /tmp/scene.png 2 $T/chichi/chichi-house.json $T/buu/buu-house.json \
  $T/capsule/capsule-ship.json ../../example/raditz-pod.json ../../example/raditz-pod-open.json
# the game view of the door opening, one frame per file (slow: about 2 minutes a frame)
node anim-pod.cjs ../../example/raditz-pod.json /tmp/frames 12
```
