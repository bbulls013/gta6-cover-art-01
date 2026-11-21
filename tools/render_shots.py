#!/usr/bin/env python3
"""Renders Neon Poster Lab screenshots without a browser.

This mirrors the composition logic in app/src/main.js — same layout fractions, same
cover-fit crop math, same grade recipes, same lettering treatment — so the images show
covers the app itself produces, drawn at screenshot size. Run from the repo root:

    python3 tools/render_shots.py

Writes the four JPEGs in screenshots/ (the starter's are replaced).
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = {
    "boulevard": ROOT / "app" / "samples" / "boulevard.jpg",
    "pier": ROOT / "app" / "samples" / "pier.jpg",
}
OUT = ROOT / "screenshots"

FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"

# Layout fractions, identical to LAYOUTS in app/src/main.js.
LAYOUTS = {
    "quad": [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
    "hero": [[0, 0, 0.58, 1], [0.58, 0, 0.42, 0.5], [0.58, 0.5, 0.42, 0.5]],
    "strips": [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
    "banner": [[0, 0, 1, 0.56], [0, 0.56, 0.5, 0.44], [0.5, 0.56, 0.5, 0.44]],
}

# Grade recipes, mirroring GRADES in app/src/main.js (canvas filter + wash gradient).
GRADES = {
    "sunset": {"color": 1.5, "contrast": 1.12, "bright": 1.03, "sepia": 0.28,
               "wash": [(255, 150, 64), (140, 24, 110)], "wash_alpha": 0.34, "angle": "vertical"},
    "neon": {"color": 1.75, "contrast": 1.28, "bright": 0.99, "sepia": 0.0,
             "wash": [(0, 229, 255), (255, 0, 170)], "wash_alpha": 0.30, "angle": "diagonal"},
    "teal": {"color": 1.32, "contrast": 1.16, "bright": 1.01, "sepia": 0.0,
             "wash": [(0, 128, 140), (255, 122, 26)], "wash_alpha": 0.30, "angle": "vertical"},
    "clean": {"color": 1.08, "contrast": 1.05, "bright": 1.0, "sepia": 0.0,
              "wash": [(255, 255, 255), (10, 8, 24)], "wash_alpha": 0.12, "angle": "vertical"},
}


def panel_rects(layout_id, w, h):
    gap = round(min(w, h) * 0.012)
    rects = []
    for fx, fy, fw, fh in LAYOUTS[layout_id]:
        rects.append((
            round(fx * w) + gap,
            round(fy * h) + gap,
            round(fw * w) - gap * 2,
            round(fh * h) - gap * 2,
        ))
    return rects


def cover_crop(img, rect, zoom, ox, oy):
    """Same cover-fit math as coverBox() in the app: scale to cover, then pan by ox/oy."""
    _, _, rw, rh = rect
    scale = max(rw / img.width, rh / img.height) * zoom
    dw, dh = round(img.width * scale), round(img.height * scale)
    resized = img.resize((dw, dh), Image.LANCZOS)
    slack_x, slack_y = dw - rw, dh - rh
    left = round(slack_x * (0.5 + ox))
    top = round(slack_y * (0.5 + oy))
    return resized.crop((left, top, left + rw, top + rh))


def apply_grade(img, grade):
    out = ImageEnhance.Color(img).enhance(grade["color"])
    out = ImageEnhance.Contrast(out).enhance(grade["contrast"])
    out = ImageEnhance.Brightness(out).enhance(grade["bright"])
    if grade["sepia"] > 0:
        gray = out.convert("L")
        sepia = Image.merge("RGB", (
            gray.point(lambda v: min(255, int(v * 1.07))),
            gray.point(lambda v: int(v * 0.85)),
            gray.point(lambda v: int(v * 0.62)),
        ))
        out = Image.blend(out, sepia, grade["sepia"] * 0.6)
    return out


def gradient(w, h, top_rgb, bottom_rgb, angle="vertical"):
    """A two-stop gradient image; diagonal interpolates along x+y."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    if angle == "vertical":
        for y in range(h):
            t = y / max(1, h - 1)
            c = tuple(round(top_rgb[i] + (bottom_rgb[i] - top_rgb[i]) * t) for i in range(3))
            for x in range(w):
                px[x, y] = c
    else:
        for y in range(h):
            for x in range(w):
                t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
                px[x, y] = tuple(round(top_rgb[i] + (bottom_rgb[i] - top_rgb[i]) * t) for i in range(3))
    return img


def vignette(img, strength):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    r = max(w, h) * 0.75
    d.ellipse([w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(w, h) * 0.18))
    dark = Image.new("RGB", (w, h), (5, 2, 16))
    alpha = mask.point(lambda v: round((255 - v) * 0.38 * max(0.35, strength)))
    return Image.composite(dark, img, alpha)


