"""Paints pixel-art textures for a building plan.

Each texel of a face is turned into its point on the 3D shape (world coordinates) and its normal, with the same UV
layout as packages/asset-format/src/geometry.ts (UVs in meters). Then:
- a material gives the base color from (u, v) in meters, repeating with the slot size;
- decals (doors, windows, signs...) are placed in world space and paint over it.
A face that a decal touches gets its own slot, sized to the face, so the texture covers it exactly once.
Other faces keep a shared material slot, one period of the material.
"""
import json
import math
import os

import numpy as np
from PIL import Image

TEXELS_PER_METER = 480 / 11
DOME_SIDES, DOME_BANDS, CYL_SIDES = 14, 5, 8


def px(meters):
    return int(min(512, max(4, round(meters * TEXELS_PER_METER))))


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


# ---------- face layout: uv extent, and uv (meters) -> local point and normal ----------

def face_extent(shape, face):
    w, h, d = shape["size"]
    t = shape["type"]
    if t == "box":
        return {"front": (w, h), "back": (w, h), "left": (d, h), "right": (d, h), "top": (w, d), "bottom": (w, d)}[face]
    if t == "wedge":
        slope = math.hypot(h, d / 2)
        return {"front": (w, slope), "back": (w, slope), "left": (d, h), "right": (d, h), "bottom": (w, d)}[face]
    if t == "cylinder":
        return {"side": (cyl_perimeter(w, d), h), "top": (w, d), "bottom": (w, d)}[face]
    if t == "dome":
        around = math.pi * (w + d) / 2
        curve = (math.pi / 2) * ((w + d) / 4 + h) / 2
        return {"side": (around, curve), "bottom": (w, d)}[face]
    raise ValueError(t)


def cyl_ring(w, d):
    return [(math.sin(a) * w / 2, math.cos(a) * d / 2) for a in
            [(i / CYL_SIDES) * 2 * math.pi + math.pi / CYL_SIDES for i in range(CYL_SIDES)]]


def cyl_perimeter(w, d):
    r = cyl_ring(w, d)
    return sum(math.dist(r[i], r[(i + 1) % CYL_SIDES]) for i in range(CYL_SIDES))


def local_points(shape, face, U, V):
    """U, V: arrays of uv in meters. Returns local points (N,3) and normals (N,3)."""
    w, h, d = shape["size"]
    t = shape["type"]
    x, z = w / 2, d / 2
    n = U.size
    P = np.zeros((n, 3))
    N = np.zeros((n, 3))
    if t in ("box", "wedge") or (face in ("top", "bottom")) or (t == "dome" and face == "bottom"):
        if t == "box":
            table = {
                "front": ([-x, 0, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]),
                "back": ([x, 0, -z], [-1, 0, 0], [0, 1, 0], [0, 0, -1]),
                "right": ([x, 0, z], [0, 0, -1], [0, 1, 0], [1, 0, 0]),
                "left": ([-x, 0, -z], [0, 0, 1], [0, 1, 0], [-1, 0, 0]),
                "top": ([-x, h, z], [1, 0, 0], [0, 0, -1], [0, 1, 0]),
                "bottom": ([-x, 0, -z], [1, 0, 0], [0, 0, 1], [0, -1, 0]),
            }
            o, eu, ev, nn = (np.array(a, float) for a in table[face])
        elif t == "wedge":
            slope = math.hypot(h, z)
            if face == "front":
                o, eu, ev = np.array([-x, 0, z]), np.array([1, 0, 0]), np.array([0, h, -z]) / slope
                nn = np.array([0, z, h]) / slope
            elif face == "back":
                o, eu, ev = np.array([x, 0, -z]), np.array([-1, 0, 0]), np.array([0, h, z]) / slope
                nn = np.array([0, z, -h]) / slope
            elif face == "left":
                o, eu, ev, nn = np.array([-x, 0, -z]), np.array([0, 0, 1]), np.array([0, 1, 0]), np.array([-1, 0, 0])
            elif face == "right":
                o, eu, ev, nn = np.array([x, 0, z]), np.array([0, 0, -1]), np.array([0, 1, 0]), np.array([1, 0, 0])
            else:
                o, eu, ev, nn = np.array([-x, 0, -z]), np.array([1, 0, 0]), np.array([0, 0, 1]), np.array([0, -1, 0])
        else:  # flat (x + w/2, d/2 - z) on cylinder top/bottom and dome bottom
            yy = h if face == "top" else 0
            o, eu, ev = np.array([-x, yy, z]), np.array([1, 0, 0]), np.array([0, 0, -1])
            nn = np.array([0, 1 if face == "top" else -1, 0])
        P = o[None, :] + U[:, None] * eu[None, :] + V[:, None] * ev[None, :]
        N[:] = nn
        return P, N
    if t == "cylinder":  # side: flat quads, u runs along the ring edges
        ring = np.array(cyl_ring(w, d))
        nxt = np.roll(ring, -1, 0)
        lens = np.linalg.norm(nxt - ring, axis=1)
        cum = np.concatenate([[0], np.cumsum(lens)])
        k = np.clip(np.searchsorted(cum, U, side="right") - 1, 0, CYL_SIDES - 1)
        f = np.clip((U - cum[k]) / lens[k], 0, 1)
        xz = ring[k] + f[:, None] * (nxt[k] - ring[k])
        P = np.stack([xz[:, 0], V, xz[:, 1]], 1)
        N = np.stack([xz[:, 0] / x ** 2, np.zeros(n), xz[:, 1] / z ** 2], 1)
    else:  # dome side: the same triangles and UVs as geometry.ts, so a texel lands where the game shows it
        around, curve = face_extent(shape, "side")

        def vert(side, band):
            ang = (side / DOME_SIDES) * 2 * math.pi + math.pi / DOME_SIDES
            up = (band / DOME_BANDS) * (math.pi / 2)
            return np.stack([np.sin(ang) * np.cos(up) * x, np.sin(up) * h + 0 * ang, np.cos(ang) * np.cos(up) * z], -1)

        su = U / around * DOME_SIDES
        sv = np.clip(V / curve * DOME_BANDS, 0, DOME_BANDS - 1e-9)
        side = np.floor(su)
        band = np.floor(sv)
        fu, fv = su - side, sv - band
        p0, p1 = vert(side, band), vert(side + 1, band)
        p2, p3 = vert(side + 1, band + 1), vert(side, band + 1)
        lower = (fu[:, None] >= fv[:, None])
        quad = np.where(lower, p0 + fu[:, None] * (p1 - p0) + fv[:, None] * (p2 - p1),
                        p0 + fv[:, None] * (p3 - p0) + fu[:, None] * (p2 - p3))
        top = vert(side, band + 1)  # the top point (every side meets there)
        beta, gamma = fu - 0.5 * fv, fv
        tri = p0 + beta[:, None] * (p1 - p0) + gamma[:, None] * (top - p0)
        P = np.where((band == DOME_BANDS - 1)[:, None], tri, quad)
        N = np.stack([P[:, 0] / x ** 2, P[:, 1] / h ** 2, P[:, 2] / z ** 2], 1)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    return P, N


