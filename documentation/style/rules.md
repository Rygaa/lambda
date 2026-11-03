# Style rules

These rules come from `3d-pixel-art-rendering/` (the article by David Holland). Each rule says where it comes from. "Our choice" means the article does not say it.

## Renderer

All 3D views use `packages/renderer`. It is the renderer of `pixel-scene` (top view), so every asset gets the look of that project. The style lives in the renderer, so every asset gets the same look.

- The scene is drawn at a low resolution, then scaled up with sharp pixels. One game pixel is 4 screen pixels, so 1920×1080 shows 480×270 game pixels. (pixel-scene.)
- 43.6 game pixels per meter (480 / 11). (pixel-scene.)
- The camera is orthographic, looks down about 33°, and never turns. (pixel-scene. The article: orthographic.)
- The sun comes from the left, a little behind the scene. (pixel-scene.)
- The scene is drawn at 3×3 samples per pixel, then one sample is kept, so thin lit ledges stay whole lines. (pixel-scene.)
- Flat color bands, no smooth light. A part has 4 tones: lit, top face in shade, side in shade, and a light edge. The studio makes the shade tones from each color: darker and bluer. (pixel-scene palettes; the formula is our choice.)
- The ground uses 4-step color ramps (grass, sand, dirt, road), with soft shadows. (pixel-scene.)
- Outlines are 1 pixel thick, from the depth and normal buffers, with only the up, down, left, and right pixels. The outer edge is dark; convex inner edges are light where the face is lit. (Article and pixel-scene.)
- Clouds drift and cast soft shadows. God rays are raymarched through the shadow map. Dust shows only in the light beams. (Article and pixel-scene.)
- Grass tufts and flowers are camera-facing sprites lit at their base. (Article and pixel-scene.)
- The camera snaps to the pixel grid. The image is then moved back by the snap error, so movement stays smooth and pixels do not creep. (Article.)

## Models

- Models are low-poly with clear outer edges. (Article.)
- A model uses only boxes, cylinders, wedges (gable roofs), pyramids, and domes (half-spheres). At most 30 shapes. (Our choice.)
- Doors, windows, chimneys, and posts are real small shapes. A door has the role "door", so the game can open it. (Your request.)
- Surface details (bricks, planks, roof tiles, stones, cracks, window glass) are painted in textures, never made as shapes. (Your request.)
- A texture repeats, so a material slot never holds a sign or a one-time mark. Each sign, door, and window is its own thin shape with its own slot, sized to show once. (Found in Infer tests.)
- Infer writes the layout first: each part, its x and z range, and a check that parts do not cut into each other. Shapes on a dome stand out of its surface. (Found in Infer tests.)
- Colors are plain daylight colors, never the sunset or night light of a reference image. (Found in Infer tests.)
- Roofs hang over the walls by about 0.25 m and have a thin ridge board. Buildings stand on a low stone base. (pixel-scene.)
- Sizes follow pixel-scene, not real life: walls 1.2 to 1.4 m high, a door about 0.6 × 0.85 m, a small house about 3.6 × 2.4 m. (pixel-scene.)
- Infer gets no example plan. After its plan, it checks its own work 2 times: it sees flat renders of its shapes from the game camera and from above, compares them with the reference, and fixes the plan. (Your request.)
- 1 unit is 1 meter. The ground is at y = 0. The front of a model faces +z, toward the camera. (Our choice.)

## Textures

- 43.6 texels per meter, so 1 texel is about 1 game pixel. (Follows the renderer.)
- Each texture is cut down to at most 16 colors, with no dithering. (Our choice.)
- Flat colors and clear shapes. No painted light, no painted shadows, no outlines: the renderer adds them. A texture color is the color in the sun. (Our reading of the article and pixel-scene.)
- Ground tiles are 2×2 meters and must tile with no seams. (Our choice.)
