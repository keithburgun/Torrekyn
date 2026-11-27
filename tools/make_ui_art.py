"""
UI art for the pixel look (see tools/ui_src/battlegrounds_art.psd). Everything is drawn at UI-pixel size
(1 UI pixel = 2.5 stage pixels; the CSS scales it up with image-rendering: pixelated).
Run: python3 tools/make_ui_art.py   (writes src/assets/ui/*.png)
"""
import os
from PIL import Image
from psd_tools import PSDImage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src/assets/ui')
os.makedirs(OUT, exist_ok=True)

def hx(h, a=255):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

INK = hx('201f23'); ORN = hx('483d2e'); FRAME = hx('d7bb90'); FRAME_DK = hx('af8e5b'); CLEAR = (0, 0, 0, 0)
BODY = hx('f1dbad'); RED = hx('d02639')

def save(im, name):
    im.save(os.path.join(OUT, name + '.png'))

# ---- card frames, straight from the PSD ----
psd = PSDImage.open(os.path.join(ROOT, 'tools/ui_src/battlegrounds_art.psd'))
layers = {l.name: l for l in psd}
save(layers['CARD BG'].topil(), 'card_big')        # 140 x 178
save(layers['Layer 11'].topil(), 'card_small')     # 66 x 66 (9-slice: 13)

def recolor(im, m):
    im = im.convert('RGBA'); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y] in m: px[x, y] = m[px[x, y]]
    return im
GOLD = {hx('d7bb90'): hx('f0c24e'), hx('af8e5b'): hx('b07a1c'), hx('483d2e'): hx('6a5222')}
SPELL = {hx('d7bb90'): hx('c4c6cf'), hx('af8e5b'): hx('8a8c97'), hx('483d2e'): hx('3d3d47')}
for nm in ('card_big', 'card_small'):
    base = Image.open(os.path.join(OUT, nm + '.png'))
    save(recolor(base, GOLD), nm + '_gold')
    save(recolor(base, SPELL), nm + '_spell')

def grid(rows, pal):
    h = len(rows); w = max(len(r) for r in rows)
    im = Image.new('RGBA', (w, h), CLEAR); px = im.load()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c in pal: px[x, y] = pal[c]
    return im

def framed(w, h, fill, edge=FRAME, shade=FRAME_DK, inner=None):
    """a button/panel: 2px frame (darker along the bottom), stepped corners, solid fill"""
    im = Image.new('RGBA', (w, h), CLEAR); px = im.load()
    for y in range(h):
        for x in range(w):
            # stepped corner: cut 2 pixels diagonally
            cx = min(x, w - 1 - x); cy = min(y, h - 1 - y)
            if cx + cy < 2: continue
            border = cx < 2 or cy < 2 or (cx + cy < 4)
            if border: px[x, y] = shade if y >= h - 2 else edge
            else: px[x, y] = fill
    if inner:  # a highlight line along the inside top
        for x in range(3, w - 3): px[x, 2] = inner
    return im

save(framed(16, 16, INK), 'btn')                                     # 9-slice 5
save(framed(16, 16, hx('2c2a30'), inner=hx('3a373f')), 'btn_hover')
save(framed(16, 16, hx('8e1a26'), inner=hx('b02232')), 'btn_primary')
save(framed(16, 16, hx('a81f2e'), inner=hx('c42a3b')), 'btn_primary_hover')
save(framed(16, 16, hx('1d3f4a'), inner=hx('285866')), 'btn_on')
save(framed(16, 16, hx('2a292e'), edge=hx('6d6253'), shade=hx('584f43')), 'btn_off')
# a plain panel (no ornaments): thinner 1px frame inside a dark rim
def panel(fill, edge):
    w = h = 12; im = Image.new('RGBA', (w, h), CLEAR); px = im.load()
    for y in range(h):
        for x in range(w):
            cx = min(x, w - 1 - x); cy = min(y, h - 1 - y)
            if cx + cy < 1: continue
            px[x, y] = edge if (cx < 1 or cy < 1 or cx + cy < 2) else fill
    return im
save(panel(hx('26252a', 236), hx('6d6253')), 'panel')      # 9-slice 3
save(panel(hx('2e2c33', 240), FRAME), 'panel_hi')

