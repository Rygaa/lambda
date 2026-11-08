# Branches

This guide says how to work with `attempt_1`, the official branch of Projet Lambda, and with the other branches.

## 1. The idea

- `attempt_1` is the official version: stable, well structured, and it changes little.
- Every other branch is a place to try ideas. A try can be messy, and it can fail.
- A piece moves to `attempt_1` only when it works and is clean.

The official copy is on GitHub, in `Rygaa/lambda`.

## 2. What is in `attempt_1`

| Path | What it is |
| --- | --- |
| `assets/` | the asset files: one folder per type (`assets/<family>/<type>/<family>.json`), the colours (`palettes.json`), the render settings (`render.json`), and the sprite textures |
| `worlds/` | the world recipes (see `documentation/worlds.md`) |
| `web/` | the code that makes and draws the worlds, in the browser (`web/serve.py`) |
| `documentation/branches.md` | this guide |
| `documentation/assets.md` | how the assets are sorted and named, and the plan to build it |
| `documentation/worlds.md` | how to open a world, and how to write one |
| `documentation/building/` | how to build a building from a reference image, with examples and tools (see its `README.md`) |
| `documentation/style/` | the style rules (`rules.md`) and the article they come from |

The code here makes and draws the nature only: water, rocks, plants, and terrain, seen from the top. There is no
player, server, or building yet. Some guides name paths that are not here: `packages/renderer` and
`apps/asset-studio/` are on the `gpt` branch, and `game/` is on the `game` and `voxel` branches. These paths are real
only after they move here.

## 3. The rules of `attempt_1`

1. Never try an idea on `attempt_1`. Try it on another branch.
2. Only finished work comes here: it works, it is tested, and it has no leftovers of the try.
3. Keep changes few and small. One commit does one thing.
4. Update the documentation in the same commit as the change.
5. A new folder at the top of the repo is a decision. Add it to section 2 in the same commit.
6. Never force push, and never rewrite the history of this branch.

## 4. Try an idea

Start a new branch from `attempt_1`. Its name is `try/` and the idea:

```bash
git switch attempt_1
git pull git@github.com:Rygaa/lambda.git attempt_1
git switch -c try/my-idea
```

On a `try/` branch, everything is allowed. If the idea needs code from an old branch, copy that code in (see section
5 for the command).

When the try is done, add it to the table in section 6, even if it failed. Keep the branch: a failed try shows what not
to do again.

## 5. Move an idea to `attempt_1`

1. Decide what worked. Keep only that.
2. Copy only the files you need:

   ```bash
   git switch attempt_1
   git checkout try/my-idea -- path/to/the/files
   ```

3. Clean them: remove the debug code, the old variants, and the settings that were only for the try.
4. Put them in the right place, and update the documentation.
5. Check that it works from `attempt_1`, not only from the try.
6. Commit, then push to GitHub:

   ```bash
   git push git@github.com:Rygaa/lambda.git attempt_1
   ```

Never use `git merge` to bring a branch into `attempt_1`:

- A merge brings the whole try, not only the good part.
- `voxel`, `game`, `backup`, and `claude/building-docs` are already in the history of `attempt_1`. `git merge voxel`
  says "Already up to date" and copies nothing, so use `git checkout` as above.

## 6. The branches

These branches stay as they are. Read them and copy from them, but do not build on them.

| Branch | What it has | State |
| --- | --- | --- |
| `gpt` | the asset studio with Infer, `packages/renderer`, `packages/asset-format`, `assets/` | old try, same commit as GitHub `main` |
| `game` | the online game: one server, island map, 4 buildings, monsters, items, inventory, pet cube | old try |
| `voxel` | `game` plus the voxel engine, terrain chunks in Web Workers, exploding stones, Kikoha, zoom, FPS | old try, the most recent |
| `docs` | `documentation/`, `game/README.md`, `game/assets/README.md` | replaced by `attempt_1` |
| `backup` | documentation only, up to Raditz's space pod | old state of the documentation |
| `claude/building-docs` | documentation only, up to the Capsule Corp ship | old state of the documentation |
| `claude/work`, `main-2` | only a `.gitignore` | empty start |
| `try/nature` | the nature of `pixel-scene` version-3 (commit `9da4216`), sorted with the names of `assets.md` | try, moved to `attempt_1` |
| `try/mountain-ends` | the free ends of mountain borders stop tier by tier on wavy lines, not in one flat cut | try, moved to `attempt_1` |
| `try/no-wall-rocks` | no small rocks stuck on the cliff walls, and the rule against such fake details | try, moved to `attempt_1` |
| `try/plants` | tree, bush, and palm leaves are one medium leaf with 2 tiny ones, not round spots (the tree shapes stay the same) | try, moved to `attempt_1` |
| `try/tree-types` | 6 new tree types: pine, fir, cypress, birch, willow, fruit (the canopy `form` of the `tree` builder) | try, moved to `attempt_1` |
| `try/rock-types` | 4 new rock types: slab, stack, cluster, split (the `rock-form` builder) | try, moved to `attempt_1` |
| `try/character` | the fixed human of `backup` (the FlyFF male of the `voxel` branch), drawn 4 times finer than the world | try, moved to `attempt_1` |
| `try/walk` | the human walks with the arrows (idle and walk clips), the camera follows it | try, moved to `attempt_1` |
