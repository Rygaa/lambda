"""Builds example/raditz-pod.json, Raditz's space pod plan, from its measures.

Run:  python3 build-raditz-pod.py [out.json]            the plan, door closed (default: raditz-pod.json next to this file)
      python3 build-raditz-pod.py out.json --open=A     the same plan with the door open by A degrees (0 to OPEN_MAX)

The pod is a plain sphere 2 m wide, measured on raditz-pod-reference.png (340 x 255 px): its outline is a circle,
center (173, 111) px, radius 87 px, so 1 px = 11.4 mm. It sits on the ground with its lowest point, not sunk.
The crater and the ground of the reference are not part of the building.

The door is not a shape: it is a part of the sphere's own mesh, chosen with the user by painting the quads red
(raditz-pod-door-faces.png): starting at the 3rd row of quads under the top point, 3 quads wide (centered on the front)
and 6 quads high (3 above the widest line, 3 under it). It opens forward and down on a hinge at its bottom edge until
its top edge touches the ground, and 2 metal arms hold it to the pod, as on raditz-pod-hangar-reference.jpg.

The game format cannot cut a part out of a dome yet, so the door is described in the "pod" block of the plan, which
the scene tool (tools/scene, buildPod in src/main.ts) and the preview tool (tools/preview, doorView in src/faces.ts)
read. Flat colors only, no textures.
"""
import json
import math
import os
import sys

R = lambda v: round(v, 4)

HULL_R = 1.0
HULL_Y = HULL_R                     # the lowest point touches the ground
DOME_SIDES, DOME_BANDS = 14, 5      # as in packages/asset-format/src/geometry.ts
BAND = 90 / DOME_BANDS              # 18 degrees per row of quads
SIDE = 360 / DOME_SIDES             # 25.7 degrees per column of quads

# --- The door: rows 3 to 8 under the top point (2 rows skipped, then 6 rows), 3 columns centered on the front.
SKIP_ROWS, DOOR_ROWS, DOOR_COLS = 2, 6, 3
ELEV_TOP = 90 - SKIP_ROWS * BAND                      # 54 degrees above the widest line
ELEV_BOTTOM = ELEV_TOP - DOOR_ROWS * BAND             # 54 degrees under it
AZ_HALF = DOOR_COLS / 2 * SIDE                        # 38.6 degrees each side of the front
# The hinge: a line along x at the bottom edge of the door, between its corners and its middle (the edge is not straight).
e = math.radians(ELEV_BOTTOM)
hinge_y = HULL_Y + HULL_R * math.sin(e)
corner_z = HULL_R * math.cos(e) * math.cos(math.radians(AZ_HALF))
middle_z = HULL_R * math.cos(e) * math.cos(math.radians(SIDE / 2))
HINGE = (hinge_y, 0.52)   # between the corners (z 0.46) and the middle (z 0.57) of the bottom edge


def door_points():
    """The corners of the door quads, door closed."""
    pts = []
    for row in range(DOOR_ROWS + 1):
        el = math.radians(ELEV_BOTTOM + row * BAND)
        for col in range(DOOR_COLS + 1):
            az = math.radians(-AZ_HALF + col * SIDE)
            pts.append((HULL_R * math.cos(el) * math.sin(az), HULL_Y + HULL_R * math.sin(el), HULL_R * math.cos(el) * math.cos(az)))
    return pts


def lowest(angle):
    a = math.radians(angle)
    return min(HINGE[0] + (y - HINGE[0]) * math.cos(a) - (z - HINGE[1]) * math.sin(a) for _, y, z in door_points())


# It opens until its top edge is just above the ground (the top edge would touch it a few degrees further).
touch = next(t / 10 for t in range(0, 1800) if lowest(t / 10) < 0)
OPEN_MAX = 62
assert OPEN_MAX < touch

open_angle = 0.0
for arg in sys.argv[1:]:
    if arg.startswith("--open="):
        open_angle = max(0.0, min(OPEN_MAX, float(arg.split("=")[1])))
args = [x for x in sys.argv[1:] if not x.startswith("--")]

