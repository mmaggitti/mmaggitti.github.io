#!/usr/bin/env python3
"""Write ../model.json, the plant that TOUR draws, from the source model in asu_scene.py.

asu_scene.py is in SVG px: 10 px = 1 m, screen-y down, ground at y = 820, z = depth.
model.json is in meters: Y up, X along the plant, Z toward the viewer (the plant's front is z = 0).

Run from projects/tour/:

    python3 -B tools/export_model.py

-B stops Python writing __pycache__ beside the served files.
"""
import json
import re
from pathlib import Path

import asu_scene as M

OUT = Path(__file__).resolve().parent.parent / "model.json"


def X(x):
    return x / 10.0


def Y(y):
    return (M.G - y) / 10.0


def Z(z):
    return -z / 10.0


# The captions in asu_scene.py were written for the SVG versions. The 3D page says a few things
# differently, and it uses US spelling.
REWORD = {
    "This model is drawn at 1 px = 0.1 m.": "Everything is to scale: the column cold box is 60 m tall.",
    "Use Next and Back, the arrow keys, or the dots to step through the process.":
        "Step through it with Next and Back, or the arrow keys.",
}
SPELLING = [("Colour", "Color"), ("colour", "color"), ("aluminium", "aluminum"),
            ("vaporises", "vaporizes"), ("vapour", "vapor"), ("distils", "distills")]


def caption(text):
    for old, new in REWORD.items():
        text = text.replace(old, new)
    for old, new in SPELLING:
        text = re.sub(old, new, text)
    return text


# Labels: text, anchor (SVG px), and the item whose tour stage reveals the label.
LABELS = [
    ("Intake filter", 70, 740, 50, "Intake filter house"),
    ("Main air compressor", 230, 700, 60, "Compressor building"),
    ("Aftercooler", 385, 660, 55, "Aftercooler"),
    ("Adsorbers", 558, 740, 55, "Adsorber A"),
    ("Vent", 480, 665, 55, "Vent stack"),
    ("Booster + N₂ recycle compressors", 743, 700, 50, "Booster building"),
    ("Exchanger cold box · 20 m", 890, 620, 60, "Exchanger cold box"),
    ("Expanders", 982, 700, 60, "Air expander"),
    ("Column cold box · 60 m", 1077, 220, 60, "Column cold box"),
    ("Argon cold box · 45 m", 1180, 370, 60, "Argon cold box"),
    ("LAR", 1330, 700, 60, "LAR tank"),
    ("LOX", 1440, 620, 60, "LOX tank"),
    ("LIN", 1565, 640, 60, "LIN tank"),
    ("GOX / GAN pipeline", 1600, 150, 140, "pipeline"),
    ("Regen gas heater", 528, 560, 55, "Regen gas heater"),
]


def export():
    stage = M.STAGE.get
    boxes = [dict(name=name, style=style, stage=stage(name),
                  min=[X(x0), Y(yb), Z(z1)], max=[X(x1), Y(yt), Z(z0)])
             for name, x0, x1, z0, z1, yt, yb, style in M.BOXES]
    cyls = []
    for name, cx, cz, r, yt, yb, bands in M.CYLS:
        segs = bands or [(yt, yb, M.EQ_FILL)]
        cyls.append(dict(name=name, stage=stage(name), cx=X(cx), cz=Z(cz), r=r / 10.0, top=Y(yt), bot=Y(yb),
                         bands=[dict(top=Y(a), bot=Y(b), color=col) for a, b, col in segs]))
    pipes = [dict(name=p["name"], stage=stage(p["name"]), t=p["t"], k=p["k"], end=p["end"],
                  r=0.22 if p["sw"] >= 2 else 0.14, pts=[[X(x), Y(y), Z(z)] for x, y, z in p["pts"]])
             for p in M.PIPES]
    tour = []
    for s in M.TOUR:
        if s["f"] is None:
            box = [[0, 0, -16], [164, 68, 0]]  # the whole plant
        else:
            xs, zs, ys = s["f"]
            box = [[X(xs[0]), Y(ys[1]), Z(zs[1])], [X(xs[1]), Y(ys[0]), Z(zs[0])]]
        tour.append(dict(t=s["t"], l=[caption(t) for t in s["l"]], box=box, all=bool(s.get("all"))))
    return dict(
        units="meters; Y up, X along the plant, Z toward the viewer",
        boxes=boxes, cyls=cyls, pipes=pipes,
        tie=[[X(x), Y(y), Z(z)] for x, y, z in M.TIE], tieStage=stage("tie"),
        labels=[dict(t=t, p=[X(x), Y(y), Z(z)], stage=stage(who)) for t, x, y, z, who in LABELS],
        tour=tour,
        T=M.T, C=M.C,
        colors=dict(eq=M.EQ_FILL, edge=M.EQ_STROKE, box=M.BOX_FILL, boxEdge=M.BOX_STROKE, bld="#F1ECE2",
                    cond="#D9D2C6", mheTop="#EAC9A4", mheBot="#B3CBE6"),
        extent=dict(x=[0, 164], y=[0, 68], z=[-16, 0]),
    )


if __name__ == "__main__":
    OUT.write_text(json.dumps(export(), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.name}")
