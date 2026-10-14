#!/usr/bin/env python3
"""Shared 3D model of the ASU and the renderers for every view.

Coordinates (all in px, 10 px = 1 m):
  x  : along the plant, left → right, same as the v1 elevation
  y  : elevation screen-y (down); ground at y = 820, so height h = 820 - y
  z  : depth, 0 = front of the plant (the side the elevation is viewed from), + = north

Views:  elevation (x, y)   plan (x, z)   section A–A (z, y) at x = 1068   isometric (x, y, z)
"""
import math

W1, H1 = 1640, 900          # elevation canvas (v1)
G = 820                     # ground

BG = "#F7F3EB"
GROUND = "#CFC7B8"
TXT = "#3E3A35"
MUTED = "#7C766E"
FAINT = "#B9B1A4"
EQ_FILL = "#E9E3D8"
EQ_SIDE = "#D9D2C5"          # shaded side face (iso)
EQ_FRONT = "#E1DACE"
EQ_STROKE = "#8A8275"
BOX_FILL = "#EDF0F3"
BOX_STROKE = "#6E7C8C"

T = {"hot": "#C4573A", "amb": "#D08F4B", "chill": "#C4AC5E",
     "cool": "#86AFC9", "cryo": "#4F86BE", "deep": "#2F5E9E"}
C = {"n2": "#C9C2B6", "o2": "#79B7A3", "ar": "#AE93CB"}
CD = {"n2": "#8C8477", "o2": "#2E7D69", "ar": "#6B4B98"}
MIX = "#B9C7C0"
RICH = "#9FC9BA"


# =============================================================================
# 3D MODEL
# =============================================================================
# boxes: (name, x0, x1, z0, z1, ytop, ybot, style)   style: eq | bld | cold | mhe | cond
BOXES = [
    ("Intake filter house",     40, 100,  20,  80, 740, 820, "eq"),
    ("Compressor building",    120, 340,   0, 120, 700, 820, "bld"),
    ("Motor",                  130, 175,  35,  75, 772, 812, "eq"),
    ("Compressor casing",      205, 273,  40,  70, 775, 815, "eq"),
    ("Booster building",       686, 800,   0, 100, 700, 820, "bld"),
    ("Booster air compressor", 696, 744,  30,  70, 762, 820, "eq"),
    ("N2 recycle compressor",  754, 794,  30,  70, 762, 820, "eq"),
    ("Regen gas heater",       519, 537,  50,  60, 560, 586, "eq"),
    ("Main heat exchanger",    845, 930,  40,  80, 650, 780, "mhe"),
    ("Air expander",           965, 1000, 45,  75, 700, 730, "eq"),
    ("N2 expander",            965, 1000, 45,  75, 750, 780, "eq"),
    ("Condenser-reboiler",    1045, 1091, 37,  83, 632, 656, "cond"),
    ("Subcooler",             1032, 1040, 55,  65, 450, 480, "eq"),
    ("Argon condenser",       1155, 1180, 47,  73, 456, 484, "cond"),
    ("Exchanger cold box",     830, 950,  20, 100, 620, 820, "cold"),
    ("Column cold box",       1030, 1124, 20, 100, 220, 820, "cold"),
    ("Argon cold box",        1140, 1220, 30,  90, 370, 820, "cold"),
]
# cylinders: (name, cx, cz, r, ytop, ybot, bands)  bands: list of (ytop, ybot, colour) or None
CYLS = [
    ("Intercooler 1",   291, 55,  6, 762, 820, None),
    ("Intercooler 2",   319, 55,  6, 762, 820, None),
    ("Aftercooler",     385, 55, 15, 660, 820, None),
    ("Vent stack",      480, 55,  3, 670, 805, None),
    ("Adsorber A",      528, 55, 20, 740, 800, None),
    ("Adsorber B",      588, 55, 20, 740, 800, None),
    ("LOX pump",       1020, 60,  8, 789, 805, None),
    ("LP column",      1068, 60, 23, 270, 632,
     [(270, 440, C["n2"]), (440, 500, MIX), (500, 545, C["ar"]), (545, 632, C["o2"])]),
    ("HP column",      1068, 60, 20, 656, 800,
     [(656, 700, C["n2"]), (700, 760, MIX), (760, 800, RICH)]),
    ("Crude argon column", 1167.5, 60, 12.5, 484, 790,
     [(484, 640, C["ar"]), (640, 790, C["o2"])]),
    ("Pure argon column",  1198, 60, 6, 700, 790, [(700, 790, C["ar"])]),
    ("LAR tank",       1330, 60, 30, 700, 820, None),
    ("LOX tank",       1440, 60, 50, 620, 820, None),
    ("LIN tank",       1565, 60, 45, 640, 820, None),
]

# pipes: dict(pts=[(x,y,z),...] in flow order, t=temperature key, k=gas|liq|hp,
#             hops=[(xc, y, r)], end=bool arrowhead, views="EPI" subset, sw=width)
def P(pts, t, k="gas", hops=(), end=False, views="EPI", sw=2.4, name=""):
    return dict(pts=pts, t=t, k=k, hops=list(hops), end=end, views=views, sw=sw, name=name)


PIPES = [
    # ---- warm end --------------------------------------------------------
    P([(100, 745, 50), (210, 745, 50), (210, 773, 50)], "amb", name="intake"),
    P([(319, 762, 55), (319, 725, 55), (355, 725, 55), (355, 800, 55), (370, 800, 55)], "hot", name="MAC discharge"),
    P([(385, 660, 55), (385, 645, 55), (410, 645, 55), (410, 814, 55), (588, 814, 55), (588, 800, 55)], "chill", name="to adsorber"),
    P([(598, 740, 55), (598, 480, 55), (598, 480, 115), (896, 480, 115), (896, 480, 60), (896, 650, 60)], "chill", name="main air"),
    P([(705, 480, 115), (705, 480, 50), (705, 762, 50)], "chill", views="EI", name="booster suction"),
    P([(735, 762, 50), (735, 500, 50), (735, 500, 120), (879, 500, 120), (879, 500, 60), (879, 650, 60)], "amb", name="booster air"),
    P([(762, 762, 50), (762, 520, 50), (762, 520, 125), (862, 520, 125), (862, 520, 60), (862, 650, 60)], "amb", name="recycle supply"),
    P([(845, 650, 60), (845, 540, 60), (845, 540, 130), (786, 540, 130), (786, 540, 50), (786, 762, 50)], "amb", name="recycle return"),
    P([(915, 650, 60), (915, 440, 60), (915, 440, 135), (528, 440, 135), (528, 440, 55), (528, 560, 55)], "amb", name="waste N2"),
    P([(528, 586, 55), (528, 740, 55)], "hot", name="regen gas"),
    P([(508, 795, 55), (480, 795, 55), (480, 672, 55)], "amb", end=True, name="vent"),
    P([(925, 650, 60), (925, 150, 60), (925, 150, 140), (1628, 150, 140)], "amb", end=True, name="pipeline"),
    # ---- exchanger box ↔ gap ---------------------------------------------
    P([(928, 780, 60), (928, 812, 60), (1068, 812, 60), (1068, 800, 60)], "cryo", views="EI", name="air to HP"),
    P([(930, 715, 60), (965, 715, 60)], "cool", views="EI", name="air to expander"),
    P([(1000, 715, 60), (1015, 715, 60), (1015, 620, 60), (1045, 620, 60)], "cryo", hops=[(1036, 620, 6)], views="EI", name="expander to LP"),
    P([(930, 765, 60), (965, 765, 60)], "cool", views="EI", name="N2 to expander"),
    P([(1000, 765, 60), (1010, 765, 60), (1010, 738, 60), (930, 738, 60)], "cryo", views="EI", name="N2 from expander"),
    P([(1045, 650, 60), (1020, 650, 60), (1020, 789, 60)], "cryo", "liq", views="EI", name="LOX suction"),
    P([(1012, 797, 60), (930, 797, 60)], "cryo", "hp", views="EI", name="pumped LOX"),
    # ---- column box ------------------------------------------------------
    P([(1045, 632, 60), (1036, 632, 60), (1036, 275, 60), (1045, 275, 60)], "deep", "liq", views="EI", name="reflux"),
    P([(1088, 792, 60), (1115, 792, 60), (1115, 470, 60), (1091, 470, 60)], "cryo", "liq", hops=[(1107, 470, 6)], views="EI", name="rich liquid"),
    P([(1091, 520, 60), (1148, 520, 60), (1148, 785, 60), (1155, 785, 60)], "cryo", hops=[(1111, 520, 10)], views="EI", name="argon draw"),
    P([(1073, 270, 60), (1073, 235, 60), (975, 235, 60), (975, 650, 60), (930, 650, 60)], "deep", views="EI", name="GAN"),
    P([(1058, 270, 60), (1058, 250, 60), (960, 250, 60), (960, 635, 60), (930, 635, 60)], "deep", views="EI", name="waste N2 cold"),
    P([(1091, 282, 60), (1099, 282, 60), (1099, 170, 60), (1099, 170, 110), (1565, 170, 110), (1565, 170, 60), (1565, 640, 60)], "deep", "liq", name="LIN"),
    P([(1091, 650, 60), (1107, 650, 60), (1107, 190, 60), (1107, 190, 105), (1440, 190, 105), (1440, 190, 60), (1440, 620, 60)], "cryo", "liq", name="LOX"),
    P([(1030, 561, 60), (1004, 561, 60)], "cryo", "gas", end=True, views="EI", sw=1.6, name="Ne/He"),
    P([(1030, 589, 60), (1004, 589, 60)], "cryo", "liq", end=True, views="EI", sw=1.6, name="Kr/Xe"),
    # ---- argon box -------------------------------------------------------
    P([(1180, 462, 60), (1212, 462, 60), (1212, 745, 60), (1204, 745, 60)], "cryo", views="EI", name="crude to pure"),
    P([(1198, 700, 60), (1198, 688, 60)], "deep", "gas", end=True, views="EI", sw=1.6, name="pure Ar N2 vent"),
    P([(1198, 790, 60), (1198, 805, 60), (1300, 805, 60)], "cryo", "liq", name="LAR"),
]
TIE = [(1115, 478, 60), (1155, 478, 60)]   # rich liquid cools the argon condenser (heat exchange, not flow)

