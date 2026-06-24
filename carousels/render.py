#!/usr/bin/env python3
"""
Instagram Carousel Renderer — Template-Driven
Supports multiple visual templates (Skyframe, Plain Blue/Black/White, custom).
Each template defines fonts, colors, background style, and chrome layout.

Usage:
    python3 render.py <carousel-dir>
    python3 render.py workspace/my-carousel

The carousel directory must contain a config.json file.
Output PNGs are saved in the same directory.
"""

import json
import math
import sys
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

# -- Constants ----------------------------------------------------------------

SLIDE_WIDTH = 1080
SLIDE_HEIGHT = 1350  # Instagram max portrait

ASSETS_DIR = Path(__file__).parent / "assets"
FONT_DIR = ASSETS_DIR / "fonts"
HEADSHOT_PATH = ASSETS_DIR / "headshot.jpg"
TEMPLATES_DIR = Path(__file__).parent / "templates"

# Layout
PADDING = 80
CONTENT_WIDTH = SLIDE_WIDTH - (PADDING * 2)
FOOTER_HEIGHT = 80

# Instagram overlays its slide index (1/3) at upper-right and mute icon at lower-right.
IG_RIGHT_INSET = 100

# -- Art Zone (aspect-aware cutout for image_body / cta_follow slides) --------
# Zone sizes are tuned to give 16:9 video the horizontal real estate it needs
# while keeping 1:1 and 9:16 within the slide's usable content area.
ART_ZONES = {
    "1:1":  (880, 880),
    "16:9": (1000, 562),
    "9:16": (506, 900),
}
# Content vertical bounds (below header chrome, above progress/footer)
ART_TOP_Y = 140
ART_BOTTOM_Y = 1040


def get_art_zone(aspect, text_pos):
    """Return (zone_x, zone_y, zone_w, zone_h, text_y) for the given aspect + text position."""
    w, h = ART_ZONES.get(aspect, ART_ZONES["1:1"])
    zone_x = (SLIDE_WIDTH - w) // 2
    if text_pos == "top":
        zone_y = ART_BOTTOM_Y - h
        text_y = ART_TOP_Y
    else:
        zone_y = ART_TOP_Y
        text_y = zone_y + h + 40
    return zone_x, zone_y, w, h, text_y


def cover_fit_image(src, zone_w, zone_h):
    """Scale + center-crop image to fully cover the zone (like CSS object-fit: cover)."""
    if src.width <= 0 or src.height <= 0:
        return src
    scale = max(zone_w / src.width, zone_h / src.height)
    new_w = max(1, int(round(src.width * scale)))
    new_h = max(1, int(round(src.height * scale)))
    resized = src.resize((new_w, new_h), Image.LANCZOS)
    crop_x = (new_w - zone_w) // 2
    crop_y = (new_h - zone_h) // 2
    return resized.crop((crop_x, crop_y, crop_x + zone_w, crop_y + zone_h))


# -- Template Loading ---------------------------------------------------------

# Fallback Skyframe palette (used when no template loaded)
DEFAULT_COLORS = {
    "dark": {
        "bg": "#000000", "text": "#F0F0F0", "text_muted": "#cccccc",
        "accent": "#ffff00", "accent_secondary": "#00ffff",
        "border": "#cccc00", "tag_outline": "#00ffff",
    },
    "light": {
        "bg": "#FFFFFF", "text": "#1a1a1a", "text_muted": "#555555",
        "accent": "#c8a000", "accent_secondary": "#0088aa",
        "border": "#c8a000", "tag_outline": "#0088aa",
    },
}


def load_template(template_id):
    """Load a template JSON from templates/ directory. Returns None if not found."""
    if not template_id:
        return None
    path = TEMPLATES_DIR / f"{template_id}.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return None


def load_fonts_for_template(template):
    """Load fonts based on template config. Falls back to Skyframe defaults."""
    fonts = {}

    if template and template.get("fonts"):
        tfonts = template["fonts"]
        sizes = template.get("font_sizes", {})

        def _load(filename, size):
            if not filename:
                return ImageFont.truetype(str(FONT_DIR / "Quantico-Regular.ttf"), size)
            path = str(FONT_DIR / filename)
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
            return ImageFont.truetype(str(FONT_DIR / "Quantico-Regular.ttf"), size)

        hl = tfonts.get("headline", "Audiowide-Regular.ttf")
        hl_it = tfonts.get("headline_italic")
        bd = tfonts.get("body", "SpaceMono-Regular.ttf")
        bd_b = tfonts.get("body_bold", "SpaceMono-Bold.ttf")
        ch = tfonts.get("chrome", "Quantico-Regular.ttf")
        ch_b = tfonts.get("chrome_bold", "Quantico-Bold.ttf")
        hd = tfonts.get("hand")

        fonts["headline_xl"] = _load(hl, sizes.get("headline_xl", 120))
        fonts["headline_lg"] = _load(hl, sizes.get("headline_lg", 88))
        fonts["headline_md"] = _load(hl, sizes.get("headline_md", 64))
        fonts["headline_sm"] = _load(hl, sizes.get("headline_sm", 48))
        fonts["headline_italic"] = _load(hl_it or hl, sizes.get("headline_lg", 88))

        fonts["body_lg"] = _load(bd_b, sizes.get("body_lg", 48))
        fonts["body"] = _load(bd, sizes.get("body", 42))
        fonts["body_sm"] = _load(bd, sizes.get("body_sm", 34))
        fonts["body_bold"] = _load(bd_b, sizes.get("body", 42))

        fonts["caption"] = _load(ch, sizes.get("caption", 28))
        fonts["handle"] = _load(ch, 24)
        fonts["display_name"] = _load(ch_b, 32)
        fonts["header"] = _load(ch, sizes.get("chrome", 22))
        fonts["footer"] = _load(ch, sizes.get("chrome", 22))

        if hd and os.path.exists(str(FONT_DIR / hd)):
            fonts["hand_lg"] = ImageFont.truetype(str(FONT_DIR / hd), 58)
            fonts["hand_md"] = ImageFont.truetype(str(FONT_DIR / hd), 48)
            fonts["hand_sm"] = ImageFont.truetype(str(FONT_DIR / hd), 40)
        else:
            fonts["hand_lg"] = _load(ch, 44)
            fonts["hand_md"] = _load(ch, 36)
            fonts["hand_sm"] = _load(ch, 30)
    else:
        # Legacy Skyframe font loading
        fonts = _load_skyframe_fonts()

    return fonts


def _load_skyframe_fonts():
    """Original Skyframe font stack."""
    fonts = {}
    aw = str(FONT_DIR / "Audiowide-Regular.ttf")
    sm = str(FONT_DIR / "SpaceMono-Regular.ttf")
    smb = str(FONT_DIR / "SpaceMono-Bold.ttf")
    qr = str(FONT_DIR / "Quantico-Regular.ttf")
    qb = str(FONT_DIR / "Quantico-Bold.ttf")
    cv = str(FONT_DIR / "Caveat.ttf")

    try:
        fonts["headline_xl"] = ImageFont.truetype(aw, 120)
        fonts["headline_lg"] = ImageFont.truetype(aw, 88)
        fonts["headline_md"] = ImageFont.truetype(aw, 64)
        fonts["headline_sm"] = ImageFont.truetype(aw, 48)
        fonts["headline_italic"] = ImageFont.truetype(aw, 72)
        fonts["body_lg"] = ImageFont.truetype(smb, 48)
        fonts["body"] = ImageFont.truetype(sm, 42)
        fonts["body_sm"] = ImageFont.truetype(sm, 34)
        fonts["body_bold"] = ImageFont.truetype(smb, 42)
        fonts["caption"] = ImageFont.truetype(qr, 28)
        fonts["handle"] = ImageFont.truetype(qr, 24)
        fonts["display_name"] = ImageFont.truetype(qb, 32)
        fonts["header"] = ImageFont.truetype(qr, 22)
        fonts["footer"] = ImageFont.truetype(qr, 22)
        if os.path.exists(cv):
            fonts["hand_lg"] = ImageFont.truetype(cv, 58)
            fonts["hand_md"] = ImageFont.truetype(cv, 48)
            fonts["hand_sm"] = ImageFont.truetype(cv, 40)
        else:
            fonts["hand_lg"] = ImageFont.truetype(qr, 44)
            fonts["hand_md"] = ImageFont.truetype(qr, 36)
            fonts["hand_sm"] = ImageFont.truetype(qr, 30)
    except Exception as e:
        print(f"Warning: Font loading issue ({e}), falling back to defaults")
        default = ImageFont.load_default()
        for key in ["headline_xl", "headline_lg", "headline_md", "headline_sm",
                     "headline_italic", "body_lg", "body", "body_sm", "body_bold",
                     "caption", "handle", "display_name", "header", "footer",
                     "hand_lg", "hand_md", "hand_sm"]:
            fonts[key] = default

    return fonts


# -- Drawing Helpers ----------------------------------------------------------

def hex_to_rgb(hex_color):
    if isinstance(hex_color, tuple):
        return hex_color
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def create_circular_image(image, size):
    big = size * 2
    image = image.resize((big, big), Image.LANCZOS)
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, big, big), fill=255)
    output = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    output.paste(image, (0, 0), mask)
    return output.resize((size, size), Image.LANCZOS)


