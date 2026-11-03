"""Builds example/buu-house.json, the Buu house plan, from its measures.

Run:  python3 build-buu-house.py [out.json]   (default: buu-house.json next to this file)

Every number below was measured on example/buu-reference.png and checked by drawing the plan
next to the reference (tools/preview). Only the global form is built: the door hole, the hole
in the front of the tube, and the small round windows will be textures.
"""
import json
import math
import os
import sys

rad, deg = math.radians, math.degrees
R = lambda v: round(v, 3)
shapes = []


def add(id, size, pos, rotY=0, tilt=0):
    """Adds a white dome. The whole house is domes, in one color."""
    shapes.append({"id": id, "type": "dome", "size": [R(v) for v in size], "position": [R(v) for v in pos],
                   "rotationY": R(rotY), "tilt": R(tilt), "role": None,
                   "faces": [{"face": "side", "texture": "white"}, {"face": "bottom", "texture": "white"}]})


def unit(v):
    length = math.sqrt(sum(c * c for c in v))
    return [c / length for c in v]


# --- The head: a lying egg, long and round at the same time (guide: "a body long and round at the same time").
# Its axis runs along x, 0.4 above the ground (the height of its round left end); its lower part is under the ground.
HEAD_LEFT = -3.2   # the round left end (segment 1 starts at -0.8, so 2.4 of the head shows)
HEAD_LF = 1.4      # left half: the highest point is at 0.6 of the visible length, as on the reference
HEAD_LB = 1.6      # right half: at the joint (x -0.8) the head is 1.26 high, segment 1 is 1.25; the rest hides in segment 1
HEAD_RV = 1.1      # height above the axis: top at 0.4 + 1.1 = 1.5
HEAD_RZ = 1.15     # half its depth: 2.3 deep
HEAD_YA = 0.4
HEAD_XC = HEAD_LEFT + HEAD_LF
add("head-front", [2 * HEAD_RZ, HEAD_LF, 2 * HEAD_RV], [HEAD_XC, HEAD_YA, 0], rotY=-90, tilt=90)
add("head-back", [2 * HEAD_RZ, HEAD_LB, 2 * HEAD_RV], [HEAD_XC, HEAD_YA, 0], rotY=90, tilt=90)


def head_top(x, z):
    """Height of the head surface at (x, z), or None outside it."""
    half = HEAD_LF if x < HEAD_XC else HEAD_LB
    q = 1 - ((x - HEAD_XC) / half) ** 2 - (z / HEAD_RZ) ** 2
    return HEAD_YA + HEAD_RV * math.sqrt(q) if q > 0 else None


# --- 4 segments, standing domes. Their heights rise from segment 1 to segment 3; the tail is the smallest.
# Each presses 0.5 into the next; segment 1 goes 0.6 into the head. (id, center x, width, height, depth)
SEGMENTS = [("seg-1", 0.0, 1.6, 1.25, 1.95), ("seg-2", 1.15, 1.7, 1.38, 2.05),
            ("seg-3", 2.4, 1.8, 1.48, 2.15), ("tail", 3.5, 1.4, 1.0, 1.6)]
for id, cx, w, h, d in SEGMENTS:
    add(id, [w, h, d], [cx, 0, 0])

# --- 2 fins: fat, short domes laid on their side, straight along the body, pointing left.
# Their flat base hides in the head; their point sticks out. (id, base x from the head's left end, base z, length)
FINS = [("foot-front", 0.35, 0.75, 0.85), ("foot-back", 0.3, 0.1, 0.9)]
FIN_RV, FIN_RZ = 0.23, 0.28   # 0.46 thick, 0.56 wide; the axis is 0.23 above the ground, so the fin lies on it
for id, bx, bz, length in FINS:
    add(id, [2 * FIN_RZ, length, 2 * FIN_RV], [HEAD_LEFT + bx, FIN_RV, bz], rotY=-90, tilt=90)