# stage at which each named item is introduced in the stepped tour (v5)
STAGE = {
    "Intake filter house": 1, "Compressor building": 1, "Motor": 1, "Compressor casing": 1,
    "Intercooler 1": 1, "Intercooler 2": 1, "intake": 1, "MAC discharge": 1,
    "Aftercooler": 2, "to adsorber": 2,
    "Adsorber A": 3, "Adsorber B": 3, "Vent stack": 3, "Regen gas heater": 3, "waste N2": 3, "regen gas": 3,
    "vent": 3, "main air": 3,
    "Booster building": 4, "Booster air compressor": 4, "N2 recycle compressor": 4, "booster suction": 4,
    "booster air": 4, "recycle supply": 4, "recycle return": 4,
    "Main heat exchanger": 5, "Exchanger cold box": 5,
    "Air expander": 6, "N2 expander": 6, "air to expander": 6, "expander to LP": 6, "N2 to expander": 6,
    "N2 from expander": 6,
    "Column cold box": 7, "HP column": 7, "air to HP": 7, "rich liquid": 7,
    "Condenser-reboiler": 8,
    "LP column": 9, "Subcooler": 9, "reflux": 9, "GAN": 9, "waste N2 cold": 9, "Ne/He": 9, "Kr/Xe": 9,
    "Argon cold box": 10, "Argon condenser": 10, "Crude argon column": 10, "Pure argon column": 10,
    "argon draw": 10, "crude to pure": 10, "pure Ar N2 vent": 10, "tie": 10,
    "LOX pump": 11, "LOX suction": 11, "pumped LOX": 11, "pipeline": 11, "LIN": 11, "LOX": 11, "LAR": 11,
    "LAR tank": 11, "LOX tank": 11, "LIN tank": 11,
}


def tag_for(name):
    return f' data-stage="{STAGE[name]}"' if name in STAGE else ""

PANEL_ROWS = [
    ("Air, 20 °C", 78, 21, 1), ("Rich liquid −173 °C", 60, 38, 2), ("HP top N₂ −178 °C", 100, 0, 0),
    ("Ar side-draw −183 °C", 1, 89, 10), ("LOX sump −180 °C", 0, 99, 1), ("LP top N₂ −193 °C", 100, 0, 0),
    ("Waste N₂ −191 °C", 97, 3, 0), ("Crude Ar −185 °C", 1, 3, 96), ("Pure Ar −186 °C", 0, 0, 100),
]


