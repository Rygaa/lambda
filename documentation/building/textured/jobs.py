"""Every image asked from Infer for the 3 buildings: name -> (reference image, prompt).
Sizes are the real area each image covers on the building, in meters (placement: paint_*.py)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from infer_client import prompt  # noqa

HERE = os.path.dirname(os.path.abspath(__file__))
EX = os.path.join(HERE, "..", "example")
REFS = {"ship": os.path.join(EX, "capsule-reference.png"),
        "buu": os.path.join(EX, "buu-reference.png"),
        "chichi": os.path.join(EX, "chichi-reference.png")}
NAMES = {"ship": "the Capsule Corp ship, a big round white spaceship with a black cap and a wide black band",
         "buu": "Buu's house, a round house of smooth white clay shaped like a lying caterpillar",
         "chichi": "Chichi's house, a cream brick house with a brown tile roof, a white dome house in front, and a wing on the right"}

# name: (building, kind, size w x h in meters, main color, what to paint, has text)
SPECS = {
    # --- ship
    "ship-porthole": ("ship", "object", (0.33, 0.33), "#1f63d6",
                      "One round porthole window: blue glass with a small light reflection in the top left, inside a thin pale grey-white metal rim. The corners outside the rim are black hull.", False),
    "ship-door": ("ship", "object", (0.78, 1.01), "#e9ede9",
                  "The round-topped door opening in the hull of the ship: a thick white metal frame with a round top around a dark navy blue opening. "
                  "Inside the opening, the light grey inner wall of the passage shows on the left side, and the floor is dark grey at the bottom. "
                  "The frame fills the image: its outer edge touches the left, right, and top edges of the image. The corners outside the round top are black.", False),
    "ship-capsule": ("ship", "object", (3.04, 0.39), "#f1f6f0",
                     "The word CAPSULE written in very big, heavy, black bold capital letters on white paint. "
                     "The seven letters fill the whole image, from the left edge to the right edge and from the top edge to the bottom edge.", "letters"),
    "ship-corp": ("ship", "object", (1.09, 0.18), "#f1f6f0",
                  "The word CORP. written in big, heavy, black bold capital letters on white paint. "
                  "The letters and the dot fill the whole image, from the left edge to the right edge and from the top edge to the bottom edge.", "letters"),
    "ship-ramp": ("ship", "material", (0.6, 0.6), "#c9ccd3",
                  "A light grey metal ramp seen from above: thin grey step lines across it every 12 cm, and a white rail along the whole left edge and the whole right edge.", False),
    # --- buu
    "buu-clay": ("buu", "material", (1.2, 1.2), "#eeebf5",
                 "Smooth white clay with a light lavender tint, soft and even, with a few very faint darker smudges.", False),
    "buu-hole": ("buu", "object", (1.1, 1.1), "#eeebf5",
                 "A big round opening in the white clay wall: a thick raised round rim around a deep dark blue hole. "
                 "The rim is a light lavender grey (#cfcae2), clearly darker than the white wall, with a thin darker lavender line (#a9a3c6) along its outer edge and its inner edge. "
                 "The rim's outer edge touches the four edges of the image; the corners outside it are the white clay wall (#eeebf5).", False),
    "buu-window": ("buu", "object", (0.2, 0.2), "#3a4a78",
                   "One small round window in white clay: a dark blue-grey round glass with a thin light rim. The window fills the image.", False),
    # --- shared by the 3 buildings: every window and porthole
    "glass": ("chichi", "material", (0.6, 0.6), "#5f86c8",
              "Plain blue window glass, flat and opaque, with one or two faint lighter blue diagonal streaks. No frame.", False),
    # --- chichi materials
    "chichi-wall": ("chichi", "material", (1.2, 1.14), "#f2dab0",
                    "Cream walls of pale stone blocks laid in rows, with thin slightly darker joints.", False),
    "chichi-tile": ("chichi", "material", (0.6, 0.6), "#c47a4a",
                    "Brown clay roof tiles in overlapping horizontal rows.", False),
    "chichi-wood": ("chichi", "material", (0.7, 0.9), "#ab7c58",
                    "Brown wooden planks standing vertically, with thin darker gaps between them.", False),
    "chichi-white": ("chichi", "material", (1.0, 1.0), "#f0e8d0",
                     "Smooth warm white plaster with very faint cream variation.", False),
    "chichi-grey": ("chichi", "material", (0.8, 0.16), "#b8b4b0",
                    "Grey stone blocks of a low foundation, in one row.", False),
    # --- chichi objects
    "chichi-window": ("chichi", "object", (0.62, 0.68), "#7a5a9a",
                      "One small window with deep violet shutters, a reddish wooden frame, and pale lilac panes in a lattice.", False),
    "chichi-narrow-window": ("chichi", "object", (0.26, 0.9), "#a8c8e8",
                             "One tall narrow window: pale blue glass panes in a light blue-grey frame.", False),
    "chichi-wing-door": ("chichi", "object", (0.5, 0.85), "#9a6a48",
                         "One brown wooden door made of vertical planks with two horizontal bars and a small dark handle.", False),
    "chichi-wing-window": ("chichi", "object", (0.3, 0.6), "#a8c8e8",
                           "One tall pale blue window with a light blue frame.", False),
    "chichi-dome-door": ("chichi", "object", (0.6, 1.1), "#9a6a48",
                         "One brown wooden door with a round top, made of vertical planks, inside a slim cream arch border. "
                         "The door fills the image: its round top touches the top edge. The corners outside the round top are warm white plaster.", False),
    "chichi-dome-window": ("chichi", "object", (0.85, 0.3), "#5f78a8",
                           "One wide window, fully opaque with no transparent pixels: a long rounded rectangle of solid flat slate blue glass (#5f78a8) "
                           "with two diagonal lighter blue stripes (#9db4d8), in a slim pale cream frame (#e8e0c8). The glass fills almost the whole image.", False),
    "chichi-sign": ("chichi", "object", (0.5, 0.6), "#c8323a",
                    "One crimson red diamond-shaped sign standing on its point, with a thin dark red border and the Chinese character 福 painted in dark red in its center. "
                    "The diamond's points touch the four edges of the image. The corners outside the diamond are warm white plaster.", True),
    "chichi-vent": ("chichi", "object", (0.4, 0.75), "#c8d4e0",
                    "The front of a small roof vent: pale blue-grey metal with two dark vertical slits near the top.", False),
}


def jobs(names=None):
    from infer_client import reference_png
    refs = {k: reference_png(v) for k, v in REFS.items()}
    out = {}
    for name, (b, kind, (w, h), color, what, text) in SPECS.items():
        if names and name not in names:
            continue
        out[name] = (prompt(NAMES[b], what, color, w, h, kind, text=text), refs[b])
    return out


if __name__ == "__main__":
    from infer_client import generate_all
    names = sys.argv[1:] or None
    generate_all(jobs(names))
    print("all done")