def to_world(shape, P):
    t = math.radians(shape.get("tilt", 0))
    r = math.radians(shape["rotationY"])
    Rx = np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]])
    Ry = np.array([[math.cos(r), 0, math.sin(r)], [0, 1, 0], [-math.sin(r), 0, math.cos(r)]])
    M = Ry @ Rx
    return P @ M.T + np.array(shape["position"])[None, :], M


# ---------- decals ----------

class Ctx:
    """What a decal sees for a batch of texels of one face."""

    def __init__(self, shape, face, P, N, U, V):
        self.shape, self.face, self.P, self.N, self.U, self.V = shape, face, P, N, U, V


def frame(normal, up=(0, 1, 0)):
    n = np.array(normal, float)
    n /= np.linalg.norm(n)
    u = np.array(up, float)
    right = np.cross(u, n)
    if np.linalg.norm(right) < 1e-6:
        right = np.array([1.0, 0, 0])
    right /= np.linalg.norm(right)
    upv = np.cross(n, right)
    return n, right, upv


class Projected:
    """A flat picture projected along `normal` onto the surface near `center`.
    paint(a, b) gets plane coordinates in meters (a to the right, b up) and returns (rgb (N,3), mask (N,))."""

    def __init__(self, center, normal, paint, up=(0, 1, 0), depth=0.6, facing=0.15, shapes=None):
        self.c = np.array(center, float)
        self.n, self.r, self.u = frame(normal, up)
        self.paint, self.depth, self.facing, self.shapes = paint, depth, facing, shapes

    def apply(self, ctx, rgb, touched):
        if self.shapes is not None and ctx.shape["id"] not in self.shapes:
            return
        d = ctx.P - self.c[None, :]
        along = d @ self.n
        ok = (np.abs(along) < self.depth) & ((ctx.N @ self.n) > self.facing)
        if not ok.any():
            return
        a, b = d @ self.r, d @ self.u
        col, m = self.paint(a, b)
        m = m & ok
        rgb[m] = col[m]
        touched |= m