# =============================================================================
# CANVAS HELPERS
# =============================================================================
class Canvas:
    def __init__(self):
        self.out = []
        self.tag = ""          # e.g. ' data-stage="3"' — appended to every element while set

    def add(self, s):
        self.out.append(s)

    def rect(self, x, y, w, h, fill=EQ_FILL, stroke=EQ_STROKE, rx=2, sw=1, dash=None, fo=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        o = f' fill-opacity="{fo}"' if fo is not None else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{d}{o}{self.tag}/>')

    def text(self, x, y, s, size=12, anchor="start", fill=TXT, weight=400, id=None):
        i = f' id="{id}"' if id else ""
        self.add(f'<text{i} x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" fill="{fill}" '
                 f'font-weight="{weight}"{self.tag}>{s}</text>')

    def line(self, x1, y1, x2, y2, stroke=EQ_STROKE, sw=1, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"{d}{self.tag}/>')

    def stream(self, d, temp, kind="gas", sw=2.4, end=False):
        dash = {"gas": "7 7", "liq": "4 10", "hp": "5 9"}[kind]
        m = f' marker-end="url(#m-{temp})"' if end else ""
        self.add(f'<path d="{d}" fill="none" stroke="{T[temp]}" stroke-width="{sw}" stroke-opacity="0.28" '
                 f'stroke-linecap="round" stroke-linejoin="round"{self.tag}/>')
        self.add(f'<path d="{d}" fill="none" stroke="{T[temp]}" stroke-width="{sw}" stroke-linecap="round" '
                 f'stroke-linejoin="round" stroke-dasharray="{dash}" class="{kind}"{m}{self.tag}/>')

    def bar(self, x, y, n2, o2, ar, w=48, h=7):
        tot = n2 + o2 + ar
        xx = x
        for key, v in (("n2", n2), ("o2", o2), ("ar", ar)):
            if v <= 0:
                continue
            ww = w * v / tot
            self.add(f'<rect x="{xx:.1f}" y="{y}" width="{ww:.1f}" height="{h}" fill="{C[key]}"/>')
            xx += ww
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="{EQ_STROKE}" stroke-width="0.5"/>')

    def svg(self):
        return "\n".join(self.out)


def defs_and_style(c):
    c.add("<defs>")
    for k, col in T.items():
        c.add(f'<marker id="m-{k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
              f'<path d="M1 1 L9 5 L1 9 Z" fill="{col}"/></marker>')
    c.add('<linearGradient id="mhe" x1="0" y1="0" x2="0" y2="1">'
          '<stop offset="0" stop-color="#EAC9A4"/><stop offset="1" stop-color="#B3CBE6"/></linearGradient>')
    c.add('<clipPath id="clipLP"><rect x="1045" y="270" width="46" height="362"/></clipPath>')
    c.add('<clipPath id="clipHP"><rect x="1048" y="656" width="40" height="144"/></clipPath>')
    c.add('<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
          '<line x1="0" y1="0" x2="0" y2="6" stroke="#8A8275" stroke-width="0.6"/></pattern>')
    c.add("</defs>")
    c.add("<style>"
          "@keyframes flow{to{stroke-dashoffset:-14}}"
          ".gas{animation:flow 1s linear infinite}"
          ".liq{animation:flow 2.6s linear infinite}"
          ".hp{animation:flow 1.7s linear infinite}"
          "@media (prefers-reduced-motion:reduce){.gas,.liq,.hp{animation:none}}"
          "</style>")


def temp_legend(c, x, y):
    c.text(x, y, "Stream temperature", 11, weight=500)
    lx = x
    for k, lab in (("hot", "+90 °C"), ("amb", "+20 °C"), ("chill", "+10 °C"),
                   ("cool", "−100 °C"), ("cryo", "−175 °C"), ("deep", "−193 °C")):
        c.add(f'<rect x="{lx}" y="{y + 8}" width="16" height="8" rx="2" fill="{T[k]}"/>')
        c.text(lx + 20, y + 16, lab, 10, fill=MUTED)
        lx += 78


def comp_legend(c, x, y):
    lx = x
    for key, lab in (("n2", "N₂"), ("o2", "O₂"), ("ar", "Ar")):
        c.add(f'<rect x="{lx}" y="{y}" width="10" height="8" fill="{C[key]}"/>')
        c.text(lx + 13, y + 7, lab, 10, fill=CD[key])
        lx += 38


# =============================================================================
# PATH PROJECTIONS
# =============================================================================
def dedupe(pts2):
    res = []
    for p in pts2:
        if not res or (abs(p[0] - res[-1][0]) > 1e-6 or abs(p[1] - res[-1][1]) > 1e-6):
            res.append(p)
    return res


def elev_path(pipe):
    """Elevation (x, y) with drafting hops inserted on horizontal runs."""
    pts = dedupe([(x, y) for x, y, z in pipe["pts"]])
    hops = pipe["hops"]
    d = f"M{pts[0][0]} {pts[0][1]}"
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        if abs(y1 - y2) < 1e-6:
            here = [h for h in hops if abs(h[1] - y1) < 1e-6 and min(x1, x2) < h[0] < max(x1, x2)]
            right = x2 > x1
            for xc, _, r in sorted(here, reverse=not right):
                if right:
                    d += f" L{xc - r} {y1} A{r} {r} 0 0 1 {xc + r} {y1}"
                else:
                    d += f" L{xc + r} {y1} A{r} {r} 0 0 0 {xc - r} {y1}"
        d += f" L{x2} {y2}"
    return d


def plan_xy(x, z, y0):
    return x, y0 - z


def plan_path(pipe, y0):
    pts = dedupe([plan_xy(x, z, y0) for x, y, z in pipe["pts"]])
    return "M" + " L".join(f"{x} {y}" for x, y in pts)


ISO_C, ISO_S = math.cos(math.radians(30)), math.sin(math.radians(30))


def iso(x, y, z, ox=0, oy=0):
    """Isometric: viewer at the front-right (+x, −z), same side as the elevation."""
    h = G - y
    u = (x + z) * ISO_C + ox
    v = (x - z) * ISO_S - h + oy
    return u, v


def iso_path(pipe, ox, oy):
    pts = dedupe([iso(x, y, z, ox, oy) for x, y, z in pipe["pts"]])
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)


# =============================================================================
# ELEVATION (v1 drawing, unchanged coordinates)
# =============================================================================
def draw_elevation(c, notes=True):
    c.line(20, G, W1 - 20, G, GROUND, 2)
    if notes:
        c.text(40, 52, "Cryogenic air separation unit — scaled elevation", 17, weight=500)
        c.text(40, 70, "1 px = 0.1 m · typical 2 000–3 000 t/d oxygen plant · Linde double column, internal compression, "
               "N₂ liquefier, argon recovery, rare-gas draws", 11, fill=MUTED)
        temp_legend(c, 40, 96)
        ny = 134
        for n in [
            "Flow: dashes move with each stream — gas fast, liquid slow. Grey dashed line = heat exchange, not flow.",
            "Cold boxes are dashed outlines filled with perlite. Column box: high-pressure column (5.5 bar) below,",
            "condenser–reboiler, low-pressure column (1.4 bar) above. Argon box: crude argon column (~200 stages) left, pure argon right.",
            "Adsorbers: 13X zeolite + alumina; one bed adsorbs while the other regenerates with heated waste N₂.",
            "Lanes into the exchanger box, top to bottom: main air 5.5 bar · booster air 40–60 bar · N₂ recycle supply · N₂ recycle return.",
            "Pumped LOX leaves at 30–80 bar and vaporises against booster air (internal compression).",
            "Rare-gas draws are connectors: Ne/He from the condenser, Kr/Xe from the LOX sump. Figure at bottom left = 1.8 m.",
        ]:
            c.text(40, ny, n, 10.5, fill=MUTED)
            ny += 15
    # scale bar & person
    c.line(40, 852, 140, 852, TXT, 1)
    for sx in (40, 90, 140):
        c.line(sx, 848, sx, 856, TXT, 1)
    c.text(90, 868, "10 m", 10, "middle", MUTED)
    c.add(f'<g stroke="{TXT}" stroke-width="1.2" fill="none" stroke-linecap="round">'
          f'<circle cx="112" cy="804" r="2.6"/><path d="M112 807 V814 M112 814 L108.5 820 M112 814 L115.5 820 '
          f'M112 809 L108.5 813 M112 809 L115.5 813"/></g>')

    # ---- warm-end equipment ----
    c.rect(40, 740, 60, 80, rx=3)
    for yy in range(748, 816, 10):
        c.line(46, yy, 94, yy, EQ_STROKE, 0.6)
    c.text(70, 716, "Intake", 12, "middle")
    c.text(70, 730, "filter house", 12, "middle")

    c.rect(120, 700, 220, 120, fill="#F1ECE2", stroke=EQ_STROKE, rx=2, dash="5 4")
    c.text(230, 676, "Main air compressor", 12, "middle")
    c.text(230, 690, "5.5 bar · ~20 MW · intercooled centrifugal", 10.5, "middle", MUTED)
    c.rect(130, 772, 45, 40, rx=4)
    c.rect(180, 780, 20, 30, rx=2)
    for cx in (218, 241, 264):
        c.add(f'<circle cx="{cx}" cy="795" r="9.5" fill="{EQ_FILL}" stroke="{EQ_STROKE}"/>')
    c.add(f'<g stroke="{EQ_STROKE}" stroke-width="1.2" stroke-linecap="round">'
          f'<animateTransform attributeName="transform" type="rotate" from="0 241 795" to="360 241 795" dur="1.4s" repeatCount="indefinite"/>'
          f'<path d="M241 788 V802 M234 795 H248"/></g>')
    c.rect(285, 762, 12, 58, rx=5)
    c.rect(313, 762, 12, 58, rx=5)
    c.line(273, 795, 285, 795, EQ_STROKE, 1)
    c.line(297, 795, 313, 795, EQ_STROKE, 1)
    c.text(300, 713, "5.5 bar · 90 °C", 10.5, "middle", MUTED)
    c.text(150, 735, "20 °C · 1 bar", 10.5, "start", MUTED)

    c.rect(370, 660, 30, 160, rx=8)
    for yy in range(690, 800, 22):
        c.line(374, yy, 396, yy, EQ_STROKE, 0.6)
    c.text(360, 632, "Direct-contact aftercooler · 16 m", 12, "end")
    c.text(430, 636, "5.5 bar · 10 °C", 10.5, "start", MUTED)

    c.line(480, 805, 480, 670, EQ_STROKE, 3)
    c.add(f'<path d="M474 672 L480 660 L486 672 Z" fill="{EQ_FILL}" stroke="{EQ_STROKE}"/>')
    c.text(480, 652, "Vent", 10.5, "middle", MUTED)

    for x0, tag in ((508, "regen."), (568, "adsorb.")):
        c.line(x0 + 4, 800, x0 + 4, 820, EQ_STROKE, 1.5)
        c.line(x0 + 36, 800, x0 + 36, 820, EQ_STROKE, 1.5)
        c.rect(x0, 740, 40, 60, rx=7)
        c.text(x0 + 20, 774, tag, 9.5, "middle", MUTED)
    c.text(612, 728, "Adsorbers", 12)
    c.text(612, 743, "2 × Ø4 m", 10.5, fill=MUTED)
    c.rect(519, 560, 18, 26, rx=3)
    c.line(522, 566, 534, 580, EQ_STROKE, 0.8)
    c.line(534, 566, 522, 580, EQ_STROKE, 0.8)
    c.text(514, 574, "Regen gas heater", 10.5, "end", MUTED)
    c.text(720, 432, "waste N₂ (regeneration + vent)", 10.5, "middle", MUTED)

    c.rect(686, 700, 114, 120, fill="#F1ECE2", stroke=EQ_STROKE, rx=2, dash="5 4")
    c.rect(696, 762, 48, 58, rx=4)
    c.rect(754, 762, 40, 58, rx=4)
    c.text(720, 842, "Booster air compressor", 10.5, "middle", MUTED)
    c.text(795, 858, "N₂ recycle compressor", 10.5, "middle", MUTED)

    # ---- cold boxes ----
    c.rect(830, 620, 120, 200, fill=BOX_FILL, stroke=BOX_STROKE, rx=3, dash="6 4", fo=0.7)
    c.add(f'<rect x="845" y="650" width="85" height="130" rx="3" fill="url(#mhe)" stroke="{EQ_STROKE}"/>')
    for yy in range(662, 770, 12):
        c.line(850, yy, 925, yy, "#8A8275", 0.4)
    c.text(887, 708, "Main heat", 11, "middle")
    c.text(887, 723, "exchanger", 11, "middle")
    c.text(826, 466, "Exchanger cold box · 20 m", 12, "end")

    for y0 in (700, 750):
        c.rect(965, y0, 35, 30, rx=4)
        c.add(f'<circle cx="982" cy="{y0 + 15}" r="8" fill="{BG}" stroke="{EQ_STROKE}"/>')
        c.add(f'<g stroke="{EQ_STROKE}" stroke-width="1.1" stroke-linecap="round">'
              f'<animateTransform attributeName="transform" type="rotate" from="0 982 {y0 + 15}" to="360 982 {y0 + 15}" '
              f'dur="0.5s" repeatCount="indefinite"/>'
              f'<path d="M982 {y0 + 8} V{y0 + 22} M976 {y0 + 11.5} L988 {y0 + 18.5} M976 {y0 + 18.5} L988 {y0 + 11.5}"/></g>')
    c.add(f'<circle cx="1020" cy="797" r="8" fill="{EQ_FILL}" stroke="{EQ_STROKE}"/>')
    c.add(f'<path d="M1016 792 L1026 797 L1016 802 Z" fill="{EQ_STROKE}"/>')
    c.text(982, 842, "Expanders", 10.5, "middle", MUTED)
    c.text(1020, 858, "LOX pump", 10.5, "middle", MUTED)
    c.text(1090, 842, "→ HP column · −173 °C", 10.5, fill=MUTED)

    c.rect(1030, 220, 94, 600, fill=BOX_FILL, stroke=BOX_STROKE, rx=3, dash="6 4", fo=0.7)
    c.text(1091, 210, "Column cold box · 60 m", 12, "end")
    for y0, y1, col in ((270, 440, C["n2"]), (440, 500, MIX), (500, 545, C["ar"]), (545, 632, C["o2"])):
        c.add(f'<rect x="1045" y="{y0}" width="46" height="{y1 - y0}" fill="{col}" fill-opacity="0.55"/>')
    c.rect(1045, 270, 46, 362, fill="none", stroke=EQ_STROKE, rx=6)
    c.rect(1045, 632, 46, 24, fill="#D9D2C6", stroke=EQ_STROKE, rx=2)
    for yy in (637, 642, 647, 652):
        c.line(1049, yy, 1087, yy, EQ_STROKE, 0.5)
    for y0, y1, col in ((656, 700, C["n2"]), (700, 760, MIX), (760, 800, RICH)):
        c.add(f'<rect x="1048" y="{y0}" width="40" height="{y1 - y0}" fill="{col}" fill-opacity="0.55"/>')
    c.rect(1048, 656, 40, 144, fill="none", stroke=EQ_STROKE, rx=6)
    c.line(1052, 800, 1052, 820, EQ_STROKE, 1.5)
    c.line(1084, 800, 1084, 820, EQ_STROKE, 1.5)
    c.text(1068, 292, "LP", 10, "middle", MUTED)
    c.text(1068, 682, "HP", 10, "middle", MUTED)
    c.rect(1032, 450, 8, 30, rx=2)
    c.text(1022, 462, "Sub-", 10, "end", MUTED)
    c.text(1022, 475, "cooler", 10, "end", MUTED)

    c.rect(1140, 370, 80, 450, fill=BOX_FILL, stroke=BOX_STROKE, rx=3, dash="6 4", fo=0.7)
    c.text(1132, 362, "Argon cold box · 45 m", 12)
    for y0, y1, col in ((484, 640, C["ar"]), (640, 790, C["o2"])):
        c.add(f'<rect x="1155" y="{y0}" width="25" height="{y1 - y0}" fill="{col}" fill-opacity="0.55"/>')
    c.rect(1155, 456, 25, 334, fill="none", stroke=EQ_STROKE, rx=5)
    c.rect(1155, 456, 25, 28, fill="#D9D2C6", stroke=EQ_STROKE, rx=2)
    for yy in (462, 468, 474, 480):
        c.line(1159, yy, 1176, yy, EQ_STROKE, 0.5)
    c.line(1159, 790, 1159, 820, EQ_STROKE, 1.5)
    c.line(1176, 790, 1176, 820, EQ_STROKE, 1.5)
    c.add(f'<rect x="1192" y="700" width="12" height="90" fill="{C["ar"]}" fill-opacity="0.7" stroke="{EQ_STROKE}" rx="3"/>')
    c.line(1194, 790, 1194, 820, EQ_STROKE, 1.2)
    c.line(1202, 790, 1202, 820, EQ_STROKE, 1.2)
    c.text(1167, 620, "crude", 9, "middle", MUTED)

    c.rect(1300, 700, 60, 120, rx=8)
    c.rect(1390, 620, 100, 200, rx=10)
    c.rect(1520, 640, 90, 180, rx=9)
    c.text(1330, 752, "LAR", 13, "middle", weight=500)
    c.text(1330, 767, "Ø6 × 12 m", 10, "middle", MUTED)
    c.text(1440, 704, "LOX", 13, "middle", weight=500)
    c.text(1440, 719, "Ø10 × 20 m · 1 500 m³", 10, "middle", MUTED)
    c.text(1565, 724, "LIN", 13, "middle", weight=500)
    c.text(1565, 739, "Ø9 × 18 m", 10, "middle", MUTED)

    # ---- streams ----
    for p in PIPES:
        if "E" in p["views"]:
            c.stream(elev_path(p), p["t"], p["k"], p["sw"], p["end"])
    c.line(TIE[0][0], TIE[0][1], TIE[1][0], TIE[1][1], "#8A8275", 1.2, "3 3")
    c.text(1022, 553, "Ne/He", 10, "end", MUTED)
    c.text(1022, 581, "Kr/Xe", 10, "end", MUTED)
    c.text(1600, 140, "GOX / GAN to pipeline · 20 °C", 12, "end")
    c.text(1558, 300, "LIN · −193 °C", 11, "end", MUTED)
    c.text(1433, 300, "LOX · −180 °C", 11, "end", MUTED)
    c.text(1254, 796, "LAR · −186 °C", 11, "middle", MUTED)

    # ---- molecules ----
    molecules(c, "clipLP", 1052, 8, 622, 284, 6, 5, "n2")
    molecules(c, "clipLP", 1056, 8, 284, 622, 7, 4, "o2", close=False)
    c.add(f'<circle cx="1069" cy="560" r="2.4" fill="{CD["ar"]}">'
          f'<animate attributeName="cy" values="560;500;560" dur="9s" repeatCount="indefinite"/></circle></g>')
    molecules(c, "clipHP", 1056, 12, 796, 670, 4, 3, "n2")
    molecules(c, "clipHP", 1062, 12, 670, 796, 5, 2, "o2", close=True)

    # ---- composition panel ----
    px, py = 1130, 204
    c.text(px, py, "Stream composition", 11, weight=500)
    comp_legend(c, px, py + 6)
    ry = py + 30
    for lab, n2, o2, ar in PANEL_ROWS:
        c.text(px, ry + 6, lab, 9.5, fill=MUTED)
        c.bar(px + 112, ry, n2, o2, ar, w=48, h=7)
        ry += 12.5


def molecules(c, clip, x0, dx, y_from, y_to, dur, n, key, close=None):
    """n dots at x0, x0+dx, ... moving y_from → y_to, staggered.
    key == "n2" opens the clip group; close=True closes it."""
    if key == "n2":
        c.add(f'<g clip-path="url(#{clip})">')
    for i in range(n):
        c.add(f'<circle cx="{x0 + dx * i}" cy="{y_from}" r="2.4" fill="{CD[key]}">'
              f'<animate attributeName="cy" from="{y_from}" to="{y_to}" dur="{dur}s" begin="{-dur / n * i:.2f}s" '
              f'repeatCount="indefinite"/></circle>')
    if close is True:
        c.add("</g>")


# =============================================================================
# PLAN VIEW
# =============================================================================
def draw_plan(c, y0):
    """y0 = plan y of z = 0. z increases upward (north up)."""
    def py(z):
        return y0 - z
    # title, north arrow
    c.text(40, y0 - 176, "Plan view — same x as the elevation above", 14, weight=500)
    c.text(40, y0 - 160, "north is up · the elevation is viewed from the south (bottom of this plan) · dotted lines project box edges "
           "and tank centres between views", 10.5, fill=MUTED)
    c.add(f'<g stroke="{TXT}" stroke-width="1" fill="none"><path d="M24 {y0 - 20} V{y0 - 140}"/>'
          f'<path d="M18 {y0 - 128} L24 {y0 - 142} L30 {y0 - 128}"/></g>')
    c.text(24, y0 - 4, "N", 11, "middle", weight=500)
    c.text(40, y0 + 14, "front (south)", 9.5, fill=MUTED)

    # footprints
    for name, x0, x1, z0, z1, yt, yb, style in BOXES:
        if style == "bld":
            c.rect(x0, py(z1), x1 - x0, z1 - z0, fill="#F1ECE2", stroke=EQ_STROKE, dash="5 4")
        elif style == "cold":
            c.rect(x0, py(z1), x1 - x0, z1 - z0, fill=BOX_FILL, stroke=BOX_STROKE, rx=3, dash="6 4", fo=0.7)
        elif style == "mhe":
            c.rect(x0, py(z1), x1 - x0, z1 - z0, fill="url(#mhe)", stroke=EQ_STROKE)
        elif style == "cond":
            continue
        else:
            c.rect(x0, py(z1), x1 - x0, z1 - z0, rx=2)
    for name, cx, cz, r, yt, yb, bands in CYLS:
        top = bands[0][2] if bands else EQ_FILL
        c.add(f'<circle cx="{cx}" cy="{py(cz)}" r="{r}" fill="{top}" fill-opacity="0.85" stroke="{EQ_STROKE}"/>')
    # plan pipes
    for p in PIPES:
        if "P" in p["views"]:
            c.stream(plan_path(p, y0), p["t"], p["k"], p["sw"] * 0.8, p["end"])
    # section cut line A-A through x = 1068
    xc = 1068
    c.add(f'<path d="M{xc} {py(-12)} V{py(132)}" stroke="{TXT}" stroke-width="1.2" stroke-dasharray="10 3 2 3"/>')
    for yy in (py(-12), py(132)):
        c.add(f'<path d="M{xc} {yy} L{xc - 14} {yy}" stroke="{TXT}" stroke-width="1.2"/>'
              f'<path d="M{xc - 14} {yy} l6 -4 v8 z" fill="{TXT}"/>')
    c.text(xc + 6, py(-12) + 4, "A", 11, weight=500)
    c.text(xc + 6, py(132) + 4, "A", 11, weight=500)
    # labels
    labels = [
        (70, py(50), "Filter", "middle"), (230, py(-12), "Compressor building", "middle"),
        (385, py(-12), "DCAC", "middle"), (558, py(-12), "Adsorbers", "middle"), (743, py(-12), "Booster / recycle", "middle"),
        (890, py(-12), "Exchanger box", "middle"), (1044, py(-12), "Column box", "end"), (1180, py(-12), "Argon box", "middle"),
        (1330, py(-12), "LAR", "middle"), (1440, py(-12), "LOX", "middle"), (1565, py(-12), "LIN", "middle"),
        (520, py(128), "pipe rack — overhead lanes", "end"), (1400, py(150), "GOX / GAN pipeline →", "start"),
    ]
    for x, y, s, a in labels:
        c.text(x, y, s, 10.5, a, MUTED)


# =============================================================================
# SECTION A–A  (through the column box at x = 1068, viewed from the east: z increases to the right)
# =============================================================================
def draw_section(c, ox):
    """ox = x offset of the group; horizontal axis sx = ox + 30 + z; vertical = elevation y (unchanged)."""
    def sx(z):
        return ox + 30 + z
    c.text(ox + 30, 100, "Section A–A", 14, weight=500)
    c.text(ox + 30, 116, "through the column cold box at x = 1068,", 10.5, fill=MUTED)
    c.text(ox + 30, 130, "looking west · same y as the elevation", 10.5, fill=MUTED)
    c.line(sx(-10), G, sx(150), G, GROUND, 2)
    # column box cut with perlite band
    c.rect(sx(20), 220, 80, 600, fill=BOX_FILL, stroke=BOX_STROKE, rx=3, fo=0.7)
    c.add(f'<rect x="{sx(20)}" y="220" width="80" height="600" rx="3" fill="url(#hatch)" fill-opacity="0.6" stroke="none"/>')
    c.rect(sx(26), 226, 68, 588, fill=BOX_FILL, stroke="none")
    # LP column cut: shell, packed beds, distributors, sump
    c.rect(sx(37), 270, 46, 362, fill="#F4F1EA", stroke=EQ_STROKE, rx=4)
    beds = [(282, 330), (340, 388), (398, 446), (456, 500), (508, 545)]
    for yt, yb in beds:
        c.add(f'<rect x="{sx(39)}" y="{yt}" width="42" height="{yb - yt}" fill="url(#hatch)" stroke="{EQ_STROKE}" stroke-width="0.5"/>')
        c.line(sx(39), yt - 4, sx(81), yt - 4, EQ_STROKE, 0.7)          # liquid distributor
    c.add(f'<rect x="{sx(39)}" y="600" width="42" height="30" fill="{C["o2"]}" fill-opacity="0.6"/>')   # LOX sump
    c.line(sx(39), 600, sx(81), 600, CD["o2"], 0.8)
    c.rect(sx(37), 632, 46, 24, fill="#D9D2C6", stroke=EQ_STROKE, rx=2)
    for zz in range(41, 80, 6):
        c.line(sx(zz), 634, sx(zz), 654, EQ_STROKE, 0.6)               # reboiler plates (seen end-on)
    c.rect(sx(40), 656, 40, 144, fill="#F4F1EA", stroke=EQ_STROKE, rx=4)
    for yt, yb in ((664, 700), (708, 748), (756, 790)):
        c.add(f'<rect x="{sx(42)}" y="{yt}" width="36" height="{yb - yt}" fill="url(#hatch)" stroke="{EQ_STROKE}" stroke-width="0.5"/>')
        c.line(sx(42), yt - 4, sx(78), yt - 4, EQ_STROKE, 0.7)
    c.line(sx(44), 800, sx(44), 820, EQ_STROKE, 1.5)
    c.line(sx(76), 800, sx(76), 820, EQ_STROKE, 1.5)
    # stubs in the plane: air in at HP bottom, reflux/rich-liquid nozzles seen end-on
    c.stream(f"M{sx(60)} 812 V800", "cryo")
    # section molecules (same motion as the elevation)
    c.add(f'<clipPath id="clipSLP"><rect x="{sx(37)}" y="270" width="46" height="362"/></clipPath>')
    c.add(f'<g clip-path="url(#clipSLP)">')
    for i, dz in enumerate((44, 52, 60, 68, 76)):
        c.add(f'<circle cx="{sx(dz)}" cy="622" r="2.4" fill="{CD["n2"]}"><animate attributeName="cy" from="622" to="284" '
              f'dur="6s" begin="{-1.2 * i:.1f}s" repeatCount="indefinite"/></circle>')
    for i, dz in enumerate((48, 56, 64, 72)):
        c.add(f'<circle cx="{sx(dz)}" cy="284" r="2.4" fill="{CD["o2"]}"><animate attributeName="cy" from="284" to="622" '
              f'dur="7s" begin="{-1.75 * i:.2f}s" repeatCount="indefinite"/></circle>')
    c.add("</g>")
    # callouts (right side)
    lx = sx(112)
    for y, s in ((276, "LP top: N₂ product, reflux in"), (322, "5 packed beds · structured packing"),
                 (474, "rich-liquid feed"), (522, "argon side-draw (belly ≈ 10 % Ar)"), (606, "LOX sump"),
                 (646, "condenser–reboiler"), (684, "HP column · 5.5 bar"), (796, "air in −173 °C")):
        c.line(sx(84), y - 3, lx - 4, y - 3, FAINT, 0.6, "2 2")
        c.text(lx, y, s, 9.5, fill=MUTED)

    # ---- composition profile (mole fraction vs height, same y) ----
    gx0, gx1 = sx(320), sx(410)
    c.text(gx0, 236, "Composition profile", 11, weight=500)
    c.text(gx0, 250, "mole fraction vs height", 9.5, fill=MUTED)
    comp_legend(c, gx0, 256)
    for f in (0, 0.5, 1):
        gx = gx0 + f * (gx1 - gx0)
        c.line(gx, 270, gx, 800, FAINT, 0.6, "2 2")
        c.text(gx, 812, f"{f:g}", 9, "middle", MUTED)
    c.line(gx0, 632, gx1, 632, FAINT, 0.6)
    c.line(gx0, 656, gx1, 656, FAINT, 0.6)
    profiles = {
        "n2": [(270, 1.0), (300, 0.97), (470, 0.60), (520, 0.05), (560, 0.0), (632, 0.0), (656, 0.999), (720, 0.78), (800, 0.60)],
        "o2": [(270, 0.0), (300, 0.03), (470, 0.38), (520, 0.85), (560, 0.95), (632, 0.995), (656, 0.0), (720, 0.21), (800, 0.38)],
        "ar": [(270, 0.0), (300, 0.0), (470, 0.02), (520, 0.10), (560, 0.05), (632, 0.004), (656, 0.001), (720, 0.01), (800, 0.02)],
    }
    for key, pts in profiles.items():
        lp = [(gx0 + f * (gx1 - gx0), y) for y, f in pts if y <= 632]
        hp = [(gx0 + f * (gx1 - gx0), y) for y, f in pts if y >= 656]
        for seg in (lp, hp):
            d = "M" + " L".join(f"{x:.1f} {y}" for x, y in seg)
            c.add(f'<path d="{d}" fill="none" stroke="{CD[key]}" stroke-width="1.8" stroke-linejoin="round"/>')
    c.text(gx1 + 6, 476, "feed", 9, fill=MUTED)
    c.text(gx1 + 6, 524, "Ar belly", 9, fill=MUTED)


# =============================================================================
# ISOMETRIC
# =============================================================================
def iso_box(c, x0, x1, z0, z1, yt, yb, ox, oy, fill=EQ_FILL, stroke=EQ_STROKE, fo=1.0, dash=None):
    """Visible faces for a viewer at (+x, −z): top, +x (right) face, −z (front) face."""
    P = lambda x, y, z: iso(x, y, z, ox, oy)
    faces = [
        ([P(x0, yt, z0), P(x1, yt, z0), P(x1, yt, z1), P(x0, yt, z1)], fill),                        # top
        ([P(x0, yt, z0), P(x1, yt, z0), P(x1, yb, z0), P(x0, yb, z0)], EQ_FRONT if fill == EQ_FILL else fill),  # front (−z)
        ([P(x1, yt, z0), P(x1, yt, z1), P(x1, yb, z1), P(x1, yb, z0)], EQ_SIDE if fill == EQ_FILL else fill),   # right (+x)
    ]
    d = f' stroke-dasharray="{dash}"' if dash else ""
    for i, (pts, f) in enumerate(faces):
        pd = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        extra = "" if fo >= 1 else f' fill-opacity="{fo * (1.0 if i == 0 else 0.85):.2f}"'
        c.add(f'<polygon points="{pd}" fill="{f}" stroke="{stroke}" stroke-width="0.8" stroke-linejoin="round"{extra}{d}{c.tag}/>')


def iso_cyl(c, cx, cz, r, yt, yb, ox, oy, bands=None, fill=EQ_FILL, fo=1.0):
    rx, ry = r * ISO_C * math.sqrt(2), r * ISO_S * math.sqrt(2)
    u, _ = iso(cx, yt, cz, ox, oy)
    def v_at(y):
        return iso(cx, y, cz, ox, oy)[1]
    segs = bands or [(yt, yb, fill)]
    for (ya, yb_, col) in reversed(segs):          # bottom band first so each upper band's arc overlays it
        va, vb = v_at(ya), v_at(yb_)
        c.add(f'<path d="M{u - rx:.1f} {va:.1f} L{u - rx:.1f} {vb:.1f} A{rx:.1f} {ry:.1f} 0 0 0 {u + rx:.1f} {vb:.1f} '
              f'L{u + rx:.1f} {va:.1f} Z" fill="{col}" fill-opacity="{fo}" stroke="{EQ_STROKE}" stroke-width="0.8"{c.tag}/>')
    top = segs[0][2]
    c.add(f'<ellipse cx="{u:.1f}" cy="{v_at(yt):.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{top}" stroke="{EQ_STROKE}" stroke-width="0.8"{c.tag}/>')


def draw_iso(c, ox, oy, labels=True, label_size=11):
    """Everything from the shared model, painter-sorted (far → near)."""
    items = []
    for name, x0, x1, z0, z1, yt, yb, style in BOXES:
        items.append((x1 - z0, "box", (name, x0, x1, z0, z1, yt, yb, style)))
    for name, cx, cz, r, yt, yb, bands in CYLS:
        items.append((cx + r - (cz - r), "cyl", (name, cx, cz, r, yt, yb, bands)))
    # ground plane
    gp = [iso(0, G, 160, ox, oy), iso(1640, G, 160, ox, oy), iso(1640, G, -20, ox, oy), iso(0, G, -20, ox, oy)]
    c.add('<polygon points="' + " ".join(f"{x:.1f},{y:.1f}" for x, y in gp) + f'" fill="#EFE9DE" stroke="{GROUND}" stroke-width="1"/>')
    # far → near; cold boxes drawn after their contents (translucent)
    order = {"far": [], "cold": []}
    for key, kind, data in sorted(items, key=lambda t: t[0]):
        (order["cold"] if (kind == "box" and data[7] == "cold") else order["far"]).append((key, kind, data))
    for key, kind, data in order["far"]:
        c.tag = tag_for(data[0])
        if kind == "box":
            name, x0, x1, z0, z1, yt, yb, style = data
            if style == "bld":
                iso_box(c, x0, x1, z0, z1, yt, yb, ox, oy, fill="#F1ECE2", fo=0.35, dash="5 4")
            elif style == "mhe":
                iso_box(c, x0, x1, z0, z1, yt, yb, ox, oy, fill="url(#mhe)")
            elif style == "cond":
                iso_box(c, x0, x1, z0, z1, yt, yb, ox, oy, fill="#D9D2C6")
            else:
                iso_box(c, x0, x1, z0, z1, yt, yb, ox, oy)
        else:
            name, cx, cz, r, yt, yb, bands = data
            iso_cyl(c, cx, cz, r, yt, yb, ox, oy, bands, fo=0.92 if bands else 1.0)
    for key, kind, data in order["cold"]:
        name, x0, x1, z0, z1, yt, yb, style = data
        c.tag = tag_for(name)
        iso_box(c, x0, x1, z0, z1, yt, yb, ox, oy, fill=BOX_FILL, stroke=BOX_STROKE, fo=0.28, dash="6 4")
    # molecules in the LP column (front face of the cylinder)
    c.tag = tag_for("LP column")
    u, _ = iso(1068, 0, 60, ox, oy)
    vt, vb = iso(1068, 284, 60, ox, oy)[1], iso(1068, 622, 60, ox, oy)[1]
    for i, du in enumerate((-16, -8, 0, 8, 16)):
        c.add(f'<circle cx="{u + du:.1f}" cy="{vb:.1f}" r="2.4" fill="{CD["n2"]}"{c.tag}><animate attributeName="cy" '
              f'from="{vb:.1f}" to="{vt:.1f}" dur="6s" begin="{-1.2 * i:.1f}s" repeatCount="indefinite"/></circle>')
    for i, du in enumerate((-12, -4, 4, 12)):
        c.add(f'<circle cx="{u + du:.1f}" cy="{vt:.1f}" r="2.4" fill="{CD["o2"]}"{c.tag}><animate attributeName="cy" '
              f'from="{vt:.1f}" to="{vb:.1f}" dur="7s" begin="{-1.75 * i:.2f}s" repeatCount="indefinite"/></circle>')
    # pipes on top (x-ray)
    for p in PIPES:
        if "I" in p["views"]:
            c.tag = tag_for(p["name"])
            c.stream(iso_path(p, ox, oy), p["t"], p["k"], p["sw"], p["end"])
    c.tag = tag_for("tie")
    a, b = iso(*TIE[0], ox, oy), iso(*TIE[1], ox, oy)
    c.line(f"{a[0]:.1f}", f"{a[1]:.1f}", f"{b[0]:.1f}", f"{b[1]:.1f}", "#8A8275", 1.2, "3 3")
    if labels:
        for x, y, z, s, dy, who in (
            (70, 740, 50, "Intake filter", -26, "Intake filter house"), (230, 700, 60, "Main air compressor", -14, "Compressor building"),
            (385, 660, 55, "Aftercooler", -26, "Aftercooler"), (558, 740, 55, "Adsorbers", -26, "Adsorber A"),
            (480, 670, 55, "vent", -8, "Vent stack"),
            (743, 700, 50, "Booster + N₂ recycle compressors", -14, "Booster building"),
            (890, 820, 20, "Exchanger cold box · 20 m", 16, "Exchanger cold box"),
            (982, 780, 45, "expanders", 14, "Air expander"), (1077, 820, 20, "Column cold box · 60 m", 16, "Column cold box"),
            (1180, 370, 60, "Argon cold box · 45 m", -14, "Argon cold box"), (1330, 700, 60, "LAR", -12, "LAR tank"),
            (1440, 620, 60, "LOX", -12, "LOX tank"), (1565, 640, 60, "LIN", -12, "LIN tank"),
            (1600, 150, 140, "GOX / GAN pipeline", -10, "pipeline"),
        ):
            c.tag = tag_for(who)
            u, v = iso(x, y, z, ox, oy)
            c.text(f"{u:.1f}", f"{v + dy:.1f}", s, label_size, "middle", TXT if "box" in s else MUTED)
    c.tag = ""


def iso_bounds(ox, oy):
    """Screen bounds of the whole scene (including the ground plane), for framing."""
    us, vs = [], []
    for x, z in ((0, 160), (1640, 160), (1640, -20), (0, -20)):
        u, v = iso(x, G, z, ox, oy); us.append(u); vs.append(v)
    for name, x0, x1, z0, z1, yt, yb, style in BOXES:
        for x in (x0, x1):
            for z in (z0, z1):
                for y in (yt, yb):
                    u, v = iso(x, y, z, ox, oy); us.append(u); vs.append(v)
    for p in PIPES:
        for x, y, z in p["pts"]:
            u, v = iso(x, y, z, ox, oy); us.append(u); vs.append(v)
    return min(us), min(vs), max(us), max(vs)


def region(ox, oy, xs, zs, ys, aspect, pad=30, minw=0):
    """viewBox framing the given model ranges with a fixed aspect ratio (and a minimum width = zoom limit)."""
    us, vs = [], []
    for x in xs:
        for z in zs:
            for y in ys:
                u, v = iso(x, y, z, ox, oy); us.append(u); vs.append(v)
    u0, u1, v0, v1 = min(us) - pad, max(us) + pad, min(vs) - pad, max(vs) + pad
    w, h = u1 - u0, v1 - v0
    if w / h < aspect:
        nw = h * aspect; u0 -= (nw - w) / 2; w = nw
    else:
        nh = w / aspect; v0 -= (nh - h) / 2; h = nh
    if w < minw:
        nh = minw / aspect
        u0 -= (minw - w) / 2; v0 -= (nh - h) / 2; w, h = minw, nh
    return f"{u0:.0f} {v0:.0f} {w:.0f} {h:.0f}"


# =============================================================================
# FILE WRITERS
# =============================================================================
def head(c, w, h, title, desc, extra_attr=""):
    c.add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
          f'aria-labelledby="t d" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"{extra_attr}>')
    c.add(f'<title id="t">{title}</title><desc id="d">{desc}</desc>')
    defs_and_style(c)
    c.add(f'<rect width="{w}" height="{h}" fill="{BG}"/>')