def draw_particle_network(img, seed=42, count=70, connection_dist=140):
    """Render Skyframe-style particle network: yellow/cyan dots with connection lines."""
    import random as _rng
    _rng.seed(seed)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    particles = []
    for _ in range(count):
        x = _rng.randint(0, SLIDE_WIDTH)
        y = _rng.randint(0, SLIDE_HEIGHT)
        is_cyan = _rng.random() < 0.3
        color = (0, 255, 255) if is_cyan else (255, 255, 0)
        radius = _rng.uniform(1.0, 3.0)
        alpha = int(_rng.uniform(0.25, 0.65) * 255)
        particles.append((x, y, color, radius, alpha))

    for i, (x1, y1, c1, _, _) in enumerate(particles):
        for j, (x2, y2, c2, _, _) in enumerate(particles):
            if j <= i:
                continue
            dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
            if dist < connection_dist:
                line_alpha = int((1 - dist / connection_dist) * 0.12 * 255)
                lc = c2 if c2 == (0, 255, 255) else c1
                draw.line([(x1, y1), (x2, y2)], fill=(*lc, line_alpha), width=1)

    for x, y, color, radius, alpha in particles:
        r = int(radius)
        glow_r = r + 4
        draw.ellipse([(x - glow_r, y - glow_r), (x + glow_r, y + glow_r)], fill=(*color, alpha // 3))
        draw.ellipse([(x - r, y - r), (x + r, y + r)], fill=(*color, alpha))

    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"), (0, 0))


def draw_gradient_bar(img, y, height, color_left, color_right):
    left_rgb = hex_to_rgb(color_left)
    right_rgb = hex_to_rgb(color_right)
    pixels = img.load()
    for x in range(SLIDE_WIDTH):
        ratio = x / SLIDE_WIDTH
        r = int(left_rgb[0] + (right_rgb[0] - left_rgb[0]) * ratio)
        g = int(left_rgb[1] + (right_rgb[1] - left_rgb[1]) * ratio)
        b = int(left_rgb[2] + (right_rgb[2] - left_rgb[2]) * ratio)
        for dy in range(height):
            pixels[x, y + dy] = (r, g, b)


def draw_curved_arrow(draw, start, end, color, width=3):
    sx, sy = start
    ex, ey = end
    cx = (sx + ex) // 2 + (ey - sy) // 3
    cy = (sy + ey) // 2 - (ex - sx) // 3
    points = []
    for t_i in range(21):
        t = t_i / 20.0
        x = (1-t)**2 * sx + 2*(1-t)*t * cx + t**2 * ex
        y = (1-t)**2 * sy + 2*(1-t)*t * cy + t**2 * ey
        points.append((x, y))
    for i in range(len(points)-1):
        draw.line([points[i], points[i+1]], fill=hex_to_rgb(color), width=width)
    angle = math.atan2(ey - points[-2][1], ex - points[-2][0])
    arrow_len = 18
    for offset in [-0.5, 0.5]:
        a = angle + math.pi + offset
        ax = ex + arrow_len * math.cos(a)
        ay = ey + arrow_len * math.sin(a)
        draw.line([(ex, ey), (ax, ay)], fill=hex_to_rgb(color), width=width)


def wrap_text(text, font, max_width, draw):
    words = text.split()
    lines = []
    current_line = []
    for word in words:
        test_line = " ".join(current_line + [word])
        bbox = draw.textbbox((0, 0), test_line, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(" ".join(current_line))
            current_line = [word]
    if current_line:
        lines.append(" ".join(current_line))
    return lines


def get_line_height(font, draw, spacing=1.4):
    bbox = draw.textbbox((0, 0), "Ag", font=font)
    return int((bbox[3] - bbox[1]) * spacing)


def get_text_height(text, font, max_width, draw, line_spacing=1.4):
    lines = wrap_text(text, font, max_width, draw)
    if not lines:
        return 0
    return get_line_height(font, draw, line_spacing) * len(lines)


def draw_rich_text(draw, text, xy, font, default_color, accent_color, max_width,
                   line_spacing=1.25, align="left", accent_font=None):
    """Draw text with *accent* word highlighting."""
    x, y = xy
    if accent_font is None:
        accent_font = font

    segments = []
    parts = text.split("*")
    for i, part in enumerate(parts):
        if part:
            segments.append((part, i % 2 == 1))

    colored_words = []
    for seg_text, is_accent in segments:
        words = seg_text.split()
        for w in words:
            colored_words.append((w, accent_color if is_accent else default_color,
                                  accent_font if is_accent else font))

    lines = []
    current_line = []
    for word, color, wfont in colored_words:
        test_text = " ".join([w for w, _, _ in current_line] + [word])
        bbox = draw.textbbox((0, 0), test_text, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current_line.append((word, color, wfont))
        else:
            if current_line:
                lines.append(current_line)
            current_line = [(word, color, wfont)]
    if current_line:
        lines.append(current_line)

    lh = get_line_height(font, draw, line_spacing)

    for line in lines:
        full_text = " ".join([w for w, _, _ in line])
        if align == "center":
            bbox = draw.textbbox((0, 0), full_text, font=font)
            line_w = bbox[2] - bbox[0]
            draw_x = x + (max_width - line_w) // 2
        else:
            draw_x = x

        for i, (word, color, wfont) in enumerate(line):
            draw.text((draw_x, y), word, font=wfont, fill=hex_to_rgb(color))
            bbox = draw.textbbox((0, 0), word + " ", font=wfont)
            draw_x += bbox[2] - bbox[0]

        y += lh

    return y


def draw_wrapped_text(draw, text, xy, font, fill, max_width, line_spacing=1.4, align="left"):
    x, y = xy
    lines = wrap_text(text, font, max_width, draw)
    lh = get_line_height(font, draw, line_spacing)
    for line in lines:
        if align == "center":
            bbox = draw.textbbox((0, 0), line, font=font)
            lw = bbox[2] - bbox[0]
            dx = x + (max_width - lw) // 2
        else:
            dx = x
        draw.text((dx, y), line, font=font, fill=fill)
        y += lh
    return y


def load_and_fit_image(image_path, max_width, max_height, radius=16):
    img = Image.open(image_path).convert("RGBA")
    ratio = min(max_width / img.width, max_height / img.height)
    new_w = int(img.width * ratio)
    new_h = int(img.height * ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    mask = Image.new("L", (new_w, new_h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([(0, 0), (new_w, new_h)], radius=radius, fill=255)
    output = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 0))
    output.paste(img, (0, 0), mask)
    return output


def resolve_image_path(image_name, carousel_dir):
    """Resolve image path: 'asset:foo.png' looks in assets/, otherwise reference/ then root."""
    if image_name.startswith("asset:"):
        return ASSETS_DIR / image_name[6:]
    ref_path = carousel_dir / "reference" / image_name
    if ref_path.exists():
        return ref_path
    root_path = carousel_dir / image_name
    if root_path.exists():
        return root_path
    return ref_path


# -- Background Creation (template-aware) ------------------------------------

_slide_seed = 0

def create_slide_bg(palette, template=None):
    """Create slide background based on template style."""
    global _slide_seed
    _slide_seed += 1

    bg_color = hex_to_rgb(palette["bg"])
    img = Image.new("RGB", (SLIDE_WIDTH, SLIDE_HEIGHT), bg_color)

    bg_cfg = template.get("background", {}) if template else {}
    style = bg_cfg.get("style", "particles")

    if style == "particles":
        # Radial glow
        if bg_cfg.get("radial_glow", True):
            glow = Image.new("RGBA", (SLIDE_WIDTH, SLIDE_HEIGHT), (0, 0, 0, 0))
            glow_draw = ImageDraw.Draw(glow)
            glow_draw.ellipse(
                [int(SLIDE_WIDTH * 0.3) - 500, SLIDE_HEIGHT // 2 - 600,
                 int(SLIDE_WIDTH * 0.3) + 500, SLIDE_HEIGHT // 2 + 600],
                fill=(17, 17, 17, 60),
            )
            glow = glow.filter(ImageFilter.GaussianBlur(180))
            img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

        count = bg_cfg.get("particle_count", 70)
        conn = bg_cfg.get("connection_dist", 140)
        draw_particle_network(img, seed=_slide_seed * 7 + 42, count=count, connection_dist=conn)

    # "flat" style: just the solid color, nothing added

    return img


# -- Chrome Drawing (template-aware) -----------------------------------------

def draw_chrome(img, draw, config, slide, fonts, palette, template=None):
    """Draw all slide chrome: header, footer, progress bar."""
    chrome_cfg = template.get("chrome", {}) if template else {}
    tag_style = chrome_cfg.get("tag_style", "outline_badge")

    if tag_style == "inline_header":
        _draw_inline_header(draw, config, slide, fonts, palette, chrome_cfg)
    else:
        _draw_outline_badge(draw, slide, fonts, palette)

    # Footer
    _draw_footer(img, draw, config, slide, fonts, palette)

    # Progress bar
    if chrome_cfg.get("progress_bar", False):
        total = config.get("total_slides", 1)
        current = slide.get("number", 1)
        _draw_progress_bar(draw, total, current, palette)


def _draw_outline_badge(draw, slide, fonts, palette):
    """Skyframe-style: outlined tag badge upper-left, muted text upper-right."""
    tag_font = fonts.get("header") or fonts["caption"]
    tag_color = hex_to_rgb(palette["tag_outline"])

    tag = slide.get("tag", "")
    if tag:
        tag = tag.upper()
        tag_bbox = draw.textbbox((0, 0), tag, font=tag_font)
        tag_w = tag_bbox[2] - tag_bbox[0]
        tag_h = tag_bbox[3] - tag_bbox[1]
        tag_top_offset = tag_bbox[1]
        pad_x, pad_y = 12, 6
        box_x = PADDING
        box_y = 36
        draw.rounded_rectangle(
            [(box_x, box_y), (box_x + tag_w + pad_x * 2, box_y + tag_h + pad_y * 2)],
            radius=4, outline=tag_color, width=1,
        )
        draw.text((box_x + pad_x, box_y + pad_y - tag_top_offset), tag, font=tag_font, fill=tag_color)

    upper_right = slide.get("upper_right", "")
    if upper_right:
        muted = hex_to_rgb(palette["text_muted"])
        ur_bbox = draw.textbbox((0, 0), upper_right, font=tag_font)
        ur_w = ur_bbox[2] - ur_bbox[0]
        ur_top_offset = ur_bbox[1]
        ur_x = SLIDE_WIDTH - PADDING - IG_RIGHT_INSET - ur_w
        ur_y = 36 + 6 - ur_top_offset
        draw.text((ur_x, ur_y), upper_right, font=tag_font, fill=muted)


def _draw_inline_header(draw, config, slide, fonts, palette, chrome_cfg):
    """Plain-style inline header: '* TAG // TOPIC' left + 'N / M' right."""
    hdr_font = fonts.get("header") or fonts["caption"]
    accent_rgb = hex_to_rgb(palette["accent"])
    muted_rgb = hex_to_rgb(palette["text_muted"])

    # Build header text. If tag and topic are identical (or topic isn't set),
    # show only once — otherwise we get "PROJECT ARES // PROJECT ARES" when the
    # canvas node sets tag but leaves topic unset (topic falls back to tag).
    tag = (slide.get("tag") or "").strip()
    topic = (slide.get("topic") or "").strip()
    if tag and topic and tag.lower() != topic.lower():
        header_text = f"{tag}  //  {topic}".upper()
    else:
        header_text = (tag or topic).upper()

    # Draw with accent on the leading star marker
    y = 40
    star = "* "
    draw.text((PADDING, y), star, font=hdr_font, fill=accent_rgb)
    star_bbox = draw.textbbox((0, 0), star, font=hdr_font)
    star_w = star_bbox[2] - star_bbox[0]
    draw.text((PADDING + star_w, y), header_text, font=hdr_font, fill=muted_rgb)
    # Slide counter: N / M
    if chrome_cfg.get("slide_counter", False):
        total = config.get("total_slides", 1)
        current = slide.get("number", 1)
        counter = f"{current} / {total}"
        c_bbox = draw.textbbox((0, 0), counter, font=hdr_font)
        c_w = c_bbox[2] - c_bbox[0]
        draw.text((SLIDE_WIDTH - PADDING - c_w, y), counter, font=hdr_font, fill=muted_rgb)


def _draw_footer(img, draw, config, slide, fonts, palette):
    """Bottom-left handle + bottom-right text."""
    muted = hex_to_rgb(palette["text_muted"])
    row_center_y = SLIDE_HEIGHT - 60

    handle = slide.get("handle_overlay") or config["profile"]["handle"]
    handle_font = fonts.get("footer") or fonts["caption"]
    handle_bbox = draw.textbbox((0, 0), handle, font=handle_font)
    handle_text_h = handle_bbox[3] - handle_bbox[1]
    handle_top_offset = handle_bbox[1]
    handle_y = row_center_y - handle_text_h // 2 - handle_top_offset
    draw.text((PADDING, handle_y), handle, font=handle_font, fill=muted)

    slide_type = slide.get("type", "body")
    default_right = "save for later" if slide_type in ("cta", "cta_follow") else "swipe for more"
    right_text = slide.get("lower_right", default_right)
    if right_text:
        right_font = fonts.get("footer") or fonts["caption"]
        right_bbox = draw.textbbox((0, 0), right_text, font=right_font)
        right_w = right_bbox[2] - right_bbox[0]
        right_text_h = right_bbox[3] - right_bbox[1]
        right_top_offset = right_bbox[1]
        right_x = SLIDE_WIDTH - PADDING - IG_RIGHT_INSET - right_w
        right_y = row_center_y - right_text_h // 2 - right_top_offset
        draw.text((right_x, right_y), right_text, font=right_font, fill=muted)


def _draw_progress_bar(draw, total, current, palette):
    """Dash-style progress bar above footer."""
    bar_y = SLIDE_HEIGHT - 92
    bar_width = SLIDE_WIDTH - PADDING * 2
    segment_gap = 8
    segment_w = max(10, (bar_width - (total - 1) * segment_gap) // total)

    accent_rgb = hex_to_rgb(palette["accent"])
    muted_rgb = hex_to_rgb(palette.get("border", palette["text_muted"]))

    for i in range(total):
        x = PADDING + i * (segment_w + segment_gap)
        color = accent_rgb if i < current else muted_rgb
        draw.rounded_rectangle(
            [(x, bar_y), (x + segment_w, bar_y + 3)],
            radius=2, fill=color,
        )


# -- Blockquote Text Drawing (Plain-style editorial) --------------------------

def draw_blockquote_text(draw, text, xy, font, fill, accent_color, max_width,
                         line_spacing=1.4, accent_font=None):
    """Draw text with a left border bar (blockquote style) and *accent* highlighting."""
    x, y = xy
    bar_x = x
    text_x = x + 24  # indent past the bar
    inner_width = max_width - 24

    # Measure total height first
    clean = text.replace("*", "")
    total_h = get_text_height(clean, font, inner_width, draw, line_spacing)

    # Draw the left bar
    bar_color = hex_to_rgb(accent_color) if isinstance(accent_color, str) else accent_color
    draw.rounded_rectangle(
        [(bar_x, y), (bar_x + 3, y + total_h)],
        radius=2, fill=bar_color,
    )

    # Draw text with accent highlighting
    if accent_font is None:
        accent_font = font
    end_y = draw_rich_text(
        draw, text, (text_x, y),
        font, fill, accent_color, inner_width,
        line_spacing=line_spacing, accent_font=accent_font,
    )
    return end_y


# -- Slide Renderers ----------------------------------------------------------

def render_hook_slide(config, slide, fonts, carousel_dir, palette, template=None):
    chrome_cfg = template.get("chrome", {}) if template else {}
    use_italic = chrome_cfg.get("accent_italic", False)
    accent_font = fonts.get("headline_italic") if use_italic else None

    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    if slide.get("image"):
        image_path = resolve_image_path(slide["image"], carousel_dir)
        if image_path.exists():
            hook_img = Image.open(str(image_path)).convert("RGBA")
            cover_ratio = 0.62
            ratio = SLIDE_WIDTH / hook_img.width
            new_w = int(hook_img.width * ratio)
            new_h = int(hook_img.height * ratio)
            hook_img = hook_img.resize((new_w, new_h), Image.LANCZOS)
            crop_h = min(new_h, int(SLIDE_HEIGHT * cover_ratio))
            hook_img = hook_img.crop((0, 0, SLIDE_WIDTH, crop_h))

            bg_sample = img.getpixel((SLIDE_WIDTH // 2, crop_h))
            bg_r, bg_g, bg_b = bg_sample[0], bg_sample[1], bg_sample[2]

            gradient = Image.new("RGBA", hook_img.size, (0, 0, 0, 0))
            fade_start = 0.65
            for y_pos in range(hook_img.height):
                progress = y_pos / hook_img.height
                if progress < fade_start:
                    alpha = 0
                else:
                    t = (progress - fade_start) / (1.0 - fade_start)
                    alpha = int(min(255, t * t * t * 800))
                for x_pos in range(hook_img.width):
                    gradient.putpixel((x_pos, y_pos), (bg_r, bg_g, bg_b, alpha))
            hook_img = Image.alpha_composite(hook_img, gradient)
            img.paste(hook_img.convert("RGB"), (0, 0))
            draw = ImageDraw.Draw(img)

    # For Plain (Blue/Black/White): large serif headline + blockquote body below.
    # Triggered by chrome.blockquote_body — applies to any template using the editorial layout.
    is_plain_style = chrome_cfg.get("blockquote_body", False)

    if is_plain_style and not slide.get("image"):
        # Plain-style cover: headline in top half, blockquote body below
        hook_text = slide.get("text", "")
        subtitle = slide.get("subtitle", "")

        # Headline
        text_font = fonts["headline_xl"]
        text_y = 160
        y_end = draw_rich_text(
            draw, hook_text, (PADDING, text_y),
            text_font, palette["text"], palette["accent"],
            CONTENT_WIDTH, line_spacing=1.15, accent_font=accent_font,
        )

        # Subtitle as blockquote
        if subtitle:
            sub_y = y_end + 50
            draw_blockquote_text(
                draw, subtitle, (PADDING, sub_y),
                fonts["body"], hex_to_rgb(palette["text"]),
                palette["accent"], CONTENT_WIDTH,
                line_spacing=1.5, accent_font=fonts.get("body_bold"),
            )

        # Swipe CTA at bottom (above footer chrome)
        swipe_cta = slide.get("swipe_cta", "SWIPE FOR MORE -->")
        if swipe_cta:
            cta_font = fonts.get("header") or fonts["caption"]
            cta_upper = swipe_cta.upper()
            cta_bbox = draw.textbbox((0, 0), cta_upper, font=cta_font)
            cta_w = cta_bbox[2] - cta_bbox[0]
            cta_x = SLIDE_WIDTH - PADDING - cta_w
            cta_y = SLIDE_HEIGHT - 160
            draw.text((cta_x, cta_y), cta_upper, font=cta_font,
                       fill=hex_to_rgb(palette["text_muted"]))
    else:
        # Skyframe hook: uppercase headline at bottom
        hook_text = slide["text"].upper()
        text_font = fonts["headline_xl"]

        text_h = get_text_height(hook_text.replace("*", ""), text_font, CONTENT_WIDTH, draw, 1.1)
        text_y = SLIDE_HEIGHT - FOOTER_HEIGHT - text_h - 100

        y_end = draw_rich_text(
            draw, hook_text, (PADDING, text_y),
            text_font, palette["text"], palette["accent"],
            CONTENT_WIDTH, line_spacing=1.1, accent_font=accent_font,
        )

        if slide.get("subtitle"):
            sub_font = fonts["body_lg"]
            sub_text = slide["subtitle"]
            sub_y = y_end + 20
            draw_wrapped_text(
                draw, sub_text, (PADDING, sub_y), sub_font,
                hex_to_rgb(palette["text_muted"]), CONTENT_WIDTH, line_spacing=1.3,
            )

        if slide.get("annotation"):
            ann_font = fonts["hand_lg"]
            ann_y = y_end + 16
            draw.text((PADDING, ann_y), slide["annotation"], font=ann_font,
                       fill=hex_to_rgb(palette["accent"]))
            ann_bbox = draw.textbbox((0, 0), slide["annotation"], font=ann_font)
            ann_w = ann_bbox[2] - ann_bbox[0]
            arrow_start = (PADDING + ann_w + 20, ann_y + 25)
            arrow_end = (PADDING + ann_w + 110, ann_y + 20)
            draw_curved_arrow(draw, arrow_start, arrow_end, palette["accent"], width=3)

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


def _measure_body_content(slide, fonts, draw, carousel_dir, max_width):
    blocks = []
    GAP = 28

    has_image = False
    if slide.get("image"):
        image_path = resolve_image_path(slide["image"], carousel_dir)
        has_image = image_path.exists()

    content_count = sum([
        bool(slide.get("title")),
        bool(slide.get("text")),
        has_image,
        bool(slide.get("bullets")),
    ])
    is_sparse = content_count <= 2 and not has_image

    if slide.get("title"):
        title_font = fonts["headline_xl"] if is_sparse else fonts["headline_lg"]
        title = slide["title"].upper()
        clean = title.replace("*", "")
        if not clean.endswith("."):
            clean += "."
        th = get_text_height(clean, title_font, max_width, draw, 1.1)
        blocks.append(("title", th + 40, {"font": title_font, "sparse": is_sparse}))

    if slide.get("text"):
        text_font = fonts["body_lg"] if is_sparse else fonts["body"]
        line_sp = 1.6 if is_sparse else 1.5
        clean = slide["text"].replace("*", "")
        th = get_text_height(clean, text_font, max_width, draw, line_sp)
        blocks.append(("text", th + GAP, {"font": text_font, "line_spacing": line_sp}))

    if has_image:
        blocks.append(("image", 0, {"expandable": True}))

    if slide.get("annotation"):
        ann_font = fonts["hand_md"]
        ah = get_text_height(slide["annotation"], ann_font, max_width, draw, 1.3)
        blocks.append(("annotation", ah + 20, {"font": ann_font}))

    if slide.get("bullets"):
        bullet_font = fonts["body_lg"] if is_sparse else fonts["body"]
        total_bh = 0
        for bullet in slide["bullets"]:
            btext = bullet.replace("*", "")
            bh = get_text_height(btext, bullet_font, max_width - 44, draw, 1.35)
            total_bh += bh
        num_gaps = len(slide["bullets"]) - 1
        bullet_gap = 36 if is_sparse else 28
        total_bh += num_gaps * bullet_gap + 12
        blocks.append(("bullets", total_bh, {"font": bullet_font, "gap": bullet_gap}))

    return blocks, is_sparse


def render_body_slide(config, slide, fonts, carousel_dir, palette, template=None):
    chrome_cfg = template.get("chrome", {}) if template else {}
    use_italic = chrome_cfg.get("accent_italic", False)
    use_blockquote = chrome_cfg.get("blockquote_body", False)
    accent_font = fonts.get("headline_italic") if use_italic else None

    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    usable_top = PADDING + (40 if chrome_cfg.get("slide_counter") else 0)
    usable_bottom = SLIDE_HEIGHT - FOOTER_HEIGHT - 40
    usable_height = usable_bottom - usable_top

    blocks, is_sparse = _measure_body_content(slide, fonts, draw, carousel_dir, CONTENT_WIDTH)

    has_image = False
    image_path = None
    if slide.get("image"):
        image_path = resolve_image_path(slide["image"], carousel_dir)
        has_image = image_path.exists()

    fixed_height = sum(b[1] for b in blocks if b[0] != "image")
    block_gaps = max(0, len(blocks) - 1) * 20

    if has_image:
        src_img = Image.open(str(image_path))
        aspect = src_img.width / max(1, src_img.height)
        is_logo = (0.5 < aspect < 2.0) and slide.get("bullets")
        if is_logo:
            img_max_h = 150
        else:
            available_for_image = usable_height - fixed_height - block_gaps
            img_max_h = max(300, min(900, available_for_image))
        src_img.close()
    else:
        img_max_h = 0

    total_height = fixed_height + block_gaps
    if has_image:
        body_img = load_and_fit_image(str(image_path), CONTENT_WIDTH, img_max_h, radius=12)
        actual_img_h = body_img.height
        total_height += actual_img_h
    else:
        body_img = None
        actual_img_h = 0

    y_start = usable_top + max(0, (usable_height - total_height) // 2)
    if is_sparse:
        y_start = min(y_start, int(SLIDE_HEIGHT * 0.35))
    else:
        y_start = min(y_start, int(SLIDE_HEIGHT * 0.20))
    y_start = max(usable_top, y_start)

    y = y_start

    remaining_space = usable_height - total_height
    num_gaps = max(1, len(blocks) - 1)
    extra_gap = max(0, min(40, remaining_space // num_gaps))
    inter_gap = 20 + extra_gap

    if slide.get("title"):
        title = slide["title"].upper()
        title_font = fonts["headline_xl"] if is_sparse else fonts["headline_lg"]

        if "*" in title:
            marked_title = title
        else:
            if not title.endswith("."):
                title += "."
            title_parts = title.rsplit(" ", 1)
            if len(title_parts) == 2:
                marked_title = title_parts[0] + " *" + title_parts[1] + "*"
            else:
                marked_title = title

        y = draw_rich_text(
            draw, marked_title, (PADDING, y),
            title_font, palette["text"], palette["accent"],
            CONTENT_WIDTH, line_spacing=1.1, accent_font=accent_font,
        )

        if not use_blockquote:
            # Skyframe: accent underline bar
            draw.rounded_rectangle(
                [(PADDING, y + 8), (PADDING + 80, y + 14)],
                radius=3, fill=hex_to_rgb(palette["accent"]),
            )
        y += 32 + extra_gap // 2

    if slide.get("text"):
        text_font = fonts["headline_sm"] if is_sparse else fonts["body"]
        text_color = palette["text"]
        line_sp = 1.4 if is_sparse else 1.5

        if use_blockquote:
            y = draw_blockquote_text(
                draw, slide["text"], (PADDING, y),
                text_font, hex_to_rgb(text_color),
                palette["accent"], CONTENT_WIDTH,
                line_spacing=line_sp, accent_font=fonts.get("body_bold"),
            )
        else:
            y = draw_rich_text(
                draw, slide["text"], (PADDING, y),
                text_font, text_color, palette["accent"],
                CONTENT_WIDTH, line_spacing=line_sp,
            )
        y += inter_gap

    if has_image and body_img is not None:
        src_check = Image.open(str(image_path))
        logo_aspect = src_check.width / max(1, src_check.height)
        is_logo_img = (0.5 < logo_aspect < 2.0) and slide.get("bullets")
        src_check.close()

        if not is_logo_img:
            shadow = Image.new("RGBA", (body_img.width + 20, body_img.height + 20), (0, 0, 0, 0))
            shadow_base = Image.new("RGBA", (body_img.width, body_img.height), (0, 0, 0, 60))
            shadow.paste(shadow_base, (10, 10))
            shadow = shadow.filter(ImageFilter.GaussianBlur(8))
            paste_x = PADDING
            paste_y = y
            crop_right = min(SLIDE_WIDTH, paste_x + shadow.width)
            crop_bottom = min(SLIDE_HEIGHT, paste_y + shadow.height)
            if crop_right > paste_x and crop_bottom > paste_y:
                bg_crop = img.convert("RGBA").crop((paste_x, paste_y, crop_right, crop_bottom))
                shadow_crop = shadow.crop((0, 0, crop_right - paste_x, crop_bottom - paste_y))
                composited = Image.alpha_composite(bg_crop, shadow_crop)
                img.paste(composited.convert("RGB"), (paste_x, paste_y))

        img_x = PADDING + (CONTENT_WIDTH - body_img.width) // 2
        img.paste(body_img, (img_x, y), body_img)
        draw = ImageDraw.Draw(img)
        y += body_img.height + inter_gap

    if slide.get("annotation"):
        ann_font = fonts["hand_md"]
        ann_text = slide["annotation"]
        draw.text((PADDING + 20, y), ann_text, font=ann_font,
                   fill=hex_to_rgb(palette["accent"]))
        ann_bbox = draw.textbbox((0, 0), ann_text, font=ann_font)
        ann_w = ann_bbox[2] - ann_bbox[0]
        arrow_start = (PADDING + 20 + ann_w + 10, y + 20)
        arrow_end = (PADDING + 20 + ann_w + 60, y + 55)
        draw_curved_arrow(draw, arrow_start, arrow_end, palette["accent"], width=3)
        y += 50

    if slide.get("bullets"):
        bullet_font = fonts["body_lg"] if is_sparse else fonts["body"]
        bullets = slide["bullets"]

        bullet_heights = []
        for bullet in bullets:
            btext = bullet.replace("*", "")
            bh = get_text_height(btext, bullet_font, CONTENT_WIDTH - 44, draw, 1.35)
            bullet_heights.append(bh)

        total_bullet_h = sum(bullet_heights)
        remaining = usable_bottom - y - 20
        raw_gap = (remaining - total_bullet_h) // max(1, len(bullets))
        gap = max(24, min(raw_gap, 100))

        bullet_y = y + 12

        for i, bullet in enumerate(bullets):
            dot_y = bullet_y + 14
            draw.ellipse(
                [(PADDING, dot_y), (PADDING + 14, dot_y + 14)],
                fill=hex_to_rgb(palette["accent"]),
            )
            end_y = draw_rich_text(
                draw, bullet, (PADDING + 44, bullet_y),
                bullet_font, palette["text"], palette["accent"],
                CONTENT_WIDTH - 44, line_spacing=1.35,
            )
            bullet_y = end_y + gap

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


def render_cta_slide(config, slide, fonts, carousel_dir, palette, template=None):
    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    center_x = SLIDE_WIDTH // 2

    headshot = Image.open(HEADSHOT_PATH).convert("RGBA")
    hs_size = 240
    headshot_circle = create_circular_image(headshot, hs_size)

    ring_size = hs_size + 20
    ring = Image.new("RGBA", (ring_size, ring_size), (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring)
    ring_draw.ellipse([(0, 0), (ring_size, ring_size)], fill=hex_to_rgb(palette["accent"]) + (40,))
    ring_draw.ellipse([(8, 8), (ring_size - 8, ring_size - 8)], fill=(0, 0, 0, 0))

    content_h = 740
    usable_top = PADDING + 8
    footer_y = SLIDE_HEIGHT - 70
    hs_y = usable_top + (footer_y - usable_top - content_h) // 2
    img.paste(ring, (center_x - ring_size // 2, hs_y - 8), ring)
    img.paste(headshot_circle, (center_x - hs_size // 2, hs_y), headshot_circle)

    name = config["profile"]["display_name"]
    name_font = fonts["headline_md"]
    name_y = hs_y + hs_size + 40
    draw.text((center_x, name_y), name, font=name_font,
              fill=hex_to_rgb(palette["text"]), anchor="mt")

    handle = config["profile"]["handle"]
    h_font = fonts["body_sm"]
    h_bbox = draw.textbbox((0, 0), handle, font=h_font)
    h_w = h_bbox[2] - h_bbox[0]
    handle_y = name_y + 72
    draw.text(((SLIDE_WIDTH - h_w) // 2, handle_y), handle, font=h_font,
              fill=hex_to_rgb(palette["text_muted"]))

    div_y = handle_y + 64
    div_w = 120
    draw.rounded_rectangle(
        [(center_x - div_w // 2, div_y), (center_x + div_w // 2, div_y + 3)],
        radius=2, fill=hex_to_rgb(palette["accent"]),
    )

    cta_text = slide.get("text", "Follow for more")
    cta_font = fonts["body_lg"]
    cta_y = div_y + 52
    draw_wrapped_text(
        draw, cta_text, (PADDING + 20, cta_y), cta_font,
        hex_to_rgb(palette["text"]), CONTENT_WIDTH - 40, line_spacing=1.4, align="center",
    )

    if slide.get("button_text"):
        btn_text = slide["button_text"]
        btn_font = fonts["body"]
        btn_bbox = draw.textbbox((0, 0), btn_text, font=btn_font)
        btn_text_w = btn_bbox[2] - btn_bbox[0]
        btn_text_h = btn_bbox[3] - btn_bbox[1]
        btn_text_y_offset = btn_bbox[1]
        btn_w = btn_text_w + 80
        btn_h = btn_text_h + 48
        btn_x = center_x - btn_w // 2
        btn_y = cta_y + get_text_height(cta_text, cta_font, CONTENT_WIDTH - 40, draw, 1.4) + 56
        draw.rounded_rectangle(
            [(btn_x, btn_y), (btn_x + btn_w, btn_y + btn_h)],
            radius=btn_h // 2, fill=hex_to_rgb(palette["accent_secondary"]),
        )
        btn_text_x = btn_x + (btn_w - btn_text_w) // 2
        btn_text_y = btn_y + (btn_h - btn_text_h) // 2 - btn_text_y_offset
        draw.text((btn_text_x, btn_text_y), btn_text, font=btn_font,
                   fill=hex_to_rgb(palette["bg"]))

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


def render_image_body_slide(config, slide, fonts, carousel_dir, palette, template=None):
    """Slide with image in an aspect-aware art zone + text above or below."""
    chrome_cfg = template.get("chrome", {}) if template else {}
    use_blockquote = chrome_cfg.get("blockquote_body", False)

    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    aspect = slide.get("art_aspect", "1:1")
    text_pos = slide.get("text_position", "bottom")
    zone_x, zone_y, zone_w, zone_h, text_y = get_art_zone(aspect, text_pos)

    image_path = None
    if slide.get("image"):
        image_path = resolve_image_path(slide["image"], carousel_dir)

    has_image = image_path and image_path.exists()
    if has_image:
        src = Image.open(str(image_path)).convert("RGBA")
        fitted = cover_fit_image(src, zone_w, zone_h)
        if fitted.mode == "RGBA":
            img.paste(fitted, (zone_x, zone_y), fitted)
        else:
            img.paste(fitted, (zone_x, zone_y))

    # Border drawn snug to the zone — always aligns with the Remotion cutout
    border_pad = 6
    draw.rounded_rectangle(
        [(zone_x - border_pad, zone_y - border_pad),
         (zone_x + zone_w + border_pad, zone_y + zone_h + border_pad)],
        radius=12,
        outline=hex_to_rgb(palette["accent"] if has_image else palette["border"]),
        width=2,
    )

    if not has_image:
        ph_font = fonts.get("body_sm", fonts["body"])
        draw.text((zone_x + zone_w // 2, zone_y + zone_h // 2), "IMAGE",
                   font=ph_font, fill=hex_to_rgb(palette["text_muted"]), anchor="mm")

    slide_text = slide.get("text", "")
    if slide_text:
        word_count = len(slide_text.split())
        if word_count <= 6:
            text_font = fonts["body_lg"]
        elif word_count <= 15:
            text_font = fonts["body"]
        else:
            text_font = fonts["body_sm"]
        max_text_w = CONTENT_WIDTH - 40

        if use_blockquote:
            draw_blockquote_text(
                draw, slide_text, (PADDING + 20, text_y),
                text_font, hex_to_rgb(palette["text"]),
                palette["accent"], max_text_w,
                line_spacing=1.4, accent_font=fonts.get("body_bold"),
            )
        else:
            draw_wrapped_text(
                draw, slide_text, (PADDING + 20, text_y), text_font,
                hex_to_rgb(palette["text"]), max_text_w, line_spacing=1.4, align="center",
            )

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


def render_terminal_body_slide(config, slide, fonts, carousel_dir, palette, template=None):
    """Slide with editorial chrome (title + body) plus a styled terminal block.

    Schema for slide["terminal"]:
      header:    "Claude Code v2.1.87"           top header line, white bold
      subtitle:  "Opus 4.6 (1M context) ..."     muted gray
      cwd:       "~/code/my-app"                  muted gray, monospace
      prompt:    "/loop 5m /babysit"             rendered as `> ...`, white bold
      lines:     [{ kind, text }] where kind is one of:
                   success  prefixed with green ✓
                   result   prefixed with accent-color →
                   task|log|gray  rendered in muted gray (no prefix)
                   normal (or omitted)  rendered in body text color

    The terminal zone (x,y,w,h) is recorded on slide["_terminal_zone"] so the
    main render loop can include it in zones.json — Stage 3 will composite an
    animated terminal video into this rectangle.

    When terminal.style == "win95" or template chrome.terminal_style == "win95",
    delegates to a separate Windows-95-themed renderer.
    """
    # Branch to Win95 renderer when style flag is present
    terminal_cfg = slide.get("terminal") or {}
    chrome_terminal_style = (template.get("chrome", {}).get("terminal_style") if template else None)
    if terminal_cfg.get("style") == "win95" or chrome_terminal_style == "win95":
        return render_terminal_body_slide_win95(config, slide, fonts, carousel_dir, palette, template)

    chrome_cfg = template.get("chrome", {}) if template else {}
    use_italic = chrome_cfg.get("accent_italic", False)
    use_blockquote = chrome_cfg.get("blockquote_body", False)
    accent_font = fonts.get("headline_italic") if use_italic else None

    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    usable_top = PADDING + (40 if chrome_cfg.get("slide_counter") else 0)
    usable_bottom = SLIDE_HEIGHT - FOOTER_HEIGHT - 40

    y = usable_top + 20

    # ── Title (headline) — same italic-accent treatment as render_body_slide
    title = slide.get("title", "")
    if title:
        if "*" in title:
            marked_title = title
        else:
            t = title if title.endswith(".") else title + "."
            parts = t.rsplit(" ", 1)
            marked_title = (parts[0] + " *" + parts[1] + "*") if len(parts) == 2 else t
        title_font = fonts["headline_md"]
        y = draw_rich_text(
            draw, marked_title, (PADDING, y),
            title_font, palette["text"], palette["accent"],
            CONTENT_WIDTH, line_spacing=1.1, accent_font=accent_font,
        )
        # Italic accents have deep descenders; reserve half-font-height of breathing
        # room before the next element so "fold." or "sleep." don't collide.
        y += max(32, int(title_font.size * 0.55))

    # ── Body description
    body_text = slide.get("text", "")
    if body_text:
        body_font = fonts["body_sm"]
        if use_blockquote:
            y = draw_blockquote_text(
                draw, body_text, (PADDING, y),
                body_font, hex_to_rgb(palette["text"]),
                palette["accent"], CONTENT_WIDTH,
                line_spacing=1.4, accent_font=fonts.get("body_bold"),
            )
        else:
            draw_wrapped_text(
                draw, body_text, (PADDING, y), body_font,
                hex_to_rgb(palette["text"]), CONTENT_WIDTH, line_spacing=1.4,
            )
            # draw_wrapped_text doesn't return new y, so estimate from line count
            line_count = max(1, len(body_text) // 60)
            y += line_count * int(body_font.size * 1.4)
        y += 32

    # ── Terminal block ─────────────────────────────────────────────────────
    # Fixed 16:9 rectangle vertically centered on the slide. This keeps the
    # viewer's eye on the center regardless of title length and provides a
    # consistent visual rhythm across all terminal slides.
    terminal = slide.get("terminal") or {}
    term_x = PADDING
    term_w = CONTENT_WIDTH                    # 920
    term_h = (term_w * 9) // 16               # 517 — fixed 16:9
    term_y = (SLIDE_HEIGHT - term_h) // 2     # vertically centered
    # If the title overflows into the terminal area, push terminal down to
    # avoid collision (rare with small titles, but safety-net for long titles)
    min_term_y = y + 32  # 32px breathing room after title
    if term_y < min_term_y:
        term_y = min_term_y

    # Custom monospace fonts at terminal-appropriate sizes (slight bump from
    # the previous tighter set — readable at scroll distance)
    mono_path = str(FONT_DIR / "SpaceMono-Regular.ttf")
    mono_bold_path = str(FONT_DIR / "SpaceMono-Bold.ttf")
    f_term_header = ImageFont.truetype(mono_bold_path, 24)
    f_term_sub    = ImageFont.truetype(mono_path, 18)
    f_term_cwd    = ImageFont.truetype(mono_path, 18)
    f_term_prompt = ImageFont.truetype(mono_bold_path, 24)
    f_term_line   = ImageFont.truetype(mono_path, 22)

    pad_inside = 28

    # macOS-style title bar at the top of the terminal block: 3 traffic-light
    # dots on the left + centered hostname text + horizontal divider.
    # Set terminal.title_bar = false explicitly to suppress.
    title_bar_text = terminal.get("title_bar", "root@192.168.1.2")
    if title_bar_text is False:
        title_bar_text = None
    title_bar_h = 52 if title_bar_text else 0

    header_block_h = 0
    if terminal.get("header"):
        header_block_h += 32
        if terminal.get("subtitle"):
            header_block_h += 24
        if terminal.get("cwd"):
            header_block_h += 24
        header_block_h += 10 + 1 + 12  # spacing + separator + spacing

    lines = terminal.get("lines") or []
    line_h_each = 32
    indent = 32  # x-offset reserved for ✓/→ indicators on success/result lines

    # ── Pre-wrap pass: word-wrap every terminal line to fit inside the block.
    # Success/result lines reserve `indent` for the indicator glyph, so their
    # text gets a narrower wrap width. Continuations align under the indented
    # text (standard CLI convention).
    inner_w = term_w - pad_inside * 2
    f_term_line_for_wrap = ImageFont.truetype(mono_path, 22)
    f_term_prompt_for_wrap = ImageFont.truetype(mono_bold_path, 24)

    # Wrap the prompt too — long prompts spilled before this fix as well.
    prompt_rows = []
    if terminal.get("prompt"):
        prompt_str = "> " + terminal["prompt"]
        prompt_rows = wrap_text(prompt_str, f_term_prompt_for_wrap, inner_w, draw) or [prompt_str]
    prompt_h = len(prompt_rows) * line_h_each

    wrapped_lines = []  # list of {kind, rows: [str], indented: bool}
    for line in lines:
        kind = line.get("kind", "normal")
        text = line.get("text", "")
        indented = kind in ("success", "result")
        max_w = inner_w - indent if indented else inner_w
        rows = wrap_text(text, f_term_line_for_wrap, max_w, draw) or [text]
        wrapped_lines.append({"kind": kind, "rows": rows, "indented": indented})

    total_rows = sum(len(wl["rows"]) for wl in wrapped_lines)
    lines_block_h = total_rows * line_h_each

    # term_h is fixed at 16:9 (computed above). The pre-pass above produces
    # wrapped_lines metadata and total_rows, used by the draw loop below to
    # render content within the fixed-height box.

    # Terminal bg: lightened from slide bg for dark themes, slight off-white for light
    def _lighten(hex_c, amt):
        c = hex_c.lstrip("#")
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
        return (min(255, r + amt), min(255, g + amt), min(255, b + amt))

    bg_hex = palette.get("bg", "#000000")
    bg_brightness = sum(int(bg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    is_dark = bg_brightness < 384
    term_bg = _lighten(bg_hex, 18) if is_dark else (245, 245, 250)
    term_border = hex_to_rgb(palette.get("border", "#333333"))

    draw.rounded_rectangle(
        [(term_x, term_y), (term_x + term_w, term_y + term_h)],
        radius=14, fill=term_bg, outline=term_border, width=1,
    )

    # ── macOS-style title bar (3 traffic-light dots + centered hostname + divider)
    if title_bar_text:
        dot_r = 7
        dot_y_center = term_y + title_bar_h // 2
        dot_x_start = term_x + 22
        dot_gap = 22
        traffic_colors = [(255, 95, 86), (255, 189, 46), (39, 201, 63)]  # red, yellow, green
        for i, color in enumerate(traffic_colors):
            cx = dot_x_start + i * dot_gap
            draw.ellipse(
                [(cx - dot_r, dot_y_center - dot_r), (cx + dot_r, dot_y_center + dot_r)],
                fill=color,
            )
        # Centered hostname text
        f_titlebar = ImageFont.truetype(mono_path, 20)
        bbox = draw.textbbox((0, 0), title_bar_text, font=f_titlebar)
        tb_w = bbox[2] - bbox[0]
        tb_h = bbox[3] - bbox[1]
        tb_x = term_x + (term_w - tb_w) // 2
        tb_y = term_y + (title_bar_h - tb_h) // 2 - bbox[1]
        draw.text((tb_x, tb_y), title_bar_text, font=f_titlebar,
                  fill=hex_to_rgb(palette["text_muted"]))
        # Divider line at bottom of title bar
        div_y = term_y + title_bar_h
        draw.line([(term_x, div_y), (term_x + term_w, div_y)],
                  fill=term_border, width=1)

    # ── Inside terminal (start below title bar if present)
    iy = term_y + title_bar_h + pad_inside
    ix = term_x + pad_inside
    iw = term_w - pad_inside * 2

    if terminal.get("header"):
        # Small accent-colored square as a logo placeholder
        dot_size = 14
        draw.rounded_rectangle(
            [(ix, iy + 5), (ix + dot_size, iy + 5 + dot_size)],
            radius=3, fill=hex_to_rgb(palette["accent"]),
        )
        header_x = ix + dot_size + 10
        draw.text((header_x, iy), terminal["header"], font=f_term_header,
                  fill=hex_to_rgb(palette["text"]))
        iy += 32
        if terminal.get("subtitle"):
            draw.text((header_x, iy), terminal["subtitle"], font=f_term_sub,
                      fill=hex_to_rgb(palette["text_muted"]))
            iy += 24
        if terminal.get("cwd"):
            draw.text((header_x, iy), terminal["cwd"], font=f_term_cwd,
                      fill=hex_to_rgb(palette["text_muted"]))
            iy += 24
        iy += 10
        draw.line([(ix, iy), (ix + iw, iy)], fill=term_border, width=1)
        iy += 12

    # ── Stash zone for animation (Stage 3): just the message area below chrome.
    # Animation overlay covers ONLY the typing area, so the baked chrome above
    # (Claude Code header, subtitle, cwd, divider) stays visible immediately
    # without re-typing.
    msg_zone_x = term_x + 4
    msg_zone_y = iy - 4
    msg_zone_w = term_w - 8
    msg_zone_h = (term_y + term_h - pad_inside) - msg_zone_y + 4
    slide["_terminal_zone"] = {
        "x": msg_zone_x, "y": msg_zone_y,
        "w": msg_zone_w, "h": msg_zone_h,
        "aspect": "terminal_msg",
        "term_bg_hex": "#%02x%02x%02x" % term_bg if isinstance(term_bg, tuple) else term_bg,
    }

    if prompt_rows:
        for prow in prompt_rows:
            draw.text((ix, iy), prow, font=f_term_prompt,
                      fill=hex_to_rgb(palette["text"]))
            iy += line_h_each

    success_color = (95, 209, 184)  # teal-green, matches the research-live toggle accent
    text_color = hex_to_rgb(palette["text"])
    muted_color = hex_to_rgb(palette["text_muted"])

    # Success indicator: drawn glyph (a thick green check) — SpaceMono lacks ✓
    def _draw_check(x, y, color, size=18):
        # Two-stroke checkmark: short down-right then long up-right
        s = size
        draw.line([(x, y + int(s * 0.55)), (x + int(s * 0.38), y + s)], fill=color, width=3)
        draw.line([(x + int(s * 0.38), y + s), (x + s, y + int(s * 0.10))], fill=color, width=3)

    for wl in wrapped_lines:
        kind = wl["kind"]
        rows = wl["rows"]
        for row_idx, row_text in enumerate(rows):
            is_first = row_idx == 0
            if kind == "success":
                if is_first:
                    _draw_check(ix, iy + 4, success_color, size=18)
                draw.text((ix + indent, iy), row_text, font=f_term_line, fill=text_color)
            elif kind == "result":
                if is_first:
                    draw.text((ix, iy), "→", font=f_term_line, fill=success_color)
                draw.text((ix + indent, iy), row_text, font=f_term_line, fill=text_color)
            elif kind in ("task", "log", "gray"):
                draw.text((ix, iy), row_text, font=f_term_line, fill=muted_color)
            else:
                draw.text((ix, iy), row_text, font=f_term_line, fill=text_color)
            iy += line_h_each

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


def render_terminal_body_slide_win95(config, slide, fonts, carousel_dir, palette, template=None):
    """Windows-95-themed terminal slide. The terminal window fills most of the
    slide; no editorial title above. Title bar is navy blue with 'Command Prompt'
    + minimize/maximize/close buttons. Inner area is solid black with white
    monospace text. Boot lines (Microsoft 95 banner) render first, then the
    prompt + script content as terminal output.

    Schema additions for win95 (vs the macOS schema):
      terminal.title_bar:   "Command Prompt"
      terminal.boot_lines:  ["Microsoft(R) Windows 95", ...]
      terminal.prompt:      "C:\\WINDOWS>"
      terminal.lines:       [{kind:"normal", text:"..."}]
      terminal.full_slide:  if true, terminal fills most of slide (default)
    """
    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    terminal = slide.get("terminal") or {}
    title_bar_text = terminal.get("title_bar", "Command Prompt")
    boot_lines = terminal.get("boot_lines") or []
    prompt_text = terminal.get("prompt", "C:\\WINDOWS>")
    lines = terminal.get("lines") or []

    # ── Layout: fixed 16:9 window centered vertically on the slide. Keeps
    # the viewer's eye on the center; teal Win95 desktop fills the surrounding
    # space, reinforcing the retro frame.
    win_x = PADDING
    win_w = SLIDE_WIDTH - PADDING * 2          # 920
    win_h = (win_w * 9) // 16                  # 517 — 16:9
    win_y = (SLIDE_HEIGHT - win_h) // 2        # vertically centered

    # ── Win95 chrome colors
    desk_bg = (0, 128, 128)         # teal desktop
    win_face = (192, 192, 192)      # light gray window face
    win_shadow = (128, 128, 128)    # 3D bevel shadow
    win_highlight = (255, 255, 255) # 3D bevel highlight
    title_blue = (0, 0, 128)        # navy title bar
    title_text = (255, 255, 255)    # white title text
    btn_face = (192, 192, 192)
    btn_text = (0, 0, 0)
    inner_bg = (0, 0, 0)            # black terminal inside
    inner_text = (255, 255, 255)    # white terminal text

    # ── Outer window frame: 3D-bevel rectangle (Win95 raised look)
    bevel = 2
    # Highlight (top + left edges)
    draw.rectangle([(win_x, win_y), (win_x + win_w, win_y + bevel)], fill=win_highlight)
    draw.rectangle([(win_x, win_y), (win_x + bevel, win_y + win_h)], fill=win_highlight)
    # Shadow (bottom + right edges)
    draw.rectangle([(win_x, win_y + win_h - bevel), (win_x + win_w, win_y + win_h)], fill=win_shadow)
    draw.rectangle([(win_x + win_w - bevel, win_y), (win_x + win_w, win_y + win_h)], fill=win_shadow)
    # Window face fill (between bevels)
    draw.rectangle(
        [(win_x + bevel, win_y + bevel), (win_x + win_w - bevel, win_y + win_h - bevel)],
        fill=win_face,
    )

    # ── Title bar
    tb_x = win_x + bevel + 3
    tb_y = win_y + bevel + 3
    tb_w = win_w - bevel * 2 - 6
    tb_h = 56
    draw.rectangle([(tb_x, tb_y), (tb_x + tb_w, tb_y + tb_h)], fill=title_blue)

    # Tiny window-icon "logo" placeholder (white square with overlap detail)
    icon_size = 28
    icon_x = tb_x + 10
    icon_y = tb_y + (tb_h - icon_size) // 2
    draw.rectangle([(icon_x, icon_y), (icon_x + icon_size, icon_y + icon_size)], fill=title_text)
    # MS-DOS prompt mark inside the icon
    mono_path = str(FONT_DIR / "SpaceMono-Bold.ttf")
    f_icon = ImageFont.truetype(mono_path, 18)
    draw.text((icon_x + 4, icon_y + 2), "C:_", font=f_icon, fill=title_blue)

    # Title text
    f_title = ImageFont.truetype(mono_path, 26)
    title_x = icon_x + icon_size + 12
    title_y = tb_y + (tb_h - 26) // 2 - 2
    draw.text((title_x, title_y), title_bar_text, font=f_title, fill=title_text)

    # 3 right-side buttons: _ □ X
    btn_w = 44
    btn_h = 36
    btn_gap = 4
    btn_y = tb_y + (tb_h - btn_h) // 2
    btn_labels = ["_", "□", "X"]
    btn_x = tb_x + tb_w - (btn_w * 3 + btn_gap * 2) - 6
    f_btn = ImageFont.truetype(mono_path, 22)
    for i, lbl in enumerate(btn_labels):
        bx = btn_x + i * (btn_w + btn_gap)
        # Button face with bevels
        draw.rectangle([(bx, btn_y), (bx + btn_w, btn_y + 1)], fill=win_highlight)
        draw.rectangle([(bx, btn_y), (bx + 1, btn_y + btn_h)], fill=win_highlight)
        draw.rectangle([(bx, btn_y + btn_h - 1), (bx + btn_w, btn_y + btn_h)], fill=win_shadow)
        draw.rectangle([(bx + btn_w - 1, btn_y), (bx + btn_w, btn_y + btn_h)], fill=win_shadow)
        draw.rectangle([(bx + 1, btn_y + 1), (bx + btn_w - 1, btn_y + btn_h - 1)], fill=btn_face)
        # Label centered
        bb = draw.textbbox((0, 0), lbl, font=f_btn)
        lw = bb[2] - bb[0]
        lh = bb[3] - bb[1]
        draw.text((bx + (btn_w - lw) // 2, btn_y + (btn_h - lh) // 2 - bb[1]), lbl,
                  font=f_btn, fill=btn_text)

    # ── Inner terminal area (black bg, white text)
    inner_pad = 14
    inner_x = win_x + bevel + 3
    inner_y = tb_y + tb_h + 4
    inner_w = win_w - bevel * 2 - 6
    inner_h = (win_y + win_h - bevel - 3) - inner_y
    # Sunken bevel for inner area (reverse of outer bevel)
    draw.rectangle([(inner_x, inner_y), (inner_x + inner_w, inner_y + 1)], fill=win_shadow)
    draw.rectangle([(inner_x, inner_y), (inner_x + 1, inner_y + inner_h)], fill=win_shadow)
    draw.rectangle([(inner_x, inner_y + inner_h - 1), (inner_x + inner_w, inner_y + inner_h)], fill=win_highlight)
    draw.rectangle([(inner_x + inner_w - 1, inner_y), (inner_x + inner_w, inner_y + inner_h)], fill=win_highlight)
    draw.rectangle(
        [(inner_x + 2, inner_y + 2), (inner_x + inner_w - 2, inner_y + inner_h - 2)],
        fill=inner_bg,
    )

    # ── Render boot text + prompt + lines into the inner area
    f_inner = ImageFont.truetype(str(FONT_DIR / "SpaceMono-Regular.ttf"), 24)
    f_inner_bold = ImageFont.truetype(str(FONT_DIR / "SpaceMono-Bold.ttf"), 24)
    line_h = 32
    text_x = inner_x + inner_pad + 4
    text_y = inner_y + inner_pad + 4
    text_max_w = inner_w - inner_pad * 2 - 8

    def _draw_lines(text, x, y, font, fill):
        rows = wrap_text(text, font, text_max_w, draw) or [text]
        for row in rows:
            if y + line_h > inner_y + inner_h - inner_pad:
                return y
            draw.text((x, y), row, font=font, fill=fill)
            y += line_h
        return y

    # Bake all chrome statically — boot banner + prompt — so animation
    # only types the message lines below.
    y = text_y
    for bl in boot_lines:
        y = _draw_lines(bl, text_x, y, f_inner, inner_text)
    if boot_lines:
        y += 12  # blank line after boot banner
    if prompt_text:
        y = _draw_lines(prompt_text, text_x, y, f_inner_bold, inner_text)

    # Capture msg_y_start BEFORE drawing message lines — this is where
    # animation overlay will cover and re-type.
    msg_y_start = y
    msg_x_start = text_x

    # Render message lines so static slide is complete
    for ln in lines:
        y = _draw_lines(ln.get("text", ""), text_x, y, f_inner, inner_text)

    # Stash zone for animation — only the message area, not the chrome
    msg_h = (inner_y + inner_h - inner_pad) - msg_y_start
    slide["_terminal_zone"] = {
        "x": msg_x_start - 4, "y": msg_y_start - 2,
        "w": text_max_w + 8, "h": msg_h + 4,
        "aspect": "win95_msg",
        "term_bg_hex": "#000000",
    }

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


def render_cta_follow_slide(config, slide, fonts, carousel_dir, palette, template=None):
    """CTA slide: image in aspect-aware art zone, optional overlay, CTA text below."""
    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    aspect = slide.get("art_aspect", "1:1")
    zone_x, zone_y, zone_w, zone_h, text_y = get_art_zone(aspect, "bottom")

    image_path = None
    if slide.get("image"):
        image_path = resolve_image_path(slide["image"], carousel_dir)

    has_image = image_path and image_path.exists()
    if has_image:
        src = Image.open(str(image_path)).convert("RGBA")
        fitted = cover_fit_image(src, zone_w, zone_h)
        if fitted.mode == "RGBA":
            img.paste(fitted, (zone_x, zone_y), fitted)
        else:
            img.paste(fitted, (zone_x, zone_y))

    border_pad = 6
    draw.rounded_rectangle(
        [(zone_x - border_pad, zone_y - border_pad),
         (zone_x + zone_w + border_pad, zone_y + zone_h + border_pad)],
        radius=12,
        outline=hex_to_rgb(palette["accent"] if has_image else palette["border"]),
        width=2,
    )

    center_text = slide.get("center_text", "")
    if center_text:
        ct_font = fonts["body_lg"]
        ct_bbox = draw.textbbox((0, 0), center_text, font=ct_font)
        ct_w = ct_bbox[2] - ct_bbox[0]
        ct_h = ct_bbox[3] - ct_bbox[1]
        ct_x = (SLIDE_WIDTH - ct_w) // 2
        ct_y = zone_y + (zone_h - ct_h) // 2
        pad = 24
        draw.rounded_rectangle(
            [(ct_x - pad, ct_y - pad), (ct_x + ct_w + pad, ct_y + ct_h + pad)],
            radius=12,
            fill=hex_to_rgb(palette["bg"]) if palette["bg"] != "#FFFFFF" else (240, 240, 240),
            outline=hex_to_rgb(palette["accent"]), width=2,
        )
        draw.text((ct_x, ct_y - ct_bbox[1]), center_text, font=ct_font,
                   fill=hex_to_rgb(palette["accent"]))

    cta_text = slide.get("text", "Follow for more")
    if cta_text:
        word_count = len(cta_text.split())
        if word_count <= 6:
            text_font = fonts["body_lg"]
        elif word_count <= 15:
            text_font = fonts["body"]
        else:
            text_font = fonts["body_sm"]
        draw_wrapped_text(
            draw, cta_text, (PADDING + 20, text_y), text_font,
            hex_to_rgb(palette["text"]), CONTENT_WIDTH - 40, line_spacing=1.4, align="center",
        )

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


# -- Feature Grid Slide (Plain-style editorial) -------------------------------

def render_feature_grid_slide(config, slide, fonts, carousel_dir, palette, template=None):
    """Grid of bordered feature cards — 2x2 or 1xN layout."""
    chrome_cfg = template.get("chrome", {}) if template else {}
    use_italic = chrome_cfg.get("accent_italic", False)
    accent_font = fonts.get("headline_italic") if use_italic else None

    img = create_slide_bg(palette, template)
    draw = ImageDraw.Draw(img)

    # Title / headline
    y = 100
    title = slide.get("title", "")
    if title:
        title_font = fonts["headline_lg"]
        y = draw_rich_text(
            draw, title, (PADDING, y),
            title_font, palette["text"], palette["accent"],
            CONTENT_WIDTH, line_spacing=1.15, accent_font=accent_font,
        )
        y += 30

    # Optional subtitle as blockquote
    subtitle = slide.get("subtitle", "")
    if subtitle:
        y = draw_blockquote_text(
            draw, subtitle, (PADDING, y),
            fonts["body"], hex_to_rgb(palette["text"]),
            palette["accent"], CONTENT_WIDTH,
            line_spacing=1.5, accent_font=fonts.get("body_bold"),
        )
        y += 40

    # Render cards
    cards = slide.get("cards", [])
    if not cards:
        draw_chrome(img, draw, config, slide, fonts, palette, template)
        return img

    border_rgb = hex_to_rgb(palette["border"])
    accent_rgb = hex_to_rgb(palette["accent"])
    text_rgb = hex_to_rgb(palette["text"])
    muted_rgb = hex_to_rgb(palette["text_muted"])
    card_font = fonts.get("body_bold", fonts["body"])
    label_font = fonts.get("header", fonts["caption"])

    # Determine layout: if cards have a "diagram" parent, draw diagram first
    diagram = slide.get("diagram")
    if diagram:
        y = _draw_diagram_block(draw, diagram, y, fonts, palette)
        y += 30

    # Card grid
    gap = 16
    if len(cards) <= 2:
        # Single row
        card_w = (CONTENT_WIDTH - gap) // 2
        card_h = 100
        for i, card in enumerate(cards):
            cx = PADDING + i * (card_w + gap)
            _draw_card(draw, cx, y, card_w, card_h, card, border_rgb, accent_rgb, text_rgb, muted_rgb, card_font, label_font)
    elif len(cards) <= 4:
        # 2x2 grid
        card_w = (CONTENT_WIDTH - gap) // 2
        card_h = 100
        for i, card in enumerate(cards):
            col = i % 2
            row = i // 2
            cx = PADDING + col * (card_w + gap)
            cy = y + row * (card_h + gap)
            _draw_card(draw, cx, cy, card_w, card_h, card, border_rgb, accent_rgb, text_rgb, muted_rgb, card_font, label_font)
    else:
        # Vertical stack
        card_w = CONTENT_WIDTH
        card_h = 80
        for i, card in enumerate(cards):
            cy = y + i * (card_h + gap)
            _draw_card(draw, PADDING, cy, card_w, card_h, card, border_rgb, accent_rgb, text_rgb, muted_rgb, card_font, label_font)

    draw_chrome(img, draw, config, slide, fonts, palette, template)
    return img


def _draw_card(draw, x, y, w, h, card, border_rgb, accent_rgb, text_rgb, muted_rgb, font, label_font):
    """Draw a single bordered card with optional label + title + subtitle."""
    draw.rounded_rectangle([(x, y), (x + w, y + h)], radius=8, outline=border_rgb, width=1)

    inner_y = y + 14
    inner_x = x + 18

    # Icon (optional — single character/emoji)
    icon = card.get("icon", "")
    if icon:
        draw.text((inner_x, inner_y), icon, font=font, fill=accent_rgb)
        inner_x += 36

    # Label (small uppercase above title)
    label = card.get("label", "")
    if label:
        draw.text((inner_x, inner_y), label.upper(), font=label_font, fill=accent_rgb)
        inner_y += 24

    # Title
    title = card.get("title", "")
    if title:
        draw.text((inner_x, inner_y), title, font=font, fill=text_rgb)
        inner_y += 30

    # Subtitle
    sub = card.get("subtitle", "")
    if sub:
        draw.text((inner_x, inner_y), sub, font=label_font, fill=muted_rgb)


def _draw_diagram_block(draw, diagram, y, fonts, palette):
    """Draw a simple box-and-arrows diagram (parent → children)."""
    border_rgb = hex_to_rgb(palette["border"])
    accent_rgb = hex_to_rgb(palette["accent"])
    text_rgb = hex_to_rgb(palette["text"])
    muted_rgb = hex_to_rgb(palette["text_muted"])

    parent = diagram.get("parent", {})
    children = diagram.get("children", [])

    label_font = fonts.get("header", fonts["caption"])
    title_font = fonts.get("body_bold", fonts["body"])
    sub_font = fonts.get("header", fonts["caption"])

    # Parent box centered
    p_w = 500
    p_h = 100
    p_x = (SLIDE_WIDTH - p_w) // 2
    p_y = y

    draw.rounded_rectangle([(p_x, p_y), (p_x + p_w, p_y + p_h)], radius=8, outline=border_rgb, width=1)

    # Parent content
    p_label = parent.get("label", "")
    p_title = parent.get("title", "")
    p_sub = parent.get("subtitle", "")
    py_inner = p_y + 14
    if p_label:
        label_bbox = draw.textbbox((0, 0), p_label.upper(), font=label_font)
        lw = label_bbox[2] - label_bbox[0]
        draw.text(((SLIDE_WIDTH - lw) // 2, py_inner), p_label.upper(), font=label_font, fill=accent_rgb)
        py_inner += 22
    if p_title:
        t_bbox = draw.textbbox((0, 0), p_title, font=title_font)
        tw = t_bbox[2] - t_bbox[0]
        draw.text(((SLIDE_WIDTH - tw) // 2, py_inner), p_title, font=title_font, fill=text_rgb)
        py_inner += 28
    if p_sub:
        s_bbox = draw.textbbox((0, 0), p_sub.upper(), font=sub_font)
        sw = s_bbox[2] - s_bbox[0]
        draw.text(((SLIDE_WIDTH - sw) // 2, py_inner), p_sub.upper(), font=sub_font, fill=muted_rgb)

    # Arrows
    if children:
        arrow_y_start = p_y + p_h
        arrow_y_end = arrow_y_start + 50
        num_children = len(children)
        child_gap = 12
        child_w = max(200, (CONTENT_WIDTH - (num_children - 1) * child_gap) // num_children)
        total_w = num_children * child_w + (num_children - 1) * child_gap
        start_x = (SLIDE_WIDTH - total_w) // 2

        # Draw arrow lines
        for i in range(num_children):
            cx = start_x + i * (child_w + 16) + child_w // 2
            # Vertical line
            draw.line([(cx, arrow_y_start + 4), (cx, arrow_y_end - 4)], fill=accent_rgb, width=2)
            # Arrow head
            draw.polygon([
                (cx, arrow_y_end),
                (cx - 6, arrow_y_end - 10),
                (cx + 6, arrow_y_end - 10),
            ], fill=accent_rgb)

        # Draw child boxes
        child_h = 90
        child_y = arrow_y_end + 8
        for i, child in enumerate(children):
            cx = start_x + i * (child_w + child_gap)
            draw.rounded_rectangle([(cx, child_y), (cx + child_w, child_y + child_h)], radius=8, outline=border_rgb, width=1)

            cy_inner = child_y + 12
            c_label = child.get("label", "")
            if c_label:
                draw.text((cx + 16, cy_inner), c_label.upper(), font=sub_font, fill=accent_rgb)
                cy_inner += 22
            c_title = child.get("title", "")
            if c_title:
                draw.text((cx + 16, cy_inner), c_title, font=title_font, fill=text_rgb)
                cy_inner += 26
            c_sub = child.get("subtitle", "")
            if c_sub:
                draw.text((cx + 16, cy_inner), c_sub, font=sub_font, fill=muted_rgb)

        return child_y + child_h
    return p_y + p_h


# -- Main Renderer (template-aware) ------------------------------------------

def render_carousel(carousel_dir):
    carousel_dir = Path(carousel_dir)
    config_path = carousel_dir / "config.json"

    if not config_path.exists():
        print(f"Error: {config_path} not found")
        sys.exit(1)

    with open(config_path) as f:
        config = json.load(f)

    # Load template
    template_id = config.get("template")
    template = load_template(template_id)
    if template:
        print(f"Using template: {template['name']} ({template_id})")
    else:
        print("No template specified, using Skyframe defaults")

    # Load fonts based on template
    fonts = load_fonts_for_template(template)
    (carousel_dir / "reference").mkdir(exist_ok=True)

    # Resolve palette
    theme = config.get("theme", "dark")
    if template and template.get("colors"):
        palette = template["colors"].get(theme, template["colors"].get("dark", DEFAULT_COLORS["dark"]))
    else:
        palette = DEFAULT_COLORS.get(theme, DEFAULT_COLORS["dark"])

    slides = config["slides"]
    config["total_slides"] = len(slides)

    tpl_name = template["name"] if template else "Skyframe"
    print(f"Rendering {len(slides)} slides for '{config.get('title', 'carousel')}' (template: {tpl_name}, theme: {theme})...")

    zones = {}
    for i, slide in enumerate(slides):
        slide["number"] = i + 1
        slide_type = slide.get("type", "body")

        # Track art zone for slides that have one — compositor + downstream nodes use this
        if slide_type in ("image_body", "cta_follow"):
            aspect = slide.get("art_aspect", "1:1")
            text_pos = slide.get("text_position", "bottom") if slide_type == "image_body" else "bottom"
            zx, zy, zw, zh, _ = get_art_zone(aspect, text_pos)
            zones[f"slide_{i + 1}"] = {"x": zx, "y": zy, "w": zw, "h": zh, "aspect": aspect}

        if slide_type == "hook":
            rendered = render_hook_slide(config, slide, fonts, carousel_dir, palette, template)
        elif slide_type == "cta":
            rendered = render_cta_slide(config, slide, fonts, carousel_dir, palette, template)
        elif slide_type == "cta_follow":
            rendered = render_cta_follow_slide(config, slide, fonts, carousel_dir, palette, template)
        elif slide_type == "image_body":
            rendered = render_image_body_slide(config, slide, fonts, carousel_dir, palette, template)
        elif slide_type == "terminal_body":
            rendered = render_terminal_body_slide(config, slide, fonts, carousel_dir, palette, template)
            # Capture the terminal zone the renderer stashed for the compositor (Stage 3)
            if slide.get("_terminal_zone"):
                zones[f"slide_{i + 1}"] = slide["_terminal_zone"]
        elif slide_type == "feature_grid":
            rendered = render_feature_grid_slide(config, slide, fonts, carousel_dir, palette, template)
        else:
            rendered = render_body_slide(config, slide, fonts, carousel_dir, palette, template)

        output_path = carousel_dir / f"slide_{i + 1}.png"
        rendered.save(str(output_path), "PNG", quality=95)
        print(f"  Saved {output_path.name} ({slide_type})")

    with open(carousel_dir / "zones.json", "w") as f:
        json.dump(zones, f, indent=2)

    print(f"\nDone! {len(slides)} slides saved to {carousel_dir}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 render.py <carousel-directory>")
        print("Example: python3 render.py workspace/my-carousel")
        sys.exit(1)

    render_carousel(sys.argv[1])
