"""Builds example/capsule-ship.json, the Capsule Corp ship plan, from its measures.

Run:  python3 build-capsule-ship.py [out.json]   (default: capsule-ship.json next to this file)

Every number below was measured on example/capsule-reference.png (scale: the sphere is 680 px
wide = 3 m, so 1 px = 4.4 mm) and checked by drawing the plan next to the reference (tools/preview).
Only the global form is built: the black cap and band, the letters, the portholes, the door\nhole, the steps on the ramp, and the blue struts will be textures or are left out.
"""
import json
import math
import os
import sys

rad = math.radians
R = lambda v: round(v, 3)
shapes = []
FACES = {"box": ["front", "back", "left", "right", "top", "bottom"], "cylinder": ["side", "top", "bottom"],
         "dome": ["side", "bottom"]}


def add(id, type, size, pos, rotY=0, tilt=0, slot="hull"):
    shapes.append({"id": id, "type": type, "size": [R(v) for v in size], "position": [R(v) for v in pos],
                   "rotationY": R(rotY), "tilt": R(tilt), "role": None,
                   "faces": [{"face": f, "texture": slot} for f in FACES[type]]})


def radial(angle, r, y):
    """The point at r meters from the ship axis, toward `angle` (0 = front, +z; positive = toward +x)."""
    return [r * math.sin(rad(angle)), y, r * math.cos(rad(angle))]


# --- The hull: a sphere 3 m wide whose lower half is shorter, so it narrows to a small bottom.
HULL_R = 1.5        # 680 px wide
HULL_Y = 1.19       # the widest line (y 350 px) is 270 px above the ground
HULL_LOW = 1.13     # the bottom (y 607 px) is 257 px under the widest line
add("hull-top", "dome", [2 * HULL_R, HULL_R, 2 * HULL_R], [0, HULL_Y, 0])
add("hull-bottom", "dome", [2 * HULL_R, HULL_LOW, 2 * HULL_R], [0, HULL_Y, 0], tilt=180, slot="black")

# --- The colors of the hull, as on the reference: one color per shape, so each color zone is its own shape.
# Each zone is a copy of the hull half it lies on, with the same curve: a little narrower and a little taller,
# so it comes out of the hull only above (or below) one ring of the hull's facets, and follows the hull exactly.
# A copy that is narrower by e1 and taller by e2 comes out where (height / half height)^2 > e1 / (e1 + e2).
DOME_BANDS = 5


def zone_copy(edge_band, e1):
    """Width and height factors of a copy of a hull half that comes out beyond ring `edge_band` (0 = widest line)."""
    t = math.sin(edge_band / DOME_BANDS * math.pi / 2) ** 2
    return 1 - e1, 1 + e1 * (1 - t) / t


# The black cap: beyond ring 3 of the top half (54 degrees, 2.4 high; 2.44 on the reference).
cw, ch = zone_copy(3, 0.02)
add("cap", "dome", [2 * HULL_R * cw, HULL_R * ch, 2 * HULL_R * cw], [0, HULL_Y, 0], slot="black")
# The black band is the top of the bottom half: hull-bottom is black. Under the band the bottom is white:
# beyond ring 2 of the bottom half (36 degrees, 0.53 high; about 0.57 on the reference).
bw, bh = zone_copy(2, 0.015)
add("hull-belly", "dome", [2 * HULL_R * bw, HULL_LOW * bh, 2 * HULL_R * bw], [0, HULL_Y, 0], tilt=180)
CAP_Y = HULL_Y + HULL_R * math.sin(rad(54))
BELLY_Y = HULL_Y - HULL_LOW * math.sin(rad(36))


def hull_radius(y):
    """Radius of the hull at height y."""
    t = (y - HULL_Y) / (HULL_R if y > HULL_Y else HULL_LOW)
    return HULL_R * math.sqrt(max(0, 1 - t * t))


# --- The flat pad under the hull: 160 px wide, on the ground; the bottom tip of the hull sinks 0.04 into it.
PAD_W, PAD_H = 0.7, 0.1
add("pad", "cylinder", [PAD_W, PAD_H, PAD_W], [0, 0, 0])

# --- 4 legs, 90 degrees apart. 3 show (left, front, right); the 4th is behind, the same.
# Each: a flat plate that comes out of the hull, a column under its outer end, a round foot on the ground.
LEG_ANGLES = [-20, 70, 160, -110]
PLATE_IN, PLATE_OUT = 0.9, 1.68   # the plate starts inside the hull and ends 1.68 from the axis
PLATE_W, PLATE_T, PLATE_TOP = 0.32, 0.08, 0.56
COL_R, COL_W = 1.5, 0.18          # the column stands 1.5 from the axis (measured 1.45 to 1.53)
FOOT_W, FOOT_H = 0.34, 0.08
names = {-20: "front", 70: "right", 160: "back", -110: "left"}
for a in LEG_ANGLES:
    n = names[a]
    add(f"plate-{n}", "box", [PLATE_W, PLATE_T, PLATE_OUT - PLATE_IN], radial(a, (PLATE_IN + PLATE_OUT) / 2, PLATE_TOP - PLATE_T), rotY=a)
    add(f"leg-{n}", "cylinder", [COL_W, PLATE_TOP - PLATE_T - FOOT_H + 0.02, COL_W], radial(a, COL_R, FOOT_H - 0.01), rotY=a, slot="metal")
    add(f"foot-{n}", "cylinder", [FOOT_W, FOOT_H, FOOT_W], radial(a, COL_R, 0), rotY=a)