def draw_caption(img, title, subtitle, pos="bottom", scale=1.0):
    """Bold gradient lettering with a dark keyline, condensed like the app's canvas text."""
    w, h = img.size
    unit = min(w, h)
    title = title.upper()
    subtitle = subtitle.upper()
    title_size = int(unit * 0.105 * scale)
    font = ImageFont.truetype(FONT_BOLD, title_size)
    probe = ImageDraw.Draw(img)
    tw = probe.textlength(title, font=font) * 0.86
    if tw > w * 0.92 and tw > 0:
        title_size = int(title_size * (w * 0.92) / tw)
        font = ImageFont.truetype(FONT_BOLD, title_size)
    sub_size = max(13, int(title_size * 0.30))
    sub_font = ImageFont.truetype(FONT_BOLD, sub_size)
    block_h = title_size * 1.12 + (sub_size * 1.9 if subtitle else 0)
    if pos == "top":
        top = int(h * 0.045)
    elif pos == "center":
        top = int((h - block_h) / 2)
    else:
        top = int(h - block_h - h * 0.045)

    # Dark band behind the lettering.
    band = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    band_top = int(top - title_size * 0.35)
    band_h = int(block_h + title_size * 0.65)
    for y in range(max(0, band_top), min(h, band_top + band_h)):
        t = (y - band_top) / max(1, band_h)
        a = int(160 * min(1.0, t * 1.6))
        bd.line([(0, y), (w, y)], fill=(8, 4, 20, a))
    img.paste(Image.alpha_composite(img.convert("RGBA"), band).convert("RGB"), (0, 0))

    # Title: render to a mask, fill with a sunset gradient, add the keyline.
    pad = title_size
    mask = Image.new("L", (w + pad * 2, title_size * 2), 0)
    md = ImageDraw.Draw(mask)
    md.text((pad + w / 2, title_size * 0.1), title, font=font, fill=255, anchor="ma",
            stroke_width=max(2, int(title_size * 0.08)), stroke_fill=255)
    grad = gradient(mask.width, mask.height, (255, 246, 216), (255, 77, 141))
    # Condense horizontally to 86%, like the app's transform.
    grad = grad.resize((int(grad.width * 0.86), grad.height), Image.LANCZOS)
    mask = mask.resize((int(mask.width * 0.86), mask.height), Image.LANCZOS)
    keyline = Image.new("RGBA", mask.size, (16, 6, 32, 235))
    keyline.putalpha(mask)
    img.paste(keyline, (int(w / 2 - mask.width / 2), top - int(title_size * 0.02)), keyline)
    title_img = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    title_img.paste(grad, (0, 0))
    title_img.putalpha(mask.filter(ImageFilter.MinFilter(3)))
    img.paste(title_img, (int(w / 2 - mask.width / 2), top - int(title_size * 0.02)), title_img)

    if subtitle:
        d = ImageDraw.Draw(img)
        tracking = sub_size * 0.32
        widths = [d.textlength(ch, font=sub_font) for ch in subtitle]
        total = sum(widths) + tracking * (len(subtitle) - 1)
        x = w / 2 - total / 2
        y = top + title_size + sub_size * 0.55
        for ch, cw in zip(subtitle, widths):
            d.text((x + 2, y + 2), ch, font=sub_font, fill=(0, 0, 0))
            d.text((x, y), ch, font=sub_font, fill=(174, 243, 236))
            x += cw + tracking
    return img


def render_cover(w, h, layout_id, grade_id, photos, title, subtitle, strength=0.8, pos="bottom"):
    grade = GRADES[grade_id]
    canvas = Image.new("RGB", (w, h), (18, 10, 36))
    rects = panel_rects(layout_id, w, h)
    for i, rect in enumerate(rects):
        img = photos[i % len(photos)]
        zoom = 1 + (i % 3) * 0.12
        ox = -0.12 if i % 2 == 0 else 0.12
        oy = 0.1 if i % 3 == 0 else -0.06
        piece = apply_grade(cover_crop(img, rect, zoom, ox, oy), grade)
        canvas.paste(piece, (rect[0], rect[1]))
    wash = gradient(w, h, grade["wash"][0], grade["wash"][1], grade["angle"])
    canvas = Image.blend(canvas, wash, grade["wash_alpha"] * strength)
    canvas = vignette(canvas, strength)
    d = ImageDraw.Draw(canvas)
    lw = max(2, int(min(w, h) * 0.004))
    for rect in rects:
        d.rectangle([rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]], outline=(10, 6, 24), width=lw)
        d.rectangle([rect[0] + 2, rect[1] + 2, rect[0] + rect[2] - 2, rect[1] + rect[3] - 2],
                    outline=(255, 255, 255), width=1)
    canvas = draw_caption(canvas, title, subtitle, pos)
    return canvas