class Cylindrical:
    """A picture wrapped around the vertical axis through (cx, cz): a = azimuth (degrees, 0 = +z, positive toward +x),
    b = height in meters."""

    def __init__(self, paint, axis=(0, 0), shapes=None, facing=0.0):
        self.cx, self.cz = axis
        self.paint, self.shapes, self.facing = paint, shapes, facing

    def apply(self, ctx, rgb, touched):
        if self.shapes is not None and ctx.shape["id"] not in self.shapes:
            return
        dx, dz = ctx.P[:, 0] - self.cx, ctx.P[:, 2] - self.cz
        az = np.degrees(np.arctan2(dx, dz))
        radial = np.stack([dx, np.zeros_like(dx), dz], 1)
        radial /= np.linalg.norm(radial, axis=1, keepdims=True) + 1e-9
        ok = (np.sum(ctx.N * radial, 1) > self.facing)
        col, m = self.paint(az, ctx.P[:, 1])
        m = m & ok
        rgb[m] = col[m]
        touched |= m


class FaceDecal:
    """Paints straight in the uv space of one face (meters): paint(u, v) -> (rgb, mask)."""

    def __init__(self, shape_id, face, paint):
        self.sid, self.face, self.paint = shape_id, face, paint

    def apply(self, ctx, rgb, touched):
        if ctx.shape["id"] != self.sid or ctx.face != self.face:
            return
        col, m = self.paint(ctx.U, ctx.V)
        rgb[m] = col[m]
        touched |= m


# ---------- shape helpers for decal pictures ----------

def solid(n, color):
    return np.repeat(hexrgb(color)[None, :], n, 0)


def layers(a, b, items):
    """items: list of (mask_fn(a, b) -> bool array, color). Later items paint over earlier ones."""
    n = a.size
    rgb = np.zeros((n, 3))
    m = np.zeros(n, bool)
    for fn, color in items:
        k = fn(a, b)
        if isinstance(color, str):
            rgb[k] = hexrgb(color)
        else:
            rgb[k] = color(a, b)[k]
        m |= k
    return rgb, m


def disc(cx, cy, r):
    return lambda a, b: (a - cx) ** 2 + (b - cy) ** 2 <= r * r


def ellipse(cx, cy, rx, ry):
    return lambda a, b: ((a - cx) / rx) ** 2 + ((b - cy) / ry) ** 2 <= 1


def rect(x0, y0, x1, y1):
    return lambda a, b: (a >= x0) & (a <= x1) & (b >= y0) & (b <= y1)


def arch(cx, y0, w, top):
    """A door shape: a rectangle from y0 with a round top, total height up to `top`."""
    r = w / 2
    yc = top - r
    return lambda a, b: ((np.abs(a - cx) <= r) & (b >= y0) & (b <= yc)) | (((a - cx) ** 2 + (b - yc) ** 2 <= r * r) & (b > yc))


def diamond(cx, cy, rx, ry):
    return lambda a, b: np.abs(a - cx) / rx + np.abs(b - cy) / ry <= 1


def mask_image(img, a0, b0, a1, b1, threshold=128):
    """A picture from a grayscale image (dark = paint) covering [a0, a1] x [b0, b1]."""
    arr = np.asarray(img.convert("L"), dtype=np.float64)
    H, W = arr.shape

    def fn(a, b):
        i = ((a - a0) / (a1 - a0) * W).astype(int)
        j = ((b1 - b) / (b1 - b0) * H).astype(int)
        inside = (i >= 0) & (i < W) & (j >= 0) & (j < H)
        out = np.zeros(a.size, bool)
        out[inside] = arr[j[inside], i[inside]] < threshold
        return out
    return fn


# ---------- painting a plan ----------

class Material:
    """pattern(u, v) -> rgb (N,3); repeats every period (pw, ph) meters."""

    def __init__(self, name, color, description, pattern=None, period=(1.0, 1.0)):
        self.name, self.color, self.description = name, color, description
        self.pattern = pattern or (lambda u, v: solid(u.size, color))
        self.period = period


def grid(Wp, Hp, wm, hm):
    i, j = np.meshgrid(np.arange(Wp), np.arange(Hp))
    U = (i.ravel() + 0.5) / Wp * wm
    V = (Hp - j.ravel() - 0.5) / Hp * hm
    return U, V


