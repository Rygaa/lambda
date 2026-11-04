"""Capsule Corp ship: textures made by Infer (jobs.py), placed where the reference shows them.
Positions were measured on the reference (1 px = 4.4 mm, hull center (0, 1.19, 0)) and checked side by side."""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from painter import *  # noqa
from infer_client import to_pixels, CACHE  # noqa
from jobs import SPECS  # noqa

PLAN = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "example", "capsule-ship.json")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "capsule")
plan = json.load(open(PLAN))
WHITE, BLACK = "#f1f6f0", "#16191e"


def pix(name, background):
    """The Infer image of `name`, cut down to its real size in texels (16 colors)."""
    w, h = SPECS[name][2]
    return to_pixels(Image.open(os.path.join(CACHE, name + ".png")).convert("RGBA"), w, h, background)


materials = {
    "hull": Material("hull", WHITE, "White painted metal"),
    "black": Material("black", BLACK, "Black painted metal"),
    "metal": Material("metal", "#8aaad6", "Blue-grey metal legs"),
    "ramp": Material("ramp", "#c9ccd3", "Light grey ramp with grey steps across it and white rails",
                     image_pattern(pix("ship-ramp", "#c9ccd3"), 0.6, 0.6), (0.6, 0.6)),
}
decals = []

# Simple textures: every porthole is the shared glass (the same as the windows of the other buildings)
# in a white rim; the door is a dark opening in a light grey frame.
GLASS = image_pattern(pix("glass", "#5f86c8"), 0.6, 0.6)

# --- portholes in the middle of the black band (1.0 high), every ~27 degrees, none at the door
PORT_Y, PORT_R = 1.0, 0.165
r_band = 1.5 * math.sqrt(1 - ((1.19 - PORT_Y) / 1.13) ** 2)
porthole = framed(disc(0, 0, PORT_R), disc(0, 0, PORT_R - 0.04), flat("#e2e8ec", disc(0, 0, PORT_R)),
                  fill(GLASS, (0.6, 0.6), disc(0, 0, PORT_R - 0.04), 0.8))
for az in [-4, 24, 52, 80] + [80 + 26.6 * k for k in range(1, 8)] + [-67]:
    t = math.radians(az)
    decals.append(Projected((r_band * math.sin(t), PORT_Y, r_band * math.cos(t)), (math.sin(t), 0, math.cos(t)),
                            porthole, depth=0.3, facing=0.3, shapes=["hull-bottom"]))

# --- the door at -41 degrees: a light grey frame 0.78 wide from 0.70 to 1.71 high, round top, around a dark opening
DOOR_AZ, M_PER_DEG = -41, 1.42 * math.pi / 180
outer, inner = arch(0, 0.70, 0.78, 1.71), arch(0, 0.75, 0.52, 1.59)
door_paint = framed(outer, inner, flat("#d9dee3", outer), flat("#1a2034", inner))
decals.append(Cylindrical(lambda az, y: door_paint((az - DOOR_AZ) * M_PER_DEG, y), shapes=["hull-top", "hull-bottom"]))


# --- the letters, level around the hull: only their dark pixels are painted
def letters(name, az0, az1, y0, y1):
    img = pix(name, WHITE)
    dark = mask_image(img, az0, y0, az1, y1, threshold=110)
    return Cylindrical(image_paint(img, az0, y0, az1, y1, dark), shapes=["hull-top"])


decals.append(letters("ship-capsule", -124, 10, 1.86, 2.25))
decals.append(letters("ship-corp", -76, -32, 1.60, 1.78))

path, n = paint_plan(plan, materials, decals, OUT, "capsule-ship")
print("wrote", path, n, "slots")
