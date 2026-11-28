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
# ---- round 2 (Keith's notes) ----
def dilate(im, n, col):
    """add an n-pixel outline (8-neighbour) around the opaque pixels"""
    w, h = im.size; out = Image.new('RGBA', (w + 2 * n, h + 2 * n), CLEAR); out.alpha_composite(im, (n, n))
    for _ in range(n):
        src = out.copy(); sp = src.load(); op = out.load()
        for y in range(out.height):
            for x in range(out.width):
                if sp[x, y][3]: continue
                if any(0 <= x + dx < out.width and 0 <= y + dy < out.height and sp[x + dx, y + dy][3] for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                    op[x, y] = col
    return out
STAR7 = ['...y...', '..yyy..', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', '.y...y.']
save(dilate(grid(STAR7, {'y': FRAME}), 2, INK), 'star')          # 11 x 11
save(dilate(grid(STAR7, {'y': hx('f2c94c')}), 2, INK), 'star_gold')
# a tiny flame (win streak)
save(grid(['..r..', '.rr..', '.ryr.', 'ryyr.', 'ryyyr', '.ryr.'], {'r': hx('e0562a'), 'y': hx('f6c94a')}), 'flame')   # 5 x 6
# gear and speaker icons for the corner buttons (tan)
T = {'t': FRAME, 'k': INK}
save(grid(['...t.t...', '.ttttttt.', '.tt...tt.', 'ttt...ttt', '.t.....t.', 'ttt...ttt', '.tt...tt.', '.ttttttt.', '...t.t...'], T), 'icon_gear')
save(grid(['....t....', '...tt..t.', 'tttttt..t', 'tttttt.tt', 'tttttt..t', '...tt..t.', '....t....'], T), 'icon_sound')
save(grid(['....t....', '...tt....', 'tttttt.t.t', 'tttttt..t.', 'tttttt.t.t', '...tt....', '....t....'], {'t': hx('8a7f6c')}), 'icon_muted')
# gold: a plain gold circle at the size it's shown (one image pixel = one UI pixel)
def gold(d):
    im = Image.new('RGBA', (d, d), CLEAR); px = im.load(); c = (d - 1) / 2; r = d / 2
    for y in range(d):
        for x in range(d):
            dist = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            if dist > r - 0.25: continue
            if dist > r - 1.25: px[x, y] = INK
            elif (x - c) + (y - c) > r * 0.55: px[x, y] = hx('b8862e')
            else: px[x, y] = hx('e3b84a')
    hl = int(c - r * 0.35)
    px[hl, hl] = hx('f8e7a6')
    if d >= 10: px[hl + 1, hl] = hx('f8e7a6')
    return im
for d in (7, 8, 10, 12, 14, 20): save(gold(d), f'coin_{d}')
save(orb(9), 'orb')          # 20 x 20 (shown at 20 UI px)
def small_orb(d=8):
    im = Image.new('RGBA', (d, d), CLEAR); px = im.load(); c = (d - 1) / 2; r = d / 2
    for y in range(d):
        for x in range(d):
            dist = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            if dist > r - 0.25: continue
            px[x, y] = INK if dist > r - 1.25 else (hx('4a0b13') if (x - c) + (y - c) > r * 0.5 else hx('9c1d2b'))
    px[int(c - 1), int(c - 1)] = hx('e65a6a')
    return im
save(small_orb(8), 'orb_small')
# round portraits: a pixel circle mask and its ring (2 px off-white, 1 px dark inside)
def circle(d, ring=None):
    im = Image.new('RGBA', (d, d), CLEAR); px = im.load(); c = (d - 1) / 2; r = d / 2
    for y in range(d):
        for x in range(d):
            dist = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            if dist > r - 0.3: continue
            if ring is None: px[x, y] = (255, 255, 255, 255)
            else:
                for (w, col) in ring:
                    if dist > r - 0.3 - w: px[x, y] = col; break
    return im
OFFWHITE = hx('ede4d3')
save(circle(56), 'round_mask')
save(circle(56, [(2, OFFWHITE), (3, INK)]), 'round_ring')
# the Tavern Tier: a dark red disc with a thin gold ring
save(circle(46, [(1, INK), (2, hx('e3b84a')), (3, INK), (99, hx('3d1016'))]), 'tier_disc')
# a selected filter in the Card Viewer: a white box
save(framed(16, 16, hx('ede4d3'), edge=hx('ffffff'), shade=hx('c9c0b0')), 'btn_white')
# ---- round 3: flat circles with clean 1-px outlines, an octagon portrait frame, a snowflake ----
def clean_disc(d, fill, edge=INK):
    """a flat disc of odd size d: a midpoint-circle outline (1 px, no doubled pixels) filled inside"""
    r = (d - 1) // 2; c = r
    ring = set(); x, y, err = r, 0, 1 - r
    while x >= y:
        for px_, py_ in ((x, y), (y, x), (-y, x), (-x, y), (-x, -y), (-y, -x), (y, -x), (x, -y)): ring.add((c + px_, c + py_))
        y += 1
        if err < 0: err += 2 * y + 1
        else: x -= 1; err += 2 * (y - x) + 1
    im = Image.new('RGBA', (d, d), CLEAR); px = im.load()
    for yy in range(d):
        xs = [x_ for (x_, y_) in ring if y_ == yy]
        if xs:
            for xx in range(min(xs) + 1, max(xs)): px[xx, yy] = fill
    for p in ring: px[p] = edge
    return im
for d in (7, 11, 13, 15, 17, 21): save(clean_disc(d, hx('e3b84a')), f'coin_{d}')
save(clean_disc(21, hx('8e1a26')), 'orb')
save(clean_disc(9, hx('8e1a26')), 'orb_small')
save(clean_disc(23, hx('8e1a26')), 'orb_big')
save(clean_disc(27, hx('8e1a26')), 'orb_hero')
# octagon portrait: mask, and a 2-px off-white rim
def octa(n, cut, inset=0):
    a, b = inset, n - 1 - inset; k = cut + inset * 1.0
    return {(x, y) for y in range(n) for x in range(n) if a <= x <= b and a <= y <= b and
            (x - a) + (y - a) >= cut and (b - x) + (y - a) >= cut and (x - a) + (b - y) >= cut and (b - x) + (b - y) >= cut}
N, CUT = 56, 8
outer = octa(N, CUT); inner = octa(N, CUT, 2)
m = Image.new('RGBA', (N, N), CLEAR); r = Image.new('RGBA', (N, N), CLEAR)
for p in outer:
    m.putpixel(p, (255, 255, 255, 255))
    if p not in inner: r.putpixel(p, OFFWHITE)
save(m, 'octa_mask'); save(r, 'octa_ring')
# Freeze: a snowflake
SNOW = ['.....#.#.....', '......#......', '.#....#....#.', '..#...#...#..', '...#..#..#...', '#...#.#.#...#', '#############',
        '#...#.#.#...#', '...#..#..#...', '..#...#...#..', '.#....#....#.', '......#......', '.....#.#.....']
save(grid(SNOW, {'#': FRAME}), 'icon_snow')
print('ok', sorted(os.listdir(OUT)))
