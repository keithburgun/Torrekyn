#!/usr/bin/env python3
"""
The Tavern button icons (Upgrade, Refresh, Freeze): one flat colour each, 11 x 11 pixels, drawn at the same
pixel size as each other (the CSS shows one icon pixel as --ip). Written white on transparent to
src/assets/ui/icon_*.png; the CSS uses them as masks and colours them.
Run: python3 tools/make_tavern_icons.py   (writes a 10x preview to tools/ui_src/tavern_icons_preview.png)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tools/ui_src/native/ui'  # then run tools/upscale_ui.py

ICONS = {
    'upgrade': """
.....#.....
....###....
...#####...
..#######..
.#########.
###########
...#####...
...#####...
...#####...
...#####...
...#####...
""",
    'refresh': """
..#####....
.#######...
##.....##..
##.....##..
##...######
##....####.
##.....##..
##.........
.##....##..
..######...
...####....
""",
    'freeze': """
.....#.....
.#..###..#.
.##..#..##.
..##.#.##..
.#..###..#.
###########
.#..###..#.
..##.#.##..
.##..#..##.
.#..###..#.
.....#.....
""",
}


def grid(s):
    return [r for r in s.strip().splitlines()]


def main():
    ims = []
    for name, art in ICONS.items():
        rows = grid(art)
        h, w = len(rows), len(rows[0])
        assert all(len(r) == w for r in rows), name
        im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        for y, r in enumerate(rows):
            for x, ch in enumerate(r):
                if ch == '#':
                    im.putpixel((x, y), (255, 255, 255, 255))
        im.save(OUT / f'icon_{name}.png')
        ims.append(im)
    cols = [(242, 201, 76), (215, 187, 144), (215, 187, 144)]
    K = 16
    pv = Image.new('RGB', (len(ims) * 14 * K, 14 * K), (32, 31, 35))
    for i, (im, c) in enumerate(zip(ims, cols)):
        t = Image.new('RGBA', im.size, c + (255,))
        t.putalpha(im.getchannel('A'))
        big = t.resize((im.width * K, im.height * K), Image.NEAREST)
        pv.paste(big, (i * 14 * K + K, K), big)
    pv.save(ROOT / 'tools/ui_src/tavern_icons_preview.png')


if __name__ == '__main__':
    main()
