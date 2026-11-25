# -*- coding: utf-8 -*-
"""生成 NERV Panel 桌面版图标（.ico，含多尺寸）。"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent / "NERV-Panel.ico"


def draw(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角红底
    r = max(2, int(size * 0.22))
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(203, 16, 32, 255))
    # 中心 NERV 字样
    font_size = int(size * 0.34)
    try:
        font = ImageFont.truetype("arialbd.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), "NERV", font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    cx = (size - w) / 2 - bbox[0]
    cy = (size - h) / 2 - bbox[1] - int(size * 0.04)
    d.text((cx, cy), "NERV", font=font, fill=(250, 250, 250, 255))
    # 字下红线
    bar_w = int(size * 0.48)
    bar_h = max(1, int(size * 0.03))
    d.rounded_rectangle(
        [(size - bar_w) / 2, int(size * 0.78), (size + bar_w) / 2, int(size * 0.78) + bar_h],
        radius=bar_h // 2,
        fill=(250, 250, 250, 235),
    )
    return img


def main():
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [draw(s) for s in sizes]
    imgs[0].save(OUT, format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[1:])
    print("saved", OUT)


if __name__ == "__main__":
    main()