# --- The tube on the head: 3.9 long, fattest (1.7) in the middle, cut flat at the front, a big round back.
# It runs almost along the body (turned 15 degrees to the back right), its back end raised 7 degrees.
AZ, RISE = 15, 7
# A short front egg, then the main egg, fattest in the middle. (name, center from the front, radius, front half, back half)
EGGS = [("tube-front-end", 0.36, 0.78, 0.35, 3.2), ("tube-body", 2.1, 0.85, 2.09, 1.8)]
CUT_R, CUT_LEN = 0.53, 0.6    # the flat cut: a dome pointing back into the tube; its base is the full, flat front face
FRONT_FROM_LEFT, FRONT_Z = 0.36, 0.4   # the front face sits over the head's left end; the tube stays over the middle of the body

d = [math.cos(rad(RISE)) * math.cos(rad(AZ)), math.sin(rad(RISE)), -math.cos(rad(RISE)) * math.sin(rad(AZ))]
ROT_BACK, TILT_BACK = deg(math.atan2(d[0], d[2])), 90 - RISE   # a dome laid toward the back
ROT_FRONT, TILT_FRONT = ROT_BACK - 180, 90 + RISE              # a dome laid toward the front


def tube_radius(tf):
    """Radius of the tube outline at tf meters behind the cut."""
    radii = [r * math.sqrt(1 - ((tf - c) / (fh if tf < c else bh)) ** 2) for _, c, r, fh, bh in EGGS if -fh < tf - c < bh]
    cut = CUT_R * math.sqrt(1 - (tf / CUT_LEN) ** 2) if 0 <= tf < CUT_LEN else 0
    return max(radii + [cut])


def tube_surface(front):
    """Points on the tube surface, for a front face centered at `front`."""
    side = unit([-d[2], 0, d[0]])
    up = unit([d[1] * side[2] - d[2] * side[1], d[2] * side[0] - d[0] * side[2], d[0] * side[1] - d[1] * side[0]])
    for k in range(78):
        tf = k * 0.05
        r = tube_radius(tf)
        for j in range(24):
            a = j / 24 * 2 * math.pi
            yield [front[i] + tf * d[i] + r * (math.cos(a) * side[i] + math.sin(a) * up[i]) for i in range(3)]


def depth_in_head(p):
    top = head_top(p[0], p[2])
    return top - p[1] if top is not None else -9


# Sit the tube on the head: its lowest point goes 0.14 into the head (guide: "sitting on a round part").
front = [HEAD_LEFT + FRONT_FROM_LEFT, 0.0, FRONT_Z]
front[1] = max(depth_in_head(p) for p in tube_surface(front)) - 0.14
for name, c, r, fh, bh in EGGS:
    center = [front[i] + c * d[i] for i in range(3)]
    add(f"{name}-front", [2 * r, fh, 2 * r], center, ROT_FRONT, TILT_FRONT)
    add(f"{name}-back", [2 * r, bh, 2 * r], center, ROT_BACK, TILT_BACK)
add("tube-cut", [2 * CUT_R, CUT_LEN, 2 * CUT_R], front, ROT_BACK, TILT_BACK)
middle = [front[i] + 2.1 * d[i] for i in range(3)]


# --- Center the footprint on x = 0.
def corners(s):
    a = rad(s["rotationY"])
    w, h, dd = s["size"]
    x, _, z = s["position"]
    pts = [(-w / 2, 0), (w / 2, 0), (-w / 2, h), (w / 2, h)] if s["tilt"] == 90 else [(-w / 2, -dd / 2), (w / 2, -dd / 2), (w / 2, dd / 2), (-w / 2, dd / 2)]
    return [(x + px * math.cos(a) + pz * math.sin(a), z - px * math.sin(a) + pz * math.cos(a)) for px, pz in pts]


xs = [p[0] for s in shapes for p in corners(s)]
shift = -round((min(xs) + max(xs)) / 2, 2)
for s in shapes:
    s["position"][0] = R(s["position"][0] + shift)
front[0] += shift
middle[0] += shift

