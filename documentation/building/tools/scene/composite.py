"""Puts the fine character image (PIXEL_SCALE 1) over the game-pixel scene (PIXEL_SCALE 4), as the screen shows them.
On screen, a renderer canvas of game pixels is scaled by its pixel scale and moved by (-scale - ex*scale, -scale + ey*scale)."""
import json, sys
from PIL import Image
meta = json.load(open(sys.argv[1]))
W, H = meta["W"], meta["H"]


def on_screen(info):
    """The renderer's view as it shows on screen, placed in the full view (a smaller view sits at its middle)."""
    im = Image.open(info["file"]).convert("RGB")
    s = info["scale"]
    big = im.resize((im.width * s, im.height * s), Image.NEAREST)
    ox, oy = (W - info["W"]) // 2, (H - info["H"]) // 2
    left = round(-s - info["ex"] * s) + ox
    top = round(-s + info["ey"] * s) + oy
    screen = Image.new("RGB", (W, H), (255, 0, 255))
    screen.paste(big.crop((0, 0, min(big.width, info["W"] + 2 * s), min(big.height, info["H"] + 2 * s))), (left, top))
    return screen


low, high = on_screen(meta["low"]), on_screen(meta["high"])
px_h = high.load()
mask = Image.new("L", (W, H), 0)
pm = mask.load()
for y in range(H):
    for x in range(W):
        r, g, b = px_h[x, y]
        if not (r > 240 and g < 20 and b > 240):
            pm[x, y] = 255
low.paste(high, (0, 0), mask)
low.save(sys.argv[2])
print("wrote", sys.argv[2], "snap low", round(meta["low"]["ex"], 3), round(meta["low"]["ey"], 3), "high", round(meta["high"]["ex"], 3), round(meta["high"]["ey"], 3))
