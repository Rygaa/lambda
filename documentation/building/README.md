# Building guide

This guide says how to build a building from shapes. It is based on one example: the Chichi house that Claude built by hand. It shows how that house was built, step by step, and turns each step into a rule for any building.

Every number here comes from `example/chichi-house.json`. "My reading" means the JSON does not show it: it is how I read what the JSON does. The guide agrees with `../style/rules.md`.

The example:

- `example/chichi-reference.png`: the image the house was built from.
- `example/chichi-house.json`: the plan of shapes. Its `description` says "Goku's house": it is the same house.
- `example/chichi-house.png`: the render in the game.

| Reference | Render in the game |
| --- | --- |
| ![Chichi house reference](example/chichi-reference.png) | ![Chichi house render](example/chichi-house.png) |

The JSON is a plan, the format Infer returns (see `apps/asset-studio/server/shapes.ts`): `description`, `layout`, `shapes`, `textures`. In a plan, `faces` is a list of `{"face", "texture"}`. In `asset.json`, the same faces are a map from face name to slot.

## 0. Keep shapes simple

> **The simpler the shape, the better. This rule comes first.**

This is 3D pixel art. A building is a few plain blocks, not a detailed model. The renderer, the outlines, and the textures give the look.

Do not make:

- rounded edges or bevels,
- curved roofs,
- frames or trim built from many pieces,
- extra shapes for small details.

If a part reads fine as one box, it is one box.

The proof is the Chichi house. The whole main house is 1 box for the walls (`walls`) and 1 wedge for the roof (`roof`). A base, a ridge board, 3 chimneys, and 1 window add 6 more boxes. That is all. Bricks, roof tiles, planks, and the window frame are painted in the textures.

Round things stay plain too. A cylinder has 8 flat sides and a dome has 14 sides and 5 bands (`packages/asset-format/src/geometry.ts`). The round top of the dome door is 1 cylinder laid on its side, not a ring of pieces. The sign is 1 square box; the diamond is painted on it.

## 1. Coordinates

- 1 unit is 1 m.
- The ground is at y = 0. y goes up.
- x runs left to right: +x is right.
- The front faces +z, toward the camera. Parts with a larger z stand more to the front.
- `size` is [width x, height y, depth z].
- `position` is the center of the bottom of the shape. A shape at y = 0.16 stands on top of something 0.16 high.
- `rotationY` turns the shape around y, in degrees. Positive turns its front toward +x.
- `tilt` leans the shape around x, in degrees, after the turn. Positive leans its top toward the front. Negative leans it back, so its front faces up.

Chichi: the main house is centered on x = 0, z = 0. Its walls run from x -1.8 to 1.8 and z -1.2 to 1.2. The dome and the wing stand in front of it, at larger z.

## 2. Write the text first

Before any shape, write 2 texts:

- `description`: one sentence about the whole building.
- `layout`: each part, where it is (back, front left, front right), its x and z range, and checks with numbers that parts do not cut into each other.

Chichi `description`:

> Goku's house: a cream brick house with a brown tile roof and three white chimneys, a white dome house in front on the left, and a wing on the right with its gable to the front.

The Chichi `layout` gives each part its range and checks it:

| Part | Where | x | z | Check in the layout |
| --- | --- | --- | --- | --- |
| Main house | back | -1.8 to 1.8 | -1.2 to 1.2 | |
| Dome | front left | -2.17 to 0.23 | 1.4 to 3.8 | stands whole in front of the main house: 1.4 > 1.2 |
| Wing | front right | 0.36 to 1.8 | 0.4 to 3.6 | starts right of the dome: 0.36 > 0.23 |

The layout also gives the numbers the shapes need later: the dome center (x -0.97, z 2.6), its radius 1.2 and height 1.68, the roof height (1.15 m over 2.4 m), and the angles of the sign and the dome window.

The wing goes into the main house from z 0.4 to 1.2. The layout says so: "that joins the main house". Walls that join may touch. The dome does not touch the main house.

Then write the shapes from the layout. The shapes must match the layout. The dome is 2.4 wide at x -0.972, so it runs from x -2.172 to 0.228: the range in the layout.

## 3. Build order and parts

Build in this order. Each step names the Chichi shapes.