def write_v2(path="asu_multiview_v2.svg"):
    c = Canvas()
    Wv, Hv = 2180, 1290
    head(c, Wv, Hv, "Cryogenic air separation unit — elevation, plan and section that share one coordinate system",
         "Three orthographic views of the same plant model, 1 px per 0.1 m. Elevation at top with the plan view aligned "
         "below it (same x) and Section A-A through the column cold box to the right (same y), with a composition "
         "profile chart aligned to column height. Streams animate with dashes moving in the flow direction.")
    draw_elevation(c)
    # projection lines: elevation → plan (same x) and elevation → section (same y)
    PLAN_Y0 = 1236
    for x in (830, 950, 1030, 1124, 1140, 1220, 1330, 1440, 1565, 385, 528, 588):
        c.line(x, 882, x, PLAN_Y0 - 150, FAINT, 0.6, "2 3")
    for y in (220, 632, 656, 800):
        c.line(1616, y, 1708, y, FAINT, 0.6, "2 3")
    c.line(1068, 882, 1068, PLAN_Y0 - 140, TXT, 0.8, "10 3 2 3")
    draw_plan(c, PLAN_Y0)
    draw_section(c, 1660)
    c.add("</svg>")
    open(path, "w", encoding="utf-8").write(c.svg())
    return path


