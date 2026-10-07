#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Portail Outils — génération du jeu d'icônes et de l'écran de démarrage.

Produit, à partir d'un dessin vectoriel décrit en Python (Pillow) :
  icons/icon.ico      icône multi-résolutions 16 -> 256 px (installateur, .exe, raccourcis)
  icons/icon.png      512 px, icône de référence (Linux / documentation)
  icons/tray.png      16 px, icône de la zone de notification
  icons/tray@2x.png   32 px, variante HiDPI (écrans 150 % / 200 %)
  icons/tray@3x.png   48 px, variante HiDPI (écrans 250 % +)
  build/splash.bmp    image affichée pendant l'extraction de la version portable

Le dessin est fait en suréchantillonnage 4x puis réduit : les bords arrondis
restent nets à toutes les tailles, y compris 16 px.

Usage : python scripts/generate-icons.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ─── Charte ──────────────────────────────────────────────────────────────────
# Dégradé de la tuile : vert « Portail outils » (#2AD783) vers un vert plus dense.
GRADIENT_START = (66, 226, 148)
GRADIENT_END = (14, 158, 96)
GLYPH = (255, 255, 255, 255)

# Écran de démarrage
SPLASH_SIZE = (640, 360)
SPLASH_BG = (243, 246, 245)
SPLASH_TITLE = (19, 24, 23)
SPLASH_SUB = (92, 102, 99)

# Géométrie exprimée en fraction du côté du carré.
CORNER_RATIO = 0.225     # rayon des coins de la tuile
GLYPH_SPAN = 0.600       # largeur totale du glyphe 2x2
GLYPH_GAP = 0.072        # espace entre les quatre carrés
CELL_RADIUS = 0.052      # rayon des coins de chaque carré

SUPERSAMPLE = 4
MASTER = 1024           # toile de travail

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def _rounded_mask(size: int, radius: float) -> Image.Image:
    """Masque alpha : carré à coins arrondis, en niveaux de gris."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def _diagonal_gradient(size: int) -> Image.Image:
    """Dégradé linéaire du coin haut-gauche vers le coin bas-droit."""
    base = Image.new("RGB", (size, size))
    pixels = base.load()
    span = (size - 1) * 2
    for y in range(size):
        for x in range(size):
            t = (x + y) / span
            pixels[x, y] = tuple(
                int(round(a + (b - a) * t))
                for a, b in zip(GRADIENT_START, GRADIENT_END)
            )
    return base


def _glyph_layer(size: int) -> Image.Image:
    """Les quatre carrés blancs du glyphe, sur fond transparent."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    span = size * GLYPH_SPAN
    gap = size * GLYPH_GAP
    cell = (span - gap) / 2.0
    radius = size * CELL_RADIUS
    origin = (size - span) / 2.0

    for row in range(2):
        for col in range(2):
            x0 = origin + col * (cell + gap)
            y0 = origin + row * (cell + gap)
            draw.rounded_rectangle(
                (x0, y0, x0 + cell, y0 + cell), radius=radius, fill=GLYPH
            )
    return layer


def render(size: int) -> Image.Image:
    """Rend l'icône à la taille demandée, en RGBA."""
    work = MASTER
    gradient = _diagonal_gradient(work).convert("RGBA")
    gradient.putalpha(_rounded_mask(work, work * CORNER_RATIO))
    gradient.alpha_composite(_glyph_layer(work))
    return gradient.resize((size, size), Image.LANCZOS)


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Police Segoe UI de Windows, avec repli si elle est absente."""
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_splash() -> Image.Image:
    """
    Écran affiché par le lanceur portable pendant l'extraction.

    Il doit tenir sur un fond uni : le greffon BgImage de NSIS ne gère pas la
    transparence. C'est le seul retour visuel de l'utilisateur pendant que
    l'application se déploie dans le dossier temporaire.
    """
    width, height = SPLASH_SIZE
    image = Image.new("RGB", SPLASH_SIZE, SPLASH_BG)
    draw = ImageDraw.Draw(image)

    # Bandeau supérieur aux couleurs de la marque.
    draw.rectangle((0, 0, width, 5), fill=GRADIENT_END)

    # Icône applicative centrée, avec sa propre ombre portée.
    icon_size = 96
    icon = render(icon_size)
    shadow = Image.new("RGBA", (icon_size + 24, icon_size + 24), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (12, 15, 12 + icon_size, 15 + icon_size),
        radius=int(icon_size * CORNER_RATIO),
        fill=(9, 16, 13, 38),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(5))
    icon_x = (width - icon_size) // 2
    image.paste(shadow, (icon_x - 12, 62 - 12), shadow)
    image.paste(icon, (icon_x, 62), icon)

    title_font = _font(30, bold=True)
    sub_font = _font(16)

    def centered(text: str, font, y: int, color) -> None:
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        draw.text(((width - (right - left)) // 2 - left, y), text, font=font, fill=color)

    centered("Portail outils", title_font, 190, SPLASH_TITLE)
    centered("Chargement de l'application…", sub_font, 236, SPLASH_SUB)
    centered(
        "Cette première ouverture peut prendre une minute",
        sub_font,
        288,
        (140, 150, 146),
    )

    return image


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    out = root / "icons"
    out.mkdir(parents=True, exist_ok=True)

    master = render(MASTER)

    ico_sizes = sorted({*ICO_SIZES, 256})
    master.save(out / "icon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes])

    master.resize((512, 512), Image.LANCZOS).save(out / "icon.png", format="PNG")

    for suffix, px in (("", 16), ("@2x", 32), ("@3x", 48)):
        master.resize((px, px), Image.LANCZOS).save(
            out / f"tray{suffix}.png", format="PNG"
        )

    # Écran de démarrage de la version portable : BMP 24 bits obligatoire,
    # le greffon BgImage de NSIS ne lit pas la transparence.
    build = root / "build"
    build.mkdir(parents=True, exist_ok=True)
    render_splash().save(build / "splash.bmp", format="BMP")

    print(f"Icones generees dans {out}:")
    for name in sorted(p.name for p in out.iterdir() if p.is_file()):
        print(f"  - {name} ({(out / name).stat().st_size} octets)")
    print(f"Ecran de demarrage : {build / 'splash.bmp'} "
          f"({(build / 'splash.bmp').stat().st_size} octets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
