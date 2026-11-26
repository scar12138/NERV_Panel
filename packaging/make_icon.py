# -*- coding: utf-8 -*-
"""Generate the shared executable/tray/setup icon from the repository's nerv.jpg."""
from pathlib import Path
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "nerv.jpg"
OUT = HERE / "NERV-Panel.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]


def main():
    with Image.open(SOURCE) as original:
        image = ImageOps.exif_transpose(original).convert("RGBA")
        # Keep the entire artwork, with transparent padding for non-square input.
        image = ImageOps.contain(image, (256, 256), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (256, 256))
        canvas.alpha_composite(image, ((256 - image.width) // 2, (256 - image.height) // 2))
        canvas.save(OUT, format="ICO", sizes=[(size, size) for size in SIZES])
    print("Icon generated:", OUT)


if __name__ == "__main__":
    main()