# --- Colors, from the 2 references (daylight colors, no texture).
LOOK = {
    "hull": "#c4d9dd",        # light grey-blue hull
    "inside": "#eceee8",      # white padding inside the pod and inside the door
    "frame": "#15161c",       # thick black frame of the porthole
    "glass": "#d01a7c",       # pink-magenta glass
    "portElev": 10,           # the porthole: on the door, its center 10 degrees above the widest line
    "frameDeg": 22,           # outer radius of the frame (0.37 m), as on the reference (0.27 of the sphere width)
    "glassDeg": 14,           # radius of the glass
    "metal": "#7f9fbc",       # the hinge and the 2 arms, blue-grey metal
    "hingeR": 0.045, "hingeW": 0.3, "hingeZ": 0.44,   # the hinge bar, inside the hull when the door is closed
    "armT": 0.11, "armR": 0.9,                         # the arms: 0.11 thick, their ends 0.9 from the center
    "armBodyElev": -46, "armBodyAz": 43,              # an end inside the pod, beside the bottom of the opening
    "armDoorElev": -30, "armDoorAz": 33,              # the other end inside the door
}

FACES = [{"face": "side", "texture": "hull"}, {"face": "bottom", "texture": "hull"}]
shapes = [
    {"id": "hull-top", "type": "dome", "size": [2 * HULL_R, HULL_R, 2 * HULL_R], "position": [0, HULL_Y, 0], "rotationY": 0, "tilt": 0, "role": None, "faces": FACES},
    {"id": "hull-bottom", "type": "dome", "size": [2 * HULL_R, HULL_R, 2 * HULL_R], "position": [0, HULL_Y, 0], "rotationY": 0, "tilt": 180, "role": None, "faces": FACES},
]
pod = {"open": R(open_angle), "openMax": OPEN_MAX, "hinge": [R(HINGE[0]), R(HINGE[1])],
       "box": [R(ELEV_BOTTOM - 0.01), R(ELEV_TOP + 0.01), R(AZ_HALF + 0.01)], "center": [0, HULL_Y, 0], "look": LOOK}

f = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")
description = ("Raditz's space pod: a small round grey-blue pod, a sphere 2 m wide sitting on the ground, with a round pink porthole "
               "in a thick black frame on a door cut out of its front, which swings forward and down on a hinge and 2 metal arms.")
layout = (
    f"Middle: the round grey-blue hull, a full sphere {f(2 * HULL_R)} wide (x -1 to 1, z -1 to 1, y 0 to {f(2 * HULL_R)}), with no base and no legs: "
    f"2 domes with the same center {f(HULL_Y)} above the ground, the top half and the bottom half (tilt 180). Its lowest point touches the ground. "
    f"Front: the door is a part of the sphere's own quads (the pod block): from the 3rd row under the top point, 3 quads wide and 6 quads high, "
    f"from {f(ELEV_BOTTOM)} to {f(ELEV_TOP)} degrees of elevation and {f(AZ_HALF)} degrees each side of the front. "
    f"It turns forward and down around a hinge line along x at y {f(HINGE[0])}, z {f(HINGE[1])} (its bottom edge), by up to {OPEN_MAX} degrees, "
    "where its top edge rests on the ground. A blue-grey hinge bar (0.3 long) lies inside the hull at the bottom of the opening, and 2 blue-grey "
    "arms, one on each side, go from inside the pod to inside the door; closed, all of them are inside the sphere. "
    "Colors (flat, no texture): the hull light grey-blue; on the door a round porthole 0.75 wide, pink glass in a thick black frame, "
    "its center 10 degrees above the widest line, which shows inside the door too; the inside of the pod and of the door white. "
    "The crater of the reference is not part of the building."
)
textures = [{"name": "hull", "description": "Light grey-blue metal hull; on the door, a round porthole of pink-magenta glass in a thick black frame",
             "color": LOOK["hull"], "widthM": 3.14, "heightM": 1.0}]

key = ["id", "type", "size", "position", "rotationY", "tilt", "role", "faces"]
out = "{\n" + f' "description": {json.dumps(description)},\n "layout": {json.dumps(layout)},\n "shapes": [\n'
out += ",\n".join("  " + json.dumps({k: s[k] for k in key}) for s in shapes) + "\n ],\n \"textures\": [\n"
out += ",\n".join("  " + json.dumps(t) for t in textures) + "\n ],\n"
out += f' "pod": {json.dumps(pod)}\n}}\n'
json.loads(out)
target = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), "raditz-pod.json")
with open(target, "w") as file:
    file.write(out)
print(f"wrote {target}: {len(shapes)} shapes, door open {f(open_angle)} of {OPEN_MAX} degrees")