def paint_plan(plan, materials, decals, out_dir, name):
    """materials: slot name -> Material (every slot of the plan). Writes out_dir/<name>.json and out_dir/textures/."""
    os.makedirs(os.path.join(out_dir, "textures"), exist_ok=True)
    for f in os.listdir(os.path.join(out_dir, "textures")):
        os.remove(os.path.join(out_dir, "textures", f))
    new_shapes, slots, used = [], [], set()

    def save(slot_name, rgb, Wp, Hp, wm, hm, color, desc):
        img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8).reshape(Hp, Wp, 3), "RGB")
        img.save(os.path.join(out_dir, "textures", slot_name + ".png"))
        slots.append({"name": slot_name, "description": desc, "color": color, "widthM": round(wm, 3), "heightM": round(hm, 3),
                      "file": f"textures/{slot_name}.png"})

    for shape in plan["shapes"]:
        faces = []
        for fe in shape["faces"]:
            face, slot = fe["face"], fe["texture"]
            mat = materials[slot]
            wm, hm = face_extent(shape, face)
            Wp, Hp = px(wm), px(hm)
            U, V = grid(Wp, Hp, wm, hm)
            P, N = local_points(shape, face, U, V)
            Pw, M = to_world(shape, P)
            Nw = N @ M.T
            ctx = Ctx(shape, face, Pw, Nw, U, V)
            rgb = mat.pattern(np.mod(U, mat.period[0]), np.mod(V, mat.period[1]))
            touched = np.zeros(U.size, bool)
            for dcl in decals:
                dcl.apply(ctx, rgb, touched)
            if touched.any():
                sname = f"{shape['id']}-{face}"
                save(sname, rgb, Wp, Hp, wm, hm, mat.color, f"{mat.description}, with its painted details, on the {face} of {shape['id']}")
                faces.append({"face": face, "texture": sname})
            else:
                faces.append({"face": face, "texture": slot})
                used.add(slot)
        s2 = dict(shape)
        s2["faces"] = faces
        new_shapes.append(s2)
    for slot in plan["textures"]:
        if slot["name"] in used:
            mat = materials[slot["name"]]
            pw, ph = mat.period
            Wp, Hp = px(pw), px(ph)
            U, V = grid(Wp, Hp, pw, ph)
            save(slot["name"], mat.pattern(U, V), Wp, Hp, pw, ph, mat.color, mat.description)
    out = dict(plan)
    out["shapes"] = new_shapes
    out["textures"] = slots
    key = ["id", "type", "size", "position", "rotationY", "tilt", "role", "faces"]
    text = "{\n" + f' "description": {json.dumps(out["description"])},\n "layout": {json.dumps(out["layout"])},\n "shapes": [\n'
    text += ",\n".join("  " + json.dumps({k: s.get(k, 0 if k == "tilt" else None) for k in key}) for s in new_shapes) + "\n ],\n \"textures\": [\n"
    text += ",\n".join("  " + json.dumps(t) for t in slots) + "\n ]\n}\n"
    path = os.path.join(out_dir, name + ".json")
    with open(path, "w") as f:
        f.write(text)
    return path, len(slots)


# ---------- pictures from images (Infer textures) ----------

def image_pattern(img, pw, ph):
    """A material from one tile image covering pw x ph meters; u, v already wrapped into the period."""
    arr = np.asarray(img.convert("RGB"), dtype=np.float64)
    H, W = arr.shape[:2]

    def fn(u, v):
        i = np.clip((u / pw * W).astype(int), 0, W - 1)
        j = np.clip(((1 - v / ph) * H).astype(int), 0, H - 1)
        return arr[j, i]
    return fn


def image_paint(img, a0, b0, a1, b1, mask=None):
    """A picture from an image covering [a0, a1] x [b0, b1]; mask(a, b) limits where it paints (default: the rectangle)."""
    arr = np.asarray(img.convert("RGB"), dtype=np.float64)
    H, W = arr.shape[:2]

    def fn(a, b):
        i = ((a - a0) / (a1 - a0) * W).astype(int)
        j = ((b1 - b) / (b1 - b0) * H).astype(int)
        inside = (i >= 0) & (i < W) & (j >= 0) & (j < H)
        m = inside if mask is None else (inside & mask(a, b))
        rgb = np.zeros((a.size, 3))
        rgb[inside] = arr[j[inside], i[inside]]
        return rgb, m
    return fn


# ---------- simple fills: one shared material inside a shape ----------

def fill(pattern, period, mask, shade=1.0):
    """A picture: the material `pattern` (repeating every `period` meters) inside `mask`, times `shade`."""
    pw, ph = period

    def fn(a, b):
        m = mask(a, b)
        return pattern(np.mod(a, pw), np.mod(b, ph)) * shade, m
    return fn


def flat(color, mask):
    return lambda a, b: (solid(a.size, color), mask(a, b))


def framed(outer, inner, frame_fn, inner_fn):
    """frame_fn paints the ring between outer and inner, inner_fn paints inside inner (both pictures)."""
    def fn(a, b):
        fr, fm = frame_fn(a, b)
        ir, im = inner_fn(a, b)
        m_in = inner(a, b)
        m_out = outer(a, b)
        rgb = np.where(m_in[:, None], ir, fr)
        return rgb, m_out
    return fn
