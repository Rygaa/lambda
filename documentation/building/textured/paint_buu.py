"""Buu house: textures made by Infer (jobs.py), placed where the reference shows them."""
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
PLAN = os.path.join(EX, "buu-house.json")
OUT = os.path.join(HERE, "buu")
plan = json.load(open(PLAN))
S = {s["id"]: s for s in plan["shapes"]}
CLAY = "#eeebf5"
P = dict(hole_x=-1.5, hole_y=0.78, hole_d=1.2, win_d=0.25, seg_win=0.62)
P.update(json.loads(os.environ.get("BUU_P", "{}")))


def pix(name, background):
    w, h = SPECS[name][2]
    return to_pixels(Image.open(os.path.join(CACHE, name + ".png")).convert("RGBA"), w, h, background)


materials = {"white": Material("white", CLAY, "Smooth white clay", image_pattern(pix("buu-clay", CLAY), 1.2, 1.2), (1.2, 1.2))}
decals = []
# Simple textures: holes are a dark opening in a rim of the same clay, a little darker;
# windows are the shared glass (the same as the other buildings) in a clay rim.
CLAYP = materials["white"]
GLASS = image_pattern(pix("glass", "#5f86c8"), 0.6, 0.6)


def hole_pic(cx, cy, r):
    return framed(disc(cx, cy, r), disc(cx, cy, r * 0.72), fill(CLAYP.pattern, CLAYP.period, disc(cx, cy, r), 0.86),
                  flat("#1b2148", disc(cx, cy, r * 0.72)))


def win_pic(r):
    return framed(disc(0, 0, r), disc(0, 0, r * 0.62), fill(CLAYP.pattern, CLAYP.period, disc(0, 0, r), 0.86),
                  fill(GLASS, (0.6, 0.6), disc(0, 0, r * 0.62)))

# --- the big round door hole on the head, facing the front, a little to the left
hf = S["head-front"]
xc, ya = hf["position"][0], hf["position"][1]
LF, LB = hf["size"][1], S["head-back"]["size"][1]
RV, RZ = hf["size"][2] / 2, hf["size"][0] / 2


def head_front_z(x, y):
    half = LF if x < xc else LB
    q = 1 - ((x - xc) / half) ** 2 - ((y - ya) / RV) ** 2
    return RZ * math.sqrt(max(q, 0))


hx, hy = P["hole_x"], P["hole_y"]
r = P["hole_d"] / 2
decals.append(Projected((hx, hy, head_front_z(hx, hy)), (-0.15, 0.2, 1), hole_pic(0, 0, r),
                        depth=0.5, facing=0.2, shapes=["head-front", "head-back"]))

# --- the flat front of the tube: the same hole, on the whole cut face
cut = S["tube-cut"]
cw = cut["size"][0]
decals.append(FaceDecal("tube-cut", "bottom", hole_pic(cw / 2, cw / 2, cw / 2)))

# --- small round windows: one in the middle of each of the 3 big segments, facing the front
wr = P["win_d"] / 2
for sid in ["seg-1", "seg-2", "seg-3"]:
    s = S[sid]
    w, h, d = s["size"]
    y = P["seg_win"] * h
    z = d / 2 * math.sqrt(1 - (y / h) ** 2)
    decals.append(Projected((s["position"][0], y, z), (0, y / h ** 2, z / (d / 2) ** 2), win_pic(wr),
                            depth=0.3, facing=0.2, shapes=[sid]))

# --- a row of 5 small windows along the tube, on its side toward the front, a little under its middle
AZ, RISE = 15, 7
dvec = np.array([math.cos(math.radians(RISE)) * math.cos(math.radians(AZ)), math.sin(math.radians(RISE)),
                 -math.cos(math.radians(RISE)) * math.sin(math.radians(AZ))])
side = np.array([-dvec[2], 0, dvec[0]]) / math.hypot(dvec[0], dvec[2])
up = np.cross(dvec, side)
up = up if up[1] > 0 else -up
front = np.array(cut["position"])
TUBE = ["tube-front-end-front", "tube-front-end-back", "tube-body-front", "tube-body-back"]
for t in np.linspace(1.0, 2.9, 5):
    rad_t = 0.82
    ang = math.radians(-20)
    n = math.cos(ang) * side + math.sin(ang) * up
    c = front + t * dvec + rad_t * n
    decals.append(Projected(tuple(c), tuple(n), win_pic(wr), depth=0.35, facing=0.2, shapes=TUBE))

path, n = paint_plan(plan, materials, decals, OUT, "buu-house")
print("wrote", path, n, "slots")