def save_shot(img, name, max_side=None):
    if max_side and max(img.size) > max_side:
        img = img.copy()
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    path = OUT / name
    for quality in (84, 78, 70, 62):
        img.save(path, "JPEG", quality=quality)
        if path.stat().st_size <= 262144:
            break
    print(name, img.size, path.stat().st_size, "bytes")


def render_editor(photos):
    """The editor UI at 1280x720: topbar, preview with a photo loaded, control sidebar."""
    w, h = 1280, 720
    img = Image.new("RGB", (w, h), (13, 11, 20))
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(FONT_BOLD, 21)
    f_small = ImageFont.truetype(FONT_REG, 13)
    f_label = ImageFont.truetype(FONT_BOLD, 12)
    f_btn = ImageFont.truetype(FONT_BOLD, 14)

    # Top bar
    d.rectangle([0, 0, w, 64], fill=(23, 19, 36))
    d.rounded_rectangle([18, 14, 74, 50], 9, fill=(255, 94, 138))
    d.text((28, 22), "NPL", font=f_btn, fill=(22, 11, 38))
    d.text((88, 14), "Neon Poster Lab", font=f_title, fill=(244, 241, 255))
    d.text((88, 40), "Turn your photos into multi-panel cover art.", font=f_small, fill=(185, 178, 217))
    d.rounded_rectangle([w - 330, 15, w - 196, 49], 9, outline=(50, 42, 77), width=1)
    d.text((w - 308, 24), "Add photos", font=f_btn, fill=(244, 241, 255))
    d.rounded_rectangle([w - 182, 15, w - 22, 49], 9, fill=(255, 123, 84))
    d.text((w - 156, 24), "Export PNG", font=f_btn, fill=(28, 11, 30))

    # Preview: the quad cover being edited, with the selected panel outlined.
    cover = render_cover(1080, 1080, "quad", "sunset", photos, "VICE CITY NIGHTS", "LEONIDA • EST. 2026")
    cover.thumbnail((560, 560), Image.LANCZOS)
    px, py = 40, 92
    d.rounded_rectangle([px - 14, py - 14, px + cover.width + 14, py + cover.height + 14], 14,
                        fill=(9, 7, 17), outline=(50, 42, 77))
    img.paste(cover, (px, py))
    rects = panel_rects("quad", 1080, 1080)
    r0 = rects[0]
    sx = cover.width / 1080
    d.rectangle([px + r0[0] * sx, py + r0[1] * sx, px + (r0[0] + r0[2]) * sx, py + (r0[1] + r0[3]) * sx],
                outline=(55, 224, 212), width=3)
    d.text((px, py + cover.height + 26), "Click a panel to select it. Drag to frame. Scroll to zoom.",
           font=f_small, fill=(185, 178, 217))

    # Sidebar groups
    sx0 = 660
    groups = [
        ("PHOTOS", ["Boulevard", "Pier", "Photo 3", "Photo 4"]),
        ("LAYOUT", ["Quad grid", "Hero + two", "Three strips", "Banner + two"]),
        ("COLOUR GRADE", ["Vice sunset", "Neon night", "Teal & orange", "Clean print"]),
        ("CAPTION", ["VICE CITY NIGHTS", "LEONIDA • EST. 2026"]),
        ("POSTER SIZE", ["1080 × 1080", "1080 × 1350", "1920 × 1080"]),
    ]
    y = 84
    for name, items in groups:
        d.rounded_rectangle([sx0, y, w - 24, y + 34 + len(items) * 30], 12, fill=(30, 25, 48), outline=(50, 42, 77))
        d.text((sx0 + 14, y + 9), name, font=f_label, fill=(255, 179, 92))
        iy = y + 32
        for item in items:
            d.rounded_rectangle([sx0 + 14, iy, sx0 + 250, iy + 24], 8, fill=(23, 19, 36), outline=(50, 42, 77))
            d.text((sx0 + 24, iy + 5), item, font=f_small, fill=(244, 241, 255))
            iy += 30
        y += 34 + len(items) * 30 + 12
    return img


def main():
    photos = [Image.open(SAMPLES["boulevard"]).convert("RGB"),
              Image.open(SAMPLES["pier"]).convert("RGB")]
    OUT.mkdir(exist_ok=True)

    cover = render_cover(1920, 1080, "hero", "sunset", photos, "VICE CITY NIGHTS", "LEONIDA • EST. 2026")
    save_shot(cover, "1-cover.jpg", max_side=1280)

    save_shot(render_editor(photos), "2-editor.jpg")

    square = render_cover(1080, 1080, "quad", "neon", photos, "NEON HEIST", "PALM AVENUE • 2 A.M.")
    save_shot(square, "3-cover-square.jpg", max_side=1024)

    portrait = render_cover(1080, 1350, "strips", "teal", photos, "PALM AVENUE", "VICE SHORES • SUMMER 26")
    save_shot(portrait, "4-cover-portrait.jpg", max_side=1280)


if __name__ == "__main__":
    main()