# --- The text.
S = {s["id"]: s for s in shapes}
f = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")


def x_range(id):
    s = S[id]
    return f(s["position"][0] - s["size"][0] / 2), f(s["position"][0] + s["size"][0] / 2)


hf, hb, s1 = S["head-front"], S["head-back"], S["seg-1"]
hx = hf["position"][0]
h_left, h_right = hx - hf["size"][1], hx + hb["size"][1]
s1_left = s1["position"][0] - s1["size"][0] / 2
h_top = hf["position"][1] + hf["size"][2] / 2
seg_text = ", ".join(f"{name} x {x_range(id)[0]} to {x_range(id)[1]} ({f(S[id]['size'][1])} high)"
                     for id, name in [("seg-1", "segment 1"), ("seg-2", "segment 2"), ("seg-3", "segment 3"), ("tail", "tail")])
layout = (
    "Middle: the lower body lies along x, straight on the ground with no stone base: a big white head and four round segments to its right. "
    f"The head is a lying egg, long and round at the same time: its round left end is at x {f(h_left)}, about {f(hf['position'][1])} above the ground; "
    f"it is highest ({f(h_top)}) at x {f(hx)}, 0.6 of its visible length, and 2.3 deep. Its axis runs along x at {f(hf['position'][1])} high, so its lower part is under the ground. "
    f"Its back half ({f(hb['size'][1])} long) goes into segment 1 and ends at x {f(h_right)}: at the joint (x {f(s1_left)}) the head is about as high as segment 1, so it shows {f(s1_left - h_left)} of its length. "
    f"The segment heights rise from segment 1 to segment 3, and the tail is the smallest: {seg_text}. "
    "Each segment presses 0.5 into the next: they join. "
    "Front left: two long pointed fins lie on the ground under the round left end of the head, each a dome laid on its side with its base hidden in the head: "
    "one in front and one behind, both straight along the body, pointing left; they are 0.46 thick and stick out about 0.5 and 0.6 to the left of the head. "
    "Top: a long round white tube lies on the head, 3.9 long. It runs almost along the body, turned only 15 degrees to the back right, and its back end rises 7 degrees. "
    f"Its front is cut flat, like a sausage cut with a knife: a full flat round face, 1.06 wide, at the front left (center x {f(front[0])}, z {f(front[2])}, about {f(front[1])} high). Nothing comes out of it and it is not hollow. "
    f"Right behind the cut the tube is already nearly full (1.56 wide at 0.4 m), then it swells to its fattest part, 1.7 wide, in the middle (x {f(middle[0])}, z {f(middle[2])}), then ends in a big round back. "
    "It is a short front egg and a main egg (each 2 domes back to back, laid along the tube); the cut face is the flat base of a dome pointing back, whose rest is hidden inside. "
    "Its lowest point is 0.14 into the top of the head, so it sits on the head; its back hangs over segment 1, 0.66 above it. "
    "The round door hole on the head, the hole in the cut face of the tube, and all the small round windows are not shapes: they will be painted in textures."
)
description = ("Buu's house: a white round house like a lying caterpillar, with a big head like a lying egg, four round segments trailing to the right, "
               "and a long round tube lying on top, fattest in the middle, with its flat front to the front left.")
textures = [{"name": "white", "description": "Smooth white clay", "color": "#eeebf5", "widthM": 2.4, "heightM": 1.6}]

key = ["id", "type", "size", "position", "rotationY", "tilt", "role", "faces"]
out = "{\n" + f' "description": {json.dumps(description)},\n "layout": {json.dumps(layout)},\n "shapes": [\n'
out += ",\n".join("  " + json.dumps({k: s[k] for k in key}) for s in shapes) + "\n ],\n \"textures\": [\n"
out += ",\n".join("  " + json.dumps(t) for t in textures) + "\n ]\n}\n"
json.loads(out)
target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "buu-house.json")
with open(target, "w") as file:
    file.write(out)
print(f"wrote {target}: {len(shapes)} shapes")