| Step | Part | Chichi shapes |
| --- | --- | --- |
| 1 | Stone base | `base` |
| 2 | Walls | `walls` |
| 3 | Wedge roof | `roof` |
| 4 | Ridge board | `ridge` |
| 5 | Chimneys | `chimney-1`, `chimney-2`, `chimney-3` |
| 6 | Windows | `side-window` |
| 7 | Second volumes | the dome on its ring: `dome-ring`, `dome`, `dome-pipe`, with `dome-sign` and `dome-window` on it; the wing: `wing-base`, `wing-walls`, `wing-roof` |
| 8 | Doors with steps | dome door: `arch`, `arch-top`, `dome-door` (`role: "door"`), `door-top`, `dome-step`; wing door: `wing-door` (`role: "door"`), `wing-step` |
| 9 | Small props | `mailbox-post`, `mailbox` |

In the JSON the dome door comes right after the dome, before the wing. The order of shapes in the file does not change the model.

Each part sits on the part under it:

- The walls start at y 0.16, the top of the base.
- The roof starts at y 1.3, the top of the walls (0.16 + 1.14).
- The dome starts at y 0.16, the top of its ring. The wing walls start at y 0.16, the top of the wing base.
- The doors and the arch start at y 0.16, the floor height of the base and the ring.
- The steps and the mailbox post stand on the ground, at y 0.

A second volume (the dome, the wing) gets its own base, like the main house.

## 4. Sizes

All sizes are measured from the JSON.

### Base

- 0.16 high.
- It sticks out 0.07 past the walls on each side. Main house: base 3.74 × 2.54 under walls 3.6 × 2.4. Wing: base 1.58 × 3.34 under walls 1.44 × 3.2.
- The dome ring is the base of the dome: also 0.16 high, 2.56 wide under the 2.4 dome, so it sticks out 0.08.

### Walls

- Main house: the wall box is 3.6 × 1.14 × 2.4. On the base, its top is at y 1.3.
- Wing: the wall box is 1.06 high. Its top is at y 1.22, a little lower than the main house.
- The right wall of the wing is in line with the right wall of the main house (both at x 1.8).

### Roof

- Main roof: a wedge 4.12 × 1.15 × 2.92 over walls 3.6 × 2.4. It hangs over the walls by 0.26 on each side, in x and in z (4.12 vs 3.6, 2.92 vs 2.4).
- It is 1.15 high, so the slope is about 38°. The peak is at y 2.45.
- Wing roof: a wedge 3.6 long, 1.84 wide, 0.9 high, turned 90°, over walls 3.2 × 1.44. It hangs over by 0.2 on each side. Its slope is about 44°. The peak is at y 2.12.
- The bottom of a roof is at the top of its walls.

### Ridge board

- 4.18 long, 0.1 high, 0.18 wide.
- 0.03 longer than the roof at each end (4.18 vs 4.12).
- Its bottom is at y 2.4 and the roof peak is at 2.45, so half of it sits in the roof and half stands above.
- The wing roof has no ridge board.

### Chimneys

- All 3 are 0.4 × 0.75 × 0.32.
- They sink into the roof. On a roof slope, the roof height at a distance |z| from the ridge is: y = 1.3 + 1.15 × (1 − |z| / 1.46).
- `chimney-1` runs from z -0.64 to -0.32. The roof there is at y 1.946 and 2.198. The chimney bottom is at 1.815: 0.13 below the low edge. Its top is at 2.565: 0.37 above the high edge. `chimney-2` is the same on the front slope.
- `chimney-3` stands near the ridge: its bottom is 0.065 below the low edge, and its top (2.933) is 0.43 above the ridge board.

### Doors

- Dome door (`dome-door`): a box 0.68 × 0.8, with a half disc of radius 0.34 on top (`door-top`).
- It stands in a white arch (`arch`) 0.84 × 0.8 × 0.42, with a half disc of radius 0.42 on top (`arch-top`). The arch is 0.08 wider than the door on each side.
- Wing door (`wing-door`): a box 0.5 × 0.86.
- Both doors are 0.06 thick.
- How far a door stands out: the dome door runs from z 3.89 to 3.95 and the arch front is at 3.89, so it stands 0.06 out. The wing door runs from z 3.59 to 3.65 and the wing wall front is at 3.6, so it stands 0.05 out and 0.01 in.
- Both doors start at y 0.16, on the base or the ring.

### Steps

