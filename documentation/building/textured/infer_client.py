"""Calls Infer (https://inferapi.aissabenfodda.ca/api/v1/requests, type "images") like apps/asset-studio/server/infer.ts.

The key is read from the INFER_API_KEY environment variable. Each image is cached in infer-cache/<name>.png
(with its prompt in <name>.txt), so a run only asks for images that are missing or whose prompt changed.
"""
import base64
import concurrent.futures as cf
import io
import json
import os
import time
import urllib.error
import urllib.request

from PIL import Image

URL = "https://inferapi.aissabenfodda.ca/api/v1"
UA = "project-lambda-texture-tool/1.0"
MODEL, EFFORT = "gpt-5.6-luna", "low"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "infer-cache")
TEXELS_PER_METER = 480 / 11
MAX_COLORS = 16


def _key():
    key = os.environ.get("INFER_API_KEY", "").strip()
    if not key:
        raise SystemExit("INFER_API_KEY is missing")
    return key


def reference_png(path, max_bytes=2 * 1024 * 1024):
    img = Image.open(path).convert("RGB")
    for size in (1024, 768, 512):
        im = img.copy()
        im.thumbnail((size, size))
        buf = io.BytesIO()
        im.save(buf, "PNG")
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    raise ValueError("reference too large")


def _request(body, timeout=330):
    data = json.dumps({**body, "mode": "stream"}).encode()
    req = urllib.request.Request(f"{URL}/requests", data=data, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {_key()}", "User-Agent": UA})
    request_id = None
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = ""
            for raw in resp:
                buf += raw.decode()
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    lines = block.split("\n")
                    event = next((l[6:].strip() for l in lines if l.startswith("event:")), None)
                    payload = "\n".join(l[5:].lstrip() for l in lines if l.startswith("data:"))
                    msg = json.loads(payload or "{}")
                    if event in ("done", "error"):
                        return msg
                    if msg.get("event") == "accepted":
                        request_id = msg.get("requestId")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Infer HTTP {e.code}: {e.read().decode()[:500]}")
    except Exception:
        if not request_id:
            raise
    # the stream was cut: read the request until it ends
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(10)
        req = urllib.request.Request(f"{URL}/requests/{request_id}", headers={"Authorization": f"Bearer {_key()}", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                view = json.loads(resp.read())
            if view.get("status") != "running":
                return view
        except Exception:
            pass
    raise RuntimeError(f"Infer request {request_id} did not end in time")


def generate(name, prompt, reference):
    """Returns the big Infer image (PIL) for this prompt, from the cache when the prompt is the same."""
    os.makedirs(CACHE, exist_ok=True)
    png, txt = os.path.join(CACHE, name + ".png"), os.path.join(CACHE, name + ".txt")
    if os.path.exists(png) and os.path.exists(txt) and open(txt).read() == prompt:
        return Image.open(png).convert("RGBA")
    last = None
    for attempt in range(3):
        try:
            view = _request({"type": "images", "input": {"prompt": prompt, "model": MODEL, "reasoningEffort": EFFORT,
                                                          **({"referenceImage": base64.b64encode(reference).decode()} if reference else {})}})
            if view.get("status") == "succeeded" and isinstance(view.get("result", {}).get("image"), str):
                with open(png, "wb") as f:
                    f.write(base64.b64decode(view["result"]["image"]))
                with open(txt, "w") as f:
                    f.write(prompt)
                print(f"  infer: {name} ok ({view.get('estimatedCostUsd')} USD)", flush=True)
                return Image.open(png).convert("RGBA")
            last = view.get("error") or view
        except Exception as e:  # noqa
            last = e
        print(f"  infer: {name} failed (attempt {attempt + 1}): {str(last)[:300]}", flush=True)
        time.sleep(5)
    raise RuntimeError(f"{name}: {last}")


def generate_all(jobs, workers=2):
    """jobs: dict name -> (prompt, reference bytes). Infer runs 2 image calls at the same time."""
    out = {}
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(generate, n, p, r): n for n, (p, r) in jobs.items()}
        for fut in cf.as_completed(futs):
            out[futs[fut]] = fut.result()
    return out


def to_pixels(img, width_m, height_m, background):
    """Like toPixelTexture in textures.ts: flatten, resize to 1 texel per game pixel, at most 16 colors, no dithering."""
    w = int(min(512, max(4, round(width_m * TEXELS_PER_METER))))
    h = int(min(512, max(4, round(height_m * TEXELS_PER_METER))))
    bg = Image.new("RGBA", img.size, background)
    flat = Image.alpha_composite(bg, img.convert("RGBA")).convert("RGB")
    small = flat.resize((w, h), Image.LANCZOS)
    return small.quantize(colors=MAX_COLORS, dither=Image.Dither.NONE).convert("RGB")


RULES = """
Rules:
- A straight-on flat view of the surface that fills the whole image, edge to edge. No perspective, no background, no border, no frame{text}.
- The image will be stretched to a {w}:{h} area, so place details for that shape.
- Simple pixel art: big flat color areas, clear shapes, few colors.
- {colors}
- {kind}
- No painted light, no shadows, no outlines, no gradients. The game adds light and outlines.
- The final texture is only {pw} x {ph} pixels, so only big details survive."""


def prompt(building, what, color, w, h, kind, text=False, reference_note=True):
    """The prompt of the asset studio (textures.ts buildPrompt), for one material or one object."""
    pw = int(min(512, max(4, round(w * TEXELS_PER_METER))))
    ph = int(min(512, max(4, round(h * TEXELS_PER_METER))))
    lines = [
        "Paint one flat texture for a top-down 3D pixel art game.",
        f'It covers {w} x {h} meters of "{building}".',
        f"What to paint: {what}",
        f"Main color: {color}.",
    ]
    if reference_note:
        lines.append("The reference image shows the object. Copy the material of this surface from it, but in plain white daylight: "
                     "never copy the sunset, night, or colored light of the image.")
    k = ("A material repeats, so its opposite edges must meet with no seams, and it has no signs or one-time marks."
         if kind == "material" else
         "This is one object, painted once: it fills the whole image, edge to edge.")
    colors = ("Use only two flat colors: solid pure black letters (#16191e) and plain white paint (#f1f6f0) around them. No grey, no texture in the letters."
              if text == "letters" else
              "Most of the image is the main color. Joints, lines, and marks are one or two steps lighter or darker in the same hue.")
    lines.append(RULES.format(w=w, h=h, pw=pw, ph=ph, kind=k, text="" if text else ", no text", colors=colors))
    return "\n".join(lines)