ISO_OX, ISO_OY = 60, 1000


def write_v3(path="asu_isometric_v3.svg", camera=False):
    c = Canvas()
    u0, v0, u1, v1 = iso_bounds(ISO_OX, ISO_OY)
    oy = ISO_OY - v0 + 70          # highest point of the scene sits at v = 70
    ox = ISO_OX - u0 + 40
    Wv, Hv = int(u1 - u0 + 80), int(v1 - v0 + 110)
    aspect = Wv / Hv
    c_shots = []
    if camera:
        shots = [
            ("wide", [0, 1640], [-20, 160], [150, 820]),
            ("warm end", [30, 640], [0, 140], [640, 820]),
            ("booster + exchanger", [640, 1030], [0, 140], [430, 820]),
            ("column box", [930, 1240], [20, 100], [140, 820]),
            ("argon + tanks", [1120, 1640], [0, 140], [140, 820]),
        ]
        c_shots = [region(ox, oy, xs, zs, ys, aspect) for _, xs, zs, ys in shots]
        c_shots[0] = f"0 0 {Wv} {Hv}"
    head(c, Wv, Hv, "Cryogenic air separation unit — isometric projection of the plant model" + (" with camera moves" if camera else ""),
         "Isometric view generated from the same 3D model as the elevation and plan. Extruded equipment, banded distillation "
         "columns, translucent cold boxes, and pipe routes drawn in three dimensions with animated flow." +
         (" The view box pans and zooms through the plant in a 70 second loop." if camera else ""))
    draw_iso(c, ox, oy)
    c.text(40, 40, "Isometric view — same model, viewer at the front-right" + (" · camera tour" if camera else ""), 15, weight=500)
    c.text(40, 58, "1 px = 0.1 m along each axis · pipes drawn in 3D · cold boxes shown as glass · colours = stream temperature, "
           "bands = composition", 10.5, fill=MUTED)
    temp_legend(c, 40, 82)
    comp_legend(c, 40, 112)
    if camera:
        vals = ";".join([c_shots[0], c_shots[0], c_shots[1], c_shots[1], c_shots[2], c_shots[2], c_shots[3], c_shots[3],
                         c_shots[4], c_shots[4], c_shots[0], c_shots[0]])
        kt = "0;0.10;0.18;0.30;0.38;0.50;0.58;0.72;0.80;0.90;0.98;1"
        ks = ";".join(["0 0 1 1", "0.42 0 0.58 1", "0 0 1 1", "0.42 0 0.58 1", "0 0 1 1", "0.42 0 0.58 1",
                       "0 0 1 1", "0.42 0 0.58 1", "0 0 1 1", "0.42 0 0.58 1", "0 0 1 1"])
        c.add(f'<animate attributeName="viewBox" values="{vals}" keyTimes="{kt}" calcMode="spline" keySplines="{ks}" '
              f'dur="70s" repeatCount="indefinite"/>')
    c.add("</svg>")
    open(path, "w", encoding="utf-8").write(c.svg())
    return path