# --- The door: only a hole in the hull, at the front left (a texture). Its axis, seen from above,
# and the height of its bottom edge, where the ramp starts.
DOOR = -38
DOOR_BOTTOM = 0.75

# --- The ramp: one flat plate from the hull under the door hole down to the ground, straight along the door axis.
RAMP_W, RAMP_T = 0.6, 0.06
RAMP_IN = 1.3                      # its top end starts just inside the hull (the hull is 1.38 in radius at 0.75 high)
RAMP_OUT = 2.1                     # its low end lies on the ground, as deep as the front foot, as on the reference
top = (RAMP_IN, DOOR_BOTTOM - RAMP_T)
low = (RAMP_OUT, -0.01)
slope = math.degrees(math.atan2(top[1] - low[1], low[0] - top[0]))
length = math.hypot(low[0] - top[0], top[1] - low[1])
mid = ((top[0] + low[0]) / 2, (top[1] + low[1]) / 2)
add("ramp", "box", [RAMP_W, RAMP_T, length], radial(DOOR, mid[0], mid[1]), rotY=DOOR, tilt=slope, slot="ramp")

# --- The text.
f = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")
door_end = radial(DOOR, RAMP_OUT, 0)
layout = (
    f"Middle: a round white hull, a sphere {f(2 * HULL_R)} wide (x -1.5 to 1.5, z -1.5 to 1.5), standing on four legs with no stone base. "
    f"Its widest line is {f(HULL_Y)} above the ground; its top half is a full half-sphere (top at {f(HULL_Y + HULL_R)}); its bottom half is shorter "
    f"({f(HULL_LOW)} high), so it narrows to a small bottom {f(HULL_Y - HULL_LOW)} above the ground. "
    f"Under it, a flat round pad {f(PAD_W)} wide and {f(PAD_H)} high lies on the ground; the bottom tip of the hull sinks {f(PAD_H - (HULL_Y - HULL_LOW))} into it. "
    f"Legs: four, 90 degrees apart, at the front (turned 20 degrees to the left), the right, the back, and the left. Each is a flat white plate "
    f"{f(PLATE_W)} wide and {f(PLATE_T)} thick that comes straight out of the hull at {f(PLATE_TOP)} high, from {f(PLATE_IN)} (inside the hull, "
    f"which is {f(hull_radius(PLATE_TOP))} wide there in radius) to {f(PLATE_OUT)} from the axis; a blue-grey column {f(COL_W)} wide under its outer end, "
    f"{f(COL_R)} from the axis; and a round white foot {f(FOOT_W)} wide and {f(FOOT_H)} high on the ground. "
    f"Front left: the door is only a hole in the hull, nothing comes out: its axis is turned {-DOOR} degrees to the left of the front, its bottom edge {f(DOOR_BOTTOM)} high. "
    f"The ramp: one flat white plate {f(RAMP_W)} wide, straight along the door axis, from the hull under the door hole ({f(DOOR_BOTTOM)} high; its top end starts "
    f"{f(RAMP_IN)} from the axis, just inside the hull, which is {f(hull_radius(DOOR_BOTTOM))} in radius there) down to the ground {f(RAMP_OUT)} from the axis "
    f"(its low end near x {f(door_end[0])}, z {f(door_end[2])}), a {f(slope)} degree slope. "
    f"It passes left of the front leg and above its plate (the plate is {f(PLATE_TOP)} high and ends at {f(PLATE_OUT)}). "
    f"Colors: the hull is white with a black cap on top (from {f(CAP_Y)} high) and a wide black band from the widest line down to {f(BELLY_Y)} high. "
    "The bottom half of the hull is black; the cap and the white bottom are copies of the hull halves with the same curve, 1 to 2 cm narrower and taller, "
    "so they come out of the hull only beyond one ring of its facets and follow it exactly: no step, nothing sticks out. "
    "The plates, the feet, and the pad are white; the columns are blue-grey; the ramp is light grey. "
    "The CAPSULE CORP. letters, the round blue portholes, the door opening, "
    "the steps on the ramp, and the thin blue struts under the hull are not shapes: they will be painted in textures or left out."
)
description = ("The Capsule Corp ship: a big round white ship with a black cap and a wide black band, a sphere on four short legs with flat plates and round feet, "
               "a door hole at the front left and a ramp from the door down to the ground.")
textures = [
    {"name": "hull", "description": "White painted metal hull with big black CAPSULE CORP. letters",
     "color": "#f1f6f0", "widthM": 4.7, "heightM": 1.5},
    {"name": "black", "description": "Black painted metal band with round blue portholes", "color": "#16191e", "widthM": 4.7, "heightM": 0.6},
    {"name": "metal", "description": "Blue-grey metal legs", "color": "#8aaad6", "widthM": 0.6, "heightM": 0.4},
    {"name": "ramp", "description": "Light grey ramp with grey steps across it", "color": "#d9dbe0", "widthM": 0.6, "heightM": 1.1},
]

key = ["id", "type", "size", "position", "rotationY", "tilt", "role", "faces"]
out = "{\n" + f' "description": {json.dumps(description)},\n "layout": {json.dumps(layout)},\n "shapes": [\n'
out += ",\n".join("  " + json.dumps({k: s[k] for k in key}) for s in shapes) + "\n ],\n \"textures\": [\n"
out += ",\n".join("  " + json.dumps(t) for t in textures) + "\n ]\n}\n"
json.loads(out)
target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "capsule-ship.json")
with open(target, "w") as file:
    file.write(out)
print(f"wrote {target}: {len(shapes)} shapes")
