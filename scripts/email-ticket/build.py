"""
Renders the static artwork for the Pronite Pass email ticket.

Email clients can't run the site's CSS ticket (no container queries, no web
fonts in Gmail), so the parts that never change per buyer are baked into
images here, with Noot set exactly like the site. The per-buyer stub — gate
QR, pass code, holder, date — is live HTML in src/emails/templates.tsx.

Outputs (2x for retina, shown at 560px wide):
  public/tarang/email/ticket-art.png   red print panel, wave seam, wordmark
  public/tarang/email/ticket-perf.png  perforation strip with punched notches

Run from the repo root:  python3 scripts/email-ticket/build.py   (needs Pillow)
"""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W = 1120
INK = (20, 19, 16)
BONE = (244, 234, 200)
BLOOD = (110, 0, 1)
BLOOD_DEEP = (58, 1, 2)
CRIMSON = (176, 20, 14)
NOOT = "src/fonts/Noot-Regular.ttf"
OUT = "public/tarang/email/"


def font(size):
    return ImageFont.truetype(NOOT, size)


def halftone_panel(w, h):
    """Oxblood field, vignetted, with crimson halftone dots — the poster."""
    base = Image.new("RGB", (w, h), BLOOD)
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((-w * 0.25, -h * 0.6, w * 1.25, h * 1.2), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(min(w, h) // 4))
    base = Image.composite(base, Image.new("RGB", (w, h), BLOOD_DEEP), glow)
    d = ImageDraw.Draw(base)
    step = 30
    for y in range(0, h + step, step):
        for x in range(0, w + step, step):
            # Dots swell towards the top-right, as on the poster.
            k = 0.22 + 0.16 * (x / w) * (1 - y / h)
            r = step * k
            d.ellipse((x - r, y - r, x + r, y + r), fill=CRIMSON)
    return base


def wave_y(x, top, amp=26):
    return top + amp * math.sin(x / W * math.pi * 3.2 + 0.6)


def stamp(size, text):
    """Venue stamp: cream disc, ink rim, mudra ring, text running round."""
    s = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    c = size / 2
    d.ellipse((4, 4, size - 4, size - 4), fill=BONE, outline=INK, width=6)
    r_ring = size * 0.16
    d.ellipse((c - r_ring, c - r_ring, c + r_ring, c + r_ring), outline=BLOOD, width=int(size * 0.06))
    d.ellipse((c - size * 0.04, c - size * 0.04, c + size * 0.04, c + size * 0.04), fill=BLOOD)
    f = font(int(size * 0.1))
    radius = size * 0.36
    n = len(text)
    for i, ch in enumerate(text):
        ang = i / n * 2 * math.pi - math.pi / 2
        glyph = Image.new("RGBA", (int(size * 0.16), int(size * 0.16)), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glyph)
        gd.text((glyph.width / 2, glyph.height / 2), ch, font=f, fill=INK, anchor="mm")
        glyph = glyph.rotate(-math.degrees(ang) - 90, resample=Image.BICUBIC)
        x = c + radius * math.cos(ang) - glyph.width / 2
        y = c + radius * math.sin(ang) - glyph.height / 2
        s.alpha_composite(glyph, (int(x), int(y)))
    return s


def rounded_mask(w, h, r, top=True, bottom=False):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1 + (0 if bottom else r)), r, fill=255)
    if not top:
        ImageDraw.Draw(m).rectangle((0, 0, w, r), fill=255)
    return m


def build_art():
    H = 1030
    PANEL = 470
    img = Image.new("RGBA", (W, H), BONE + (255,))

    # Print panel with the poster's hands rising through it.
    panel = halftone_panel(W, PANEL).convert("RGBA")
    hands = Image.open("public/tarang/hands-bottom.webp").convert("RGBA")
    hw = int(W * 1.08)
    hands = hands.resize((hw, int(hands.height * hw / hands.width)), Image.LANCZOS)
    panel.alpha_composite(hands, ((W - hw) // 2, PANEL - int(hands.height * 0.72)))
    img.alpha_composite(panel, (0, 0))

    # Wave-cut seam: paper laps over the print.
    d = ImageDraw.Draw(img)
    seam_top = PANEL - 40
    pts = [(x, wave_y(x, seam_top)) for x in range(0, W + 1, 8)]
    d.polygon(pts + [(W, H), (0, H)], fill=BONE)
    d.line(pts, fill=INK, width=4, joint="curve")

    img.alpha_composite(stamp(230, "NIT PATNA — PRONITE — TARANG 26 — "), (W - 290, 40))

    # Wordmark: solid ink with the red offset, sized to the paper's width.
    text = "TARANG"
    size = 250
    size = int(size * (W - 160) / d.textlength(text, font=font(size)))
    f = font(size)
    x, y = 80, PANEL - 6
    d.text((x + 12, y + 12), text, font=f, fill=BLOOD)
    d.text((x, y), text, font=f, fill=INK)

    # Pill.
    pf = font(34)
    label = "PRONITE PASS — ALL NIGHTS"
    lw = d.textlength(label, font=pf)
    py = y + int(size * 1.06)
    d.rounded_rectangle((x, py, x + lw + 64, py + 64), 32, fill=BLOOD)
    d.text((x + 32, py + 32), label, font=pf, fill=BONE, anchor="lm")

    # "You're not mundane", stacked under the pill.
    sf = font(56)
    ly = py + 104
    for word, col in [("YOU'RE", INK), ("NOT", BLOOD), ("MUNDANE", INK)]:
        d.text((x, ly), word, font=sf, fill=col)
        ly += 58

    # Venue, bottom right — the institution never changes, dates live in the stub.
    vf = font(64)
    d.text((W - 80, py + 104), "NIT PATNA", font=vf, fill=INK, anchor="ra")
    d.text((W - 80, py + 180), "ASHOK RAJPATH", font=font(36), fill=BLOOD, anchor="ra")
    d.text((W - 80, py + 222), "PATNA, BIHAR", font=font(36), fill=INK, anchor="ra")

    mask = rounded_mask(W, H, 36, top=True)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    out.save(OUT + "ticket-art.png", optimize=True)



def build_perf():
    H = 48
    img = Image.new("RGBA", (W, H), BONE + (255,))
    d = ImageDraw.Draw(img)
    for x in range(40, W - 40, 28):
        d.line((x, H / 2, x + 14, H / 2), fill=(20, 19, 16, 140), width=4)
    # Punched notches, filled with the email's ink backdrop.
    r = 24
    d.ellipse((-r, H / 2 - r, r, H / 2 + r), fill=INK)
    d.ellipse((W - r, H / 2 - r, W + r, H / 2 + r), fill=INK)
    img.save(OUT + "ticket-perf.png", optimize=True)


if __name__ == "__main__":
    build_art()
    build_perf()
    print("wrote", OUT + "ticket-art.png", OUT + "ticket-perf.png")