TOUR = [
    dict(t="Overview", f=None, all=True, l=[
        "An air separation unit makes oxygen, nitrogen and argon from air. It compresses the air, cools it to about −175 °C and distils it.",
        "This model is drawn at 1 px = 0.1 m. Dashes move with each stream. Colour shows stream temperature. Bands show composition.",
        "Use Next and Back, the arrow keys, or the dots to step through the process."]),
    dict(t="Intake and compression", f=([30, 350], [0, 130], [690, 820]), l=[
        "The filter house removes dust. A 2 500 t/d oxygen plant draws about 350 000 Nm³/h of air.",
        "The main air compressor raises the air to 5.5 bar in three intercooled stages. The air leaves at about 90 °C.",
        "This compressor uses nearly all of the plant's power — about 20 MW."]),
    dict(t="Aftercooling", f=([340, 440], [30, 80], [640, 820]), l=[
        "The direct-contact aftercooler washes the compressed air with chilled water in a 16 m packed tower.",
        "The air leaves at about 10 °C. Most of its water vapour condenses out here.",
        "Dry waste nitrogen chills the water in an evaporative cooler (not drawn)."]),
    dict(t="Pre-purification", f=([460, 650], [30, 140], [430, 820]), l=[
        "Two adsorber beds of alumina and 13X zeolite remove the last water, CO₂, N₂O and hydrocarbons.",
        "One bed adsorbs while the other regenerates with heated waste nitrogen. The beds swap every few hours.",
        "This step is essential. Water and CO₂ would freeze in the cold box. Hydrocarbons would build up in the liquid oxygen."]),
    dict(t="Booster and recycle compressors", f=([640, 960], [0, 140], [470, 820]), l=[
        "A booster compressor raises part of the air to 40–60 bar. This air later vaporises the pumped liquid oxygen.",
        "A nitrogen recycle compressor drives the liquefier loop that makes liquid product for the tanks.",
        "Both streams reach the exchanger box through the overhead pipe rack."]),
    dict(t="Main heat exchanger", f=([820, 1030], [20, 140], [430, 820]), l=[
        "The brazed-aluminium plate-fin exchanger cools the incoming air from 10 °C to about −173 °C.",
        "Cold product streams flow the other way and take up the heat. The temperature approach is only 1–3 K.",
        "This recovers almost all of the cold in the products. The box around it is filled with perlite insulation."]),
    dict(t="Expanders — the refrigeration", f=([900, 1130], [20, 100], [600, 820]), l=[
        "Turboexpanders expand part of the air and part of the recycle nitrogen. Each does work on a brake or generator.",
        "Expansion with work extraction cools the gas far more than a throttle valve. This was Claude's 1902 improvement on Linde's cycle.",
        "The refrigeration offsets heat leak into the cold boxes. The expanded air feeds the low-pressure column."]),
    dict(t="High-pressure column", f=([980, 1140], [20, 100], [620, 820]), l=[
        "Air enters the bottom of the high-pressure column at 5.5 bar and −173 °C.",
        "Rising vapour gets richer in nitrogen. Falling liquid gets richer in oxygen.",
        "Near-pure nitrogen vapour collects at the top. Rich liquid with 35–40 % oxygen collects at the bottom."]),
    dict(t="Condenser–reboiler", f=([1000, 1130], [20, 100], [560, 720]), l=[
        "One exchanger links the two columns. Nitrogen at 5.5 bar condenses at about −178 °C on one side.",
        "Oxygen at 1.4 bar boils at about −180 °C on the other side. This 2 K difference drives both columns.",
        "Condensing nitrogen makes liquid reflux for both columns. Boiling oxygen makes the vapour for the upper column."]),
    dict(t="Low-pressure column", f=([930, 1140], [20, 100], [200, 660]), l=[
        "The low-pressure column makes the final split at 1.4 bar. Rich liquid and subcooled reflux enter through throttle valves.",
        "Pure nitrogen leaves the top at −193 °C. Oxygen of 99.5 % or better collects in the sump.",
        "Argon boils between the two and peaks mid-column at about 10 %. Neon and helium collect in the condenser, krypton and xenon in the sump."]),
    dict(t="Argon recovery", f=([1080, 1240], [20, 100], [350, 820]), l=[
        "A vapour side-draw from the argon belly feeds the crude argon column. Rich liquid cools its condenser.",
        "About 200 packed stages take the oxygen down to 1 ppm. No hydrogen deoxo step is needed.",
        "A small pure argon column strips the nitrogen. Liquid argon goes to storage."]),
    dict(t="Products", f=([1000, 1640], [0, 160], [560, 820]), l=[
        "Gaseous oxygen and nitrogen warm to ambient in the main exchanger and leave by pipeline to the users next door.",
        "For high-pressure oxygen the plant pumps liquid oxygen to 30–80 bar and vaporises it against booster air. No oxygen gas compressor is needed.",
        "Liquid oxygen, nitrogen and argon go to storage tanks for truck delivery. Next returns to the overview."]),
]