# ---- Health: a red orb (solid colours, light from the top left) ----
def orb(r=11, base=hx('74121d'), hi=hx('9c1d2b'), sh=hx('4a0b13'), spec=hx('e65a6a')):
    d = 2 * r + 2; im = Image.new('RGBA', (d, d), CLEAR); px = im.load(); c = r + 0.5
    for y in range(d):
        for x in range(d):
            dx, dy = x - c, y - c; dist = (dx * dx + dy * dy) ** 0.5
            if dist > r + 0.5: continue
            if dist > r - 0.6: px[x, y] = INK; continue
            # light from top-left
            lx, ly = dx + r * 0.35, dy + r * 0.35
            if (lx * lx + ly * ly) ** 0.5 > r * 1.05: px[x, y] = sh
            elif (dx + r * 0.2) ** 2 + (dy + r * 0.2) ** 2 < (r * 0.62) ** 2: px[x, y] = hi
            else: px[x, y] = base
    # a small specular glint
    for (x, y) in [(int(c - r * 0.5), int(c - r * 0.55)), (int(c - r * 0.5) + 1, int(c - r * 0.55)), (int(c - r * 0.5), int(c - r * 0.55) + 1)]:
        px[x, y] = spec
    return im
save(orb(), 'orb')            # 24 x 24
save(orb(7), 'orb_small')     # 16 x 16
# Gold: a coin
def coin(r=6):
    d = 2 * r + 2; im = Image.new('RGBA', (d, d), CLEAR); px = im.load(); c = r + 0.5
    for y in range(d):
        for x in range(d):
            dx, dy = x - c, y - c; dist = (dx * dx + dy * dy) ** 0.5
            if dist > r + 0.5: continue
            if dist > r - 0.6: px[x, y] = INK
            elif dist > r - 1.6: px[x, y] = hx('b8862e') if dy > -dx * 0.3 else hx('f3d77a')
            else: px[x, y] = hx('e3b84a') if dx + dy > -1 else hx('efcb62')
    return im
save(coin(), 'coin')          # 14 x 14
save(coin(9), 'coin_big')     # 20 x 20

# ---- tier pip: a little star ----
STAR = ['...k...', '..kyk..', 'kkkykkk', 'kyyyyyk', '.kyyyk.', 'kyk.kyk', 'kk...kk']
save(grid(STAR, {'k': INK, 'y': FRAME}), 'star')
save(grid(STAR, {'k': INK, 'y': hx('f2c94c')}), 'star_gold')

# ---- keyword marks (9 x 9) ----
KW = {
    'reborn': (['...kkk...', '..kcccK..', '..kc.ck..', '..kcccK..', 'kkkkckkkk', 'kcccccck.', 'kkkkckkkk', '...kck...', '...kkk...'], hx('9fe3f0')),
    'venomous': (['.kkkkkkk.', 'kwwwwwwwk', 'kwkkwkkwk', 'kwkkwkkwk', 'kwwwkwwwk', '.kwwwwwk.', '..kwkwk..', '..kkkkk..', '.........'], hx('e9e2d4')),
    'poisonous': (['....k....', '...kgk...', '...kgk...', '..kgggk..', '.kgggggk.', '.kgwgggk.', '.kgggggk.', '..kgggk..', '...kkk...'], hx('7ccf4e')),
    'windfury': (['.........', 'kkkkkkk..', 'kcccccck.', '.kkkkkkck', 'kkkkkk.kk', 'kcccccck.', '.kkkkkkck', '......kk.', '.........'], hx('9fe3f0')),
}
for name, (rows, col) in KW.items():
    save(grid([r.replace('K', 'k') for r in rows], {'k': INK, 'c': col, 'w': col, 'g': col}), 'kw_' + name)
# ---- trinkets: a cut gem (Lesser: cyan, Greater: red) ----
GEM = ['...kkkkkkkk...', '..khhhlhhhhk..', '.khhlllhhhhhk.', 'kkkkkkkkkkkkkk', 'kllmmmmmmmmssk', '.klmmmmmmmssk.', '..klmmmmmssk..', '...klmmmssk...', '....klmssk....', '.....klsk.....', '......kk......']
save(grid(GEM, {'k': INK, 'h': hx('d8f6fb'), 'l': hx('b8eef6'), 'm': hx('5fc4d6'), 's': hx('2e8296')}), 'gem_lesser')
save(grid(GEM, {'k': INK, 'h': hx('ffc9c4'), 'l': hx('f27a7a'), 'm': hx('c42a3b'), 's': hx('74121d')}), 'gem_greater')
print('ok', sorted(os.listdir(OUT)))