- 0.1 high, on the ground. A step is lower than the base (0.16).
- 0.36 deep (dome) and 0.5 deep (wing).
- Wider than the door: 1.0 for the 0.68 door (0.16 more on each side), 0.9 for the 0.5 door (0.2 more on each side).
- A step touches what is behind it. `dome-step` starts at z 3.92, 0.03 under the door front (3.95). `wing-step` starts at z 3.65, 0.02 under the front of the wing base (3.67).

### Windows and flat parts

- `side-window`: 0.46 wide, 0.36 high, 0.1 thick, on the left wall. The wall face is at x -1.8 and the window runs from x -1.88 to -1.78: 0.08 out and 0.02 in. Its bottom is at y 0.58.
- `dome-window`: 0.74 × 0.5, 0.05 thick.
- `dome-sign`: 0.52 × 0.52, 0.04 thick.

### Other parts

- `dome`: 2.4 wide and deep, 1.68 high. A true half-sphere would be 1.2 high; this dome is taller.
- `dome-pipe`: 0.2 wide, 0.52 high. Its bottom is at y 1.74 and the dome top at 1.84, so it sinks 0.1 into the dome.
- Mailbox: a post 0.08 × 0.6 × 0.08 and a box 0.24 × 0.2 × 0.3 on top of it, at y 0.6. 0.8 high in all.

### Compared with rules.md

| rules.md | Chichi |
| --- | --- |
| Walls 1.2 to 1.4 m high | 1.3 (main) and 1.22 (wing), from the ground. The wall boxes alone are 1.14 and 1.06. My reading: rules.md counts from the ground, base included. |
| A door about 0.6 × 0.85 m | 0.5 × 0.86 (wing). 0.68 × 0.8 plus a round top of radius 0.34 (dome). |
| A small house about 3.6 × 2.4 m | Main walls 3.6 × 2.4. |
| Roofs hang over by about 0.25 m | 0.26 (main), 0.2 (wing). |
| A thin ridge board | 0.1 high, 0.18 wide, on the main roof only. |
| A low stone base | 0.16 high. |

## 5. Shape types

| Type | Faces | Use it for | In Chichi |
| --- | --- | --- | --- |
| box | front, back, left, right, top, bottom | walls, bases, chimneys, windows, doors, steps, signs, posts | 18 |
| cylinder | side, top, bottom (8 flat sides) | round bases, pipes, round tops (laid on its side) | 4: `dome-ring`, `dome-pipe`, `arch-top`, `door-top` |
| wedge | front and back (the 2 slopes), left and right (the triangle ends), bottom | gable roofs | 2: `roof`, `wing-roof` |
| pyramid | front, back, left, right, bottom | not in Chichi. My reading: roofs with 4 slopes, pointed tops | 0 |
| dome | side, bottom (14 sides, 5 bands) | round houses. Width, depth, and height may differ | 1: `dome` |

### A wedge with its gable to the front

A wedge has its ridge along x. With `rotationY: 0` its slopes face the front and the back, and its triangle ends face left and right. That is the main roof.

To make a gable face the front, turn it: `rotationY: 90`. The wing roof does this:

- `size` stays [ridge length, height, width]. So `wing-roof` is [3.6, 0.9, 1.84]: 3.6 now runs along z (0.2 to 3.8) and 1.84 along x (0.16 to 2.0).
- The `left` face now faces the front (+z) and the `right` face faces the back. The `front` slope faces right (+x) and the `back` slope faces left.
- The back end of the wing roof is at z 0.2, inside the main roof. There the main roof is at y 2.29, above the wing peak (2.12), so the back gable is hidden. My reading: a roof that meets a bigger roof ends inside it.

### A cylinder with `tilt: 90` for an arch top

With `tilt: 90` a cylinder lies on its side. Its flat faces look to the front and the back. Its height becomes its depth along z. Its position is still the center of its bottom, which is now the center of its back face.

- `arch-top`: size [0.84, 0.43, 0.84], position y 0.96, z 3.47, tilt 90. It is a disc of radius 0.42, centered at y 0.96 (the top of the arch box), from z 3.47 (the back of the arch box) to 3.90.
- Its lower half is inside the arch box, so only the upper half shows: a round top.
- `door-top` does the same on the door: radius 0.34, at y 0.96, from z 3.89 to 3.96.
- Each disc is 0.01 deeper than the box under it (0.43 vs 0.42, 0.07 vs 0.06), so its front stands just in front of the box front. My reading: so the 2 fronts do not lie in the same plane.