TOUR_JS = r"""
var S = __STAGES__;
var cam = document.getElementById('cam');
var els = Array.prototype.slice.call(document.querySelectorAll('[data-stage]'));
var dots = Array.prototype.slice.call(document.querySelectorAll('.dot'));
var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var cur = 0, anim = null;
function txt(id, s) { document.getElementById(id).textContent = s; }
function setStage(n, jump) {
  cur = ((n % S.length) + S.length) % S.length;
  var s = S[cur];
  txt('ttl', (cur + 1) + '. ' + s.t);
  for (var i = 0; i < 3; i++) txt('cap' + i, s.l[i] || '');
  txt('cnt', (cur + 1) + ' / ' + S.length);
  els.forEach(function (el) {
    var k = +el.getAttribute('data-stage');
    el.style.opacity = s.all ? 1 : (k === cur ? 1 : (k < cur ? 0.5 : 0.12));
  });
  dots.forEach(function (d, i) { d.setAttribute('fill', i === cur ? '__TXT__' : '__FAINT__'); });
  flyTo(s.f, jump || reduce);
}
function go(d) { setStage(cur + d); }
function flyTo(f, jump) {
  var from = cam.getAttribute('viewBox').split(/\s+/).map(Number);
  if (anim) cancelAnimationFrame(anim);
  if (jump) { cam.setAttribute('viewBox', f.join(' ')); return; }
  var t0 = performance.now(), D = 900;
  function step(now) {
    var p = Math.min(1, (now - t0) / D);
    p = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    var v = from.map(function (a, i) { return a + (f[i] - a) * p; });
    cam.setAttribute('viewBox', v.map(function (x) { return x.toFixed(1); }).join(' '));
    if (p < 1) anim = requestAnimationFrame(step);
  }
  anim = requestAnimationFrame(step);
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { go(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); e.preventDefault(); }
  else if (e.key === 'Home') { setStage(0); e.preventDefault(); }
});
setStage(0, true);
"""


