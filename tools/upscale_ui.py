#!/usr/bin/env python3
"""
The game's pixel images are drawn at their true size (tools/ui_src/native/...) and copied here 4x larger with
hard edges (src/assets/ui, src/assets/tribes). The browser then shrinks or stretches the 4x copy smoothly, so a pixel
that lands between screen pixels is softened a little at its edge instead of being doubled ("sharp bilinear").
Run after tools/make_ui_art.py or tools/make_tavern_icons.py:  python3 tools/upscale_ui.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
K = 4
PAIRS = [('tools/ui_src/native/ui', 'src/assets/ui'), ('tools/ui_src/native/tribes', 'src/assets/tribes')]


def up(im):
    return im.resize((im.width * K, im.height * K), Image.NEAREST)


def main():
    for src, dst in PAIRS:
        d = ROOT / dst
        d.mkdir(parents=True, exist_ok=True)
        for f in sorted((ROOT / src).glob('*.png')):
            up(Image.open(f).convert('RGBA')).save(d / f.name, optimize=True)


if __name__ == '__main__':
    main()
