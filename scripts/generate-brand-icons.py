#!/usr/bin/env python3
"""Rebuild every FlutterGo app/website icon from design/assets/fluttergo-logo-source.png.

Each existing icon keeps its size and where its artwork sits (its alpha
bounding box); only the artwork changes. Run: python3 scripts/generate-brand-icons.py
"""
import glob
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "design/assets/fluttergo-logo-source.png")
TOP, BOTTOM = (34, 37, 43), (14, 15, 18)  # dark tile gradient
LOGO_SHARE = 0.68  # logo size relative to the tile


def logo_only() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    return im.crop(im.split()[3].getbbox())


def fit(img: Image.Image, box: int) -> Image.Image:
    w, h = img.size
    s = box / max(w, h)
    return img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def tile(size: int) -> Image.Image:
    ss = 4
    big = size * ss
    grad = Image.new("RGBA", (1, big))
    for y in range(big):
        t = y / max(1, big - 1)
        grad.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)) + (255,))
    grad = grad.resize((big, big))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.225), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    out = out.resize((size, size), Image.LANCZOS)
    mark = fit(logo_only(), round(size * LOGO_SHARE))
    out.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return out


def mark(size: int, pad: float = 0.04) -> Image.Image:
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = fit(logo_only(), round(size * (1 - 2 * pad)))
    out.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return out


def redraw(path: str, art) -> None:
    """Redraw `path` with art(size) placed where the old artwork was."""
    old = Image.open(path).convert("RGBA")
    l, t, r, b = old.split()[3].getbbox() or (0, 0, *old.size)
    side = min(r - l, b - t)
    out = Image.new("RGBA", old.size, (0, 0, 0, 0))
    out.alpha_composite(art(side), (l + (r - l - side) // 2, t + (b - t - side) // 2))
    out.save(path, optimize=True)


def p(rel: str) -> str:
    return os.path.join(ROOT, rel)


# Desktop app icons
for f in glob.glob(p("icons/icons/png/*.png")):
    n = int(os.path.basename(f).split("x")[0])
    tile(n).save(f, optimize=True)
master = tile(1024)
master.save(p("icons/icons/mac/icon.icns"), sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
master.save(p("icons/icons/win/icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# In-app images
master.save(p("public/fluttergo.png"), optimize=True)
mark(72).save(p("src/assets/fluttergo-mark.png"), optimize=True)

# Windows Store (appx) and website/design
for f in glob.glob(p("build/appx/*.png")):
    redraw(f, tile)
for rel in ("design/assets/logo-icon.png", "website/static/img/logo-icon.png", "website/static/img/apple-touch-icon.png"):
    redraw(p(rel), tile)
print("brand icons regenerated")
