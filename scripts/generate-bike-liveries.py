from __future__ import annotations

import colorsys
from pathlib import Path
from shutil import copyfile

from PIL import Image


MODEL_DIR = (
    Path(__file__).resolve().parents[1]
    / "public"
    / "3Dmodels"
    / "[OBJ] Generic_Bike_v01_w_Biker"
)

SOURCES = {
    "biker": MODEL_DIR / "Biker_D.png",
    "bike": MODEL_DIR / "Generic_Bike_v01.png",
}

LIVERIES = {
    "blue-dark": "#102a8c",
    "blue-sky": "#34b7ff",
    "red": "#e84040",
    "yellow": "#ffd31a",
    "purple": "#6f32d9",
    "pink": "#ff79b7",
    "magenta": "#ff18d4",
    "green": "#20bf55",
    "orange": "#ff7a1a",
    "cyan": "#00d5ff",
    "black": "#111318",
    "white": "#f5f7fb",
}


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def is_red_pixel(r: int, g: int, b: int) -> bool:
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    red_hue = h <= 0.08 or h >= 0.92
    # Keep tyres, cockpit, carbon and dark mechanical parts intact.
    # They often contain warm reddish antialiasing/shadows, so only recolor
    # saturated, visibly painted red pixels.
    return red_hue and s > 0.45 and v > 0.24 and r > g * 1.35 and r > b * 1.25


def recolor_channel(src: Path, dst: Path, target: tuple[int, int, int]) -> None:
    img = Image.open(src).convert("RGBA")
    tr, tg, tb = target
    target_h, target_s, target_v = colorsys.rgb_to_hsv(tr / 255, tg / 255, tb / 255)

    pixels = img.load()
    width, height = img.size

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if not is_red_pixel(r, g, b):
                continue

            _, source_s, source_v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            # Preserve painted highlights/shadows from the original red texture.
            out_s = max(source_s * 0.55, target_s)
            out_v = min(1.0, source_v * (0.72 + target_v * 0.34))
            nr, ng, nb = colorsys.hsv_to_rgb(target_h, out_s, out_v)
            pixels[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)

    dst.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(dst, optimize=True)


def main() -> None:
    for slug, color in LIVERIES.items():
        if slug == "red":
            copyfile(SOURCES["biker"], MODEL_DIR / "Biker_D_red.png")
            copyfile(SOURCES["bike"], MODEL_DIR / "Generic_Bike_v01_red.png")
            continue

        target = hex_to_rgb(color)
        recolor_channel(SOURCES["biker"], MODEL_DIR / f"Biker_D_{slug}.png", target)
        recolor_channel(SOURCES["bike"], MODEL_DIR / f"Generic_Bike_v01_{slug}.png", target)

    print(f"Generated {len(LIVERIES) * 2} livery textures in {MODEL_DIR}")


if __name__ == "__main__":
    main()
