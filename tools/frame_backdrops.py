#!/usr/bin/env python3
"""
Seam-free 9-slice frames.

When the stage is scaled to a fractional size, the browser draws the 9 pieces of a border-image with
anti-aliased edges, and the page shows through where two pieces meet (thin dark lines across buttons,
panels and cards). This gives every rule that uses a frame PNG a solid `background` drawn underneath:
the frame's edge bands and middle, without the corners, overlapping each seam by one pixel. Where the
frame is drawn the backdrop is hidden; at a seam it fills the gap with the right colour.

Rewrites src/ui/theme.css in place (re-runnable: declarations it adds are tagged /*bd*/).
"""
import re
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / 'src/ui/theme.css'
UI = ROOT / 'src/assets/ui'
SLICE = {'btn': 5, 'panel': 3, 'card_small': 13}
U = 'var(--u)'


def n(k):
    return '0' if k == 0 else (U if k == 1 else f'calc({k} * {U})')


def col(p):
    r, g, b, a = p
    if a == 0:
        return 'transparent'
    return f'#{r:02x}{g:02x}{b:02x}' if a == 255 else f'rgba({r},{g},{b},{a / 255:.3f})'


def grad(direction, colours):
    stops, i = [], 0
    while i < len(colours):
        j = i
        while j + 1 < len(colours) and colours[j + 1] == colours[i]:
            j += 1
        stops.append(f'{colours[i]} {n(i)} {n(j + 1)}')
        i = j + 1
    if len(stops) == 1:
        c = colours[0]
        return f'linear-gradient({c}, {c})'
    return f'linear-gradient({direction}, {", ".join(stops)})'


def backdrop(name):
    base = re.sub(r'_(hover|primary|on|off|white|hi|gold|spell)', '', name)
    base = 'btn' if name.startswith('btn') else base
    s = SLICE[base]
    im = Image.open(UI / f'{name}.png').convert('RGBA')
    w, h = im.size
    # panels are a touch see-through; the backdrop makes them solid (the difference is invisible)
    px = lambda x, y: col(im.getpixel((x, y))[:3] + (255 if im.getpixel((x, y))[3] else 0,))
    cx, cy = s, s  # just past the corner: what borders each seam
    top = [px(cx, y) for y in range(s)]
    bot = [px(cx, y) for y in range(h - s, h)]
    left = [px(x, cy) for x in range(s)]
    right = [px(x, cy) for x in range(w - s, w)]
    mid = px(s, s)
    span = f'calc(100% - {2 * s - 2} * {U})'
    o = n(s - 1)
    layers = [
        f'{grad("to bottom", top)} {o} 0 / {span} {n(s)} no-repeat border-box',
        f'{grad("to bottom", bot)} {o} 100% / {span} {n(s)} no-repeat border-box',
        f'{grad("to right", left)} 0 {o} / {n(s)} {span} no-repeat border-box',
        f'{grad("to right", right)} 100% {o} / {n(s)} {span} no-repeat border-box',
        f'linear-gradient({mid}, {mid}) {o} {o} / {span} {span} no-repeat border-box',
    ]
    return ', '.join(layers)


def main():
    css = CSS.read_text()
    css = re.sub(r' ?background: [^;{}]*; ?/\*bd\*/', '', css)
    out, pos = [], 0
    for m in re.finditer(r'\{([^{}]*)\}', css):
        body = m.group(1)
        imgs = re.findall(r"border-image(?:-source)?: url\('\.\./assets/ui/((?:btn|panel|card_small)[a-z_]*)\.png'\)", body)
        if not imgs or 'background-size' in body or 'background-color' in body:
            continue
        name = imgs[-1]
        nb = re.sub(r'(^|;)\s*background: none( !important)?;', r'\1', body)
        decl = f' background: {backdrop(name)}; /*bd*/'
        nb = nb.rstrip()
        nb = (nb if nb.endswith(';') or not nb.strip() else nb + ';') + decl + ' '
        out.append(css[pos:m.start(1)])
        out.append(nb)
        pos = m.end(1)
    out.append(css[pos:])
    CSS.write_text(''.join(out))


if __name__ == '__main__':
    main()