def write_v5(path="asu_tour_v5.svg"):
    import json
    c = Canvas()
    u0, v0, u1, v1 = iso_bounds(ISO_OX, ISO_OY)
    oy = ISO_OY - v0 + 70
    ox = ISO_OX - u0 + 40
    Wv, Hc = int(u1 - u0 + 80), int(v1 - v0 + 110)      # camera viewport
    HUD = 124
    Hv = Hc + HUD
    aspect = Wv / Hc
    frames = []
    for s in TOUR:
        if s["f"] is None:
            frames.append([0, 0, Wv, Hc])
        else:
            xs, zs, ys = s["f"]
            frames.append([float(v) for v in region(ox, oy, xs, zs, ys, aspect, minw=560).split()])
    stages = [dict(t=s["t"], l=s["l"], f=frames[i], all=bool(s.get("all"))) for i, s in enumerate(TOUR)]

    head(c, Wv, Hv, "Cryogenic air separation unit — step-by-step tour of the isometric model",
         "Interactive tour in twelve stages. Each stage frames one part of the plant, highlights its equipment and streams, "
         "and explains it in a short caption. Back and Next buttons, the dots, or the arrow keys change the stage. "
         "Without scripting the picture shows the overview stage.")
    c.add("<style>.btn{cursor:pointer}.btn:hover rect{fill:#DDD5C7}.dot{cursor:pointer}"
          "[data-stage]{transition:opacity .6s ease}</style>")
    # camera
    c.add(f'<svg id="cam" x="0" y="0" width="{Wv}" height="{Hc}" viewBox="0 0 {Wv} {Hc}" preserveAspectRatio="xMidYMid meet">')
    draw_iso(c, ox, oy, label_size=10)
    c.add("</svg>")
    # scene title (fixed to the screen)
    c.add(f'<rect x="12" y="10" width="372" height="26" rx="5" fill="{BG}" fill-opacity="0.85"/>')
    c.text(22, 28, "Cryogenic air separation unit · step-by-step tour", 12.5, fill=MUTED, weight=500)
    # HUD strip
    y0 = Hc
    c.add(f'<rect x="0" y="{y0}" width="{Wv}" height="{HUD}" fill="#F1ECE2"/>')
    c.line(0, y0, Wv, y0, GROUND, 1)
    s0 = stages[0]
    c.text(28, y0 + 34, "1. " + s0["t"], 14, weight=500, id="ttl")
    for i in range(3):
        c.text(28, y0 + 56 + 18 * i, s0["l"][i], 11.5, id=f"cap{i}")
    # legend, centre of the strip
    lx0 = Wv - 720
    c.text(lx0, y0 + 30, "Stream temperature", 10, fill=MUTED, weight=500)
    lx = lx0
    for k, lab in (("hot", "+90 °C"), ("amb", "+20 °C"), ("chill", "+10 °C"),
                   ("cool", "−100 °C"), ("cryo", "−175 °C"), ("deep", "−193 °C")):
        c.add(f'<rect x="{lx}" y="{y0 + 38}" width="14" height="8" rx="2" fill="{T[k]}"/>')
        c.text(lx + 18, y0 + 46, lab, 9.5, fill=MUTED)
        lx += 66
    c.text(lx0, y0 + 68, "Composition", 10, fill=MUTED, weight=500)
    lx = lx0
    for key, lab in (("n2", "N₂"), ("o2", "O₂"), ("ar", "Ar")):
        c.add(f'<rect x="{lx}" y="{y0 + 76}" width="10" height="8" fill="{C[key]}"/>')
        c.text(lx + 14, y0 + 84, lab, 9.5, fill=CD[key])
        lx += 40
    c.text(lx0, y0 + 106, "gas dashes move fast · liquid slow · grey dashed = heat exchange", 9.5, fill=MUTED)
    # dots, counter, buttons (right)
    n = len(stages)
    dx0 = Wv - 300
    for i in range(n):
        cx = dx0 + i * 17
        c.add(f'<circle class="dot" cx="{cx}" cy="{y0 + 34}" r="4.5" fill="{TXT if i == 0 else FAINT}" onclick="setStage({i})"/>')
    c.text(Wv - 28, y0 + 38, f"1 / {n}", 11, "end", MUTED, id="cnt")
    for x, lab, d in ((Wv - 300, "← Back", -1), (Wv - 172, "Next →", 1)):
        c.add(f'<g class="btn" onclick="go({d})" role="button" aria-label="{lab}">'
              f'<rect x="{x}" y="{y0 + 56}" width="116" height="34" rx="6" fill="{EQ_FILL}" stroke="{EQ_STROKE}"/>'
              f'<text x="{x + 58}" y="{y0 + 78}" font-size="12.5" text-anchor="middle" fill="{TXT}" font-weight="500">{lab}</text></g>')
    c.text(Wv - 28, y0 + 108, "arrow keys or space also step", 9.5, "end", FAINT)
    # script
    js = TOUR_JS.replace("__STAGES__", json.dumps(stages, ensure_ascii=False)).replace("__TXT__", TXT).replace("__FAINT__", FAINT)
    c.add("<script type=\"text/javascript\"><![CDATA[" + js + "]]></script>")
    c.add("</svg>")
    open(path, "w", encoding="utf-8").write(c.svg())
    return path


if __name__ == "__main__":
    print(write_v2(), write_v3(), write_v3("asu_camera_v4.svg", camera=True), write_v5())
