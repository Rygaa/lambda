"""Chichi house: textures made by Infer (jobs.py), placed where the reference shows them."""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from painter import *  # noqa
from infer_client import to_pixels, CACHE  # noqa
from jobs import SPECS  # noqa

EX = os.path.join(HERE, "..", "example")
PLAN = os.path.join(EX, "chichi-house.json")
OUT = os.path.join(HERE, "chichi")
plan = json.load(open(PLAN))
S = {s["id"]: s for s in plan["shapes"]}
COLORS = {t["name"]: t["color"] for t in plan["textures"]}


def pix(name, background, trim=False):
    """The Infer image cut down to its real size. trim: first cut off the white margins Infer left around a thin band."""
    w, h = SPECS[name][2]
    img = Image.open(os.path.join(CACHE, name + ".png")).convert("RGBA")
    if trim:
        rgb = np.asarray(img.convert("RGB")).astype(int)
        rows = np.where((rgb.min(axis=2) < 235).mean(axis=1) > 0.5)[0]
        img = img.crop((0, rows[0], img.width, rows[-1] + 1))
    return to_pixels(img, w, h, background)


def mat(slot, job, desc, trim=False):
    w, h = SPECS[job][2]
    return Material(slot, COLORS[slot], desc, image_pattern(pix(job, COLORS[slot], trim), w, h), (w, h))


materials = {
    "grey": mat("grey", "chichi-grey", "Grey stone foundation blocks", trim=True),
    "cream": mat("cream", "chichi-wall", "Cream stone block walls"),
    "tile": mat("tile", "chichi-tile", "Brown clay roof tiles in rows"),
    "wood": mat("wood", "chichi-wood", "Brown wooden planks"),
    "white": mat("white", "chichi-white", "Smooth warm white plaster"),
    "red": Material("red", COLORS["red"], "Red painted metal"),
}
decals = []


# Simple textures, the same everywhere: every door is the wood of the gables, every window the shared glass
# in a thin wood frame. Only the red signs keep their own picture.
WOOD = materials["wood"]
GLASS = image_pattern(pix("glass", "#5f86c8"), 0.6, 0.6)
F = 0.03   # frame width


def wood(mask, shade=1.0):
    return fill(WOOD.pattern, WOOD.period, mask, shade)


def window(w, h):
    """A window w x h, its bottom middle at (0, 0): glass in a thin darker wood frame."""
    return framed(rect(-w / 2, 0, w / 2, h), rect(-w / 2 + F, F, w / 2 - F, h - F), wood(rect(-w / 2, 0, w / 2, h), 0.75),
                  fill(GLASS, (0.6, 0.6), rect(-w / 2 + F, F, w / 2 - F, h - F)))


def door(outer, inner):
    """A door: wood, with a thin darker wood edge."""
    return framed(outer, inner, wood(outer, 0.7), wood(inner))


def on_front(picture, cx, y0, z, shapes):
    decals.append(Projected((cx, y0, z), (0, 0, 1), picture, depth=0.12, facing=0.5, shapes=shapes))


# --- main house front wall (z 1.2): two windows, as on the left of the reference
on_front(window(0.62, 0.68), -1.4, 0.45, 1.2, ["walls"])
on_front(window(0.26, 0.9), -0.75, 0.3, 1.2, ["walls"])

# --- wing front wall (z 3.6, x 0.36 to 1.8): a window on the left, the wooden door right of the middle
on_front(window(0.3, 0.6), 0.63, 0.35, 3.6, ["wing-walls"])
on_front(door(rect(-0.25, 0, 0.25, 0.85), rect(-0.25 + F, 0, 0.25 - F, 0.85 - F)), 1.12, 0.16, 3.6, ["wing-walls"])

# --- the dome entrance block: a wooden door with a round top
ax = S["arch"]["position"][0]
on_front(door(arch(0, 0, 0.6, 1.1), arch(0, 0, 0.6 - 2 * F, 1.1 - F)), ax, 0.16, 3.89, ["arch", "arch-top"])

# --- on the dome (center x -0.972, z 2.6, base 0.16, radius 1.2, height 1.68): the long window low on its front left,
# the big red sign with its character above it, and a smaller sign on its right side
dome = S["dome"]
dx, dy, dz = dome["position"]
DR, DH = dome["size"][0] / 2, dome["size"][1]


def on_dome(picture, az, above):
    f = math.sqrt(1 - (above / DH) ** 2)
    t = math.radians(az)
    p = (dx + DR * f * math.sin(t), dy + above, dz + DR * f * math.cos(t))
    n = (math.sin(t) * f / DR, above / DH ** 2, math.cos(t) * f / DR)
    decals.append(Projected(p, n, picture, depth=0.4, facing=0.2, shapes=["dome"]))


on_dome(window(0.85, 0.3), -44, 0.25)
sign = pix("chichi-sign", "#f0e8d0")
on_dome(image_paint(sign, -0.25, -0.3, 0.25, 0.3, diamond(0, 0, 0.25, 0.3)), -40, 0.95)
on_dome(image_paint(sign, -0.19, -0.23, 0.19, 0.23, diamond(0, 0, 0.19, 0.23)), 50, 0.90)

path, n = paint_plan(plan, materials, decals, OUT, "chichi-house")
print("wrote", path, n, "slots")