## 6. Things on curved surfaces

The sign and the window lie flat on the dome and stand out of it. Their front face must point straight out of the dome. `rotationY` and `tilt` do this.

After a turn r and a tilt t, the front face of a box points along:

(sin r × cos t, −sin t, cos r × cos t)

This direction must be the direction straight out of the dome at that point (the normal).

### How to work out the angles

The dome: the center of its bottom is (cx, y0, cz) = (-0.972, 0.16, 2.6). R = width / 2 = 1.2. H = height = 1.68.

Let C be the middle of the box, just out of the dome surface. Then:

1. Turn: `rotationY` = atan2(C.x − cx, C.z − cz).
2. Tilt: the dome is a stretched half-sphere (H is not R), so use its stretched normal.
   - d = sqrt((C.x − cx)² + (C.z − cz)²), the distance from the center, seen from above.
   - e = atan( ((C.y − y0) / H²) / (d / R²) ), the angle of the normal above the ground.
   - `tilt` = −e.
   - On a true half-sphere (H = R), e is the angle of C above the base, seen from the center.
3. Position: `position` is the center of the bottom of the box, not its middle. Go back from C by half the box height, along the box's own up direction:
   - up = (sin t × sin r, cos t, sin t × cos r)
   - `position` = C − (height / 2) × up

### Check with the JSON

The sign. Its middle is C = (-0.722, 1.566, 3.226).

- C minus the dome center: x 0.25, y 1.406, z 0.626.
- `rotationY` = atan2(0.25, 0.626) = 21.8.
- d = 0.674. e = atan((1.406 / 2.8224) / (0.674 / 1.44)) = atan(0.498 / 0.468) = 46.8. So `tilt` = -46.8.
- up = (-0.271, 0.685, -0.677). `position` = C − 0.26 × up = (-0.652, 1.388, 3.402).
- The JSON has `rotationY: 21.8`, `tilt: -46.8`, `position: [-0.652, 1.388, 3.402]`.

The dome window. Its middle is C = (-1.997, 0.788, 3.059).

- C minus the dome center: x -1.025, y 0.628, z 0.459.
- `rotationY` = atan2(-1.025, 0.459) = -65.9.
- d = 1.123. e = atan((0.628 / 2.8224) / (1.123 / 1.44)) = atan(0.223 / 0.780) = 15.9. So `tilt` = -15.9.
- up = (0.250, 0.962, -0.112). `position` = C − 0.25 × up = (-2.06, 0.548, 3.087).
- The JSON has `rotationY: -65.9`, `tilt: -15.9`, `position: [-2.06, 0.548, 3.087]`.

### How far out

In both, C is about 0.01 out of the dome surface. So the back face is just inside the dome (0.008 for the sign, 0.015 for the window) and the front face stands about 0.03 out. The JSON does not show how C was picked. My reading: pick a point on the dome, then move it about 0.01 out along the normal.

Use the same steps for any curved surface: find the normal at the point, then turn and tilt the front face onto it.

## 7. Textures

A texture slot is one texture. `widthM` × `heightM` is the real size it covers on a face, in meters. After that size it repeats. The texture has 43.6 pixels per meter: cream is 3.6 × 1.2 m, so 157 × 52 pixels.

Texture coordinates are in meters and start at the bottom-left corner of each face (`geometry.ts`). So each face shows its texture from that corner.

### Material slots: they repeat

| Slot | Color | widthM × heightM | Used on |
| --- | --- | --- | --- |
| grey | #b8b4b0 | 3.7 × 0.2 | bases, dome ring, dome pipe, steps |
| cream | #f2dab0 | 3.6 × 1.2 | walls, wing walls, main roof triangle ends |
| tile | #c47a4a | 4.1 × 1.4 | the slopes and bottoms of both roofs |
| wood | #ab7c58 | 0.7 × 0.9 | doors, door top, ridge board, wing roof triangle ends, mailbox post |
| white | #f0e8d0 | 2.4 × 1.7 | dome, arch, arch top, chimneys, edges of the dome window |
| red | #c83a3a | 0.5 × 0.5 | mailbox, edges of the sign |

My reading: a material slot is about the size of the main face it covers. Cream 3.6 × 1.2 is about the front wall (3.6 × 1.14). Grey 3.7 × 0.2 is about the base front (3.74 × 0.16). Tile is 4.1 wide like the roof (4.12); its 1.4 height is less than the slope (1.86), so the tiles repeat on the slope. White 2.4 × 1.7 is the dome width and height. Wood 0.7 × 0.9 is about a door.

### One-time slots: they show once

| Slot | Color | widthM × heightM | Used on |
| --- | --- | --- | --- |
| sign | #c83a3a | 0.52 × 0.52 | the front of `dome-sign` only |
| dome-window | #6f8fc0 | 0.74 × 0.5 | the front of `dome-window` only |
| glass | #6f8fc0 | 0.5 × 0.4 | all 5 seen faces of `side-window` |

- A one-time slot is the size of the face it is on, so it shows once. `sign` is exactly the 0.52 × 0.52 sign face. `dome-window` is exactly the 0.74 × 0.5 window face.
- `glass` is a little bigger than its face (0.5 × 0.4 on a 0.46 × 0.36 face). The face shows it from the bottom-left corner, so about 0.04 m of the right and top edges is cut off.
- The sign and the dome window put the one-time slot on the front only. Their thin edges get a material slot: red for the sign, white (the dome) for the window. My reading: do it this way. The side window puts glass on all faces.
- The description of a one-time slot says "One ...": "One red diamond with a white mark in its middle; the corners around the diamond are white plaster". The corners match the dome, so a square box reads as a diamond on the dome.

### Colors

- Daylight colors only. The reference is lit by an orange evening light. The plan uses plain day colors: cream #f2dab0, white #f0e8d0, not orange.
- A slot color is the color in the sun. The renderer makes the shade tones.
- The same material has the same color in every slot: sign and red are both #c83a3a; glass and dome-window are both #6f8fc0.

### Which face gets which slot

- Every bottom face is `null`: nobody sees it. The 2 roof wedges are the only exception: their bottom, under the overhang, gets `tile`.
- Every other face gets a slot, even when it is hidden. The top of `walls` is under the roof and still gets `cream`.
- A box gets the slot of its part on all its faces: walls cream, doors wood, chimneys white, steps grey.
- The triangle ends of a wedge (`left`, `right`) are the gables. The main roof uses the wall texture there (`cream`). The wing roof uses `wood`.
- A dome has only `side` and `bottom`. A cylinder has `side`, `top`, and `bottom`.

## 8. Limits

- At most 30 shapes (`MAX_SHAPES` in `schema.ts`). Chichi uses 25: 18 boxes, 4 cylinders, 2 wedges, 1 dome.
- Only 5 shape types: box, cylinder, wedge, pyramid, dome.
- No surface details as shapes. Bricks, planks, roof tiles, stones, cracks, window glass, and window frames are painted in textures. The Chichi side window is 1 box, and its frame is painted in the glass texture. The sign is 1 square box with the diamond painted on it.
- Doors, windows, chimneys, and posts are real small shapes. Chichi has 2 doors, 2 windows, 3 chimneys, 1 post, and 1 sign.
- Every door is a real shape with `role: "door"`. Chichi has 2: `dome-door` and `wing-door`. All other shapes have `role: null`, the round door top (`door-top`) too.

## 9. Checklist

Check a new building against this list before it is done.

1. Could any part be a simpler shape, or fewer shapes? Then make it simpler.
2. There is a one-sentence `description` and a `layout` with every part, its x and z range, and checks with numbers.
3. The front faces +z. The ground is at y = 0. Each `position` is the center of the bottom of its shape.
4. Every part sits on the part under it. Nothing floats. Chimneys and pipes sink into their roof or dome.
5. The base is 0.16 high and sticks out 0.07 past the walls. Each second volume has its own base.
6. Walls are 1.2 to 1.4 m high from the ground. Roofs hang over by about 0.2 to 0.26 m. The main roof has a ridge board.
7. Parts side by side do not cut into each other. Only walls that join and small things on a surface touch.
8. Every door is a real shape with `role: "door"`, about 0.06 thick, standing out of its wall, with a step 0.1 high in front.
9. Things on a dome are turned and tilted onto the dome normal and stand about 0.03 out of it.
10. Every face has a slot. Bottom faces are `null`, except under a roof.
11. Material slots repeat. Each sign or special window has its own one-time slot, the size of its face, on its front only.
12. Colors are daylight colors.
13. 30 shapes or fewer, of the 5 types only.
