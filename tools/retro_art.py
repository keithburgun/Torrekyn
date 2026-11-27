"""
Retro art: each card's art reduced to an FF1-like look (2-3 colours plus the dark background).
Pixel sprites are recovered at their native size from the built art (public/art/v2), the backdrop is removed,
their colours are clustered, the outline colour becomes the background (FF1 has no outlines), and the rest is
mapped to three tones (dark / mid / light), each the average colour of its clusters, nudged for contrast.
Illustrations (no pixel grid) are shrunk to 40 px first.
Run: python3 tools/retro_art.py [ids...]   ->  tools/art_retro/{cards,heroes}/<id>.png  (native size, dark background)
"""
import os, sys, json, colorsys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_art as B

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools/art_retro')
BG = (32, 31, 35)

def backdrop_img(tribe, center):
    S = B.SIZE; out = B.backdrop(tribe)
    if not center:
        sh = Image.new('RGBA', out.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse((S * 0.24, S * 0.8, S * 0.76, S * 0.9), fill=(0, 0, 0, 70))
        out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    return np.asarray(out.convert('RGB')).astype(int)

def native_sprite(path, tribe, center):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    fg = np.abs(a - backdrop_img(tribe, center)).max(2) > 28
    ys, xs = np.where(fg)
    if not len(ys): return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    span = max(x1 - x0, y1 - y0)
    errs = []
    for n in range(12, 72):
        k = span / n
        w = max(1, round((x1 - x0) / k)); h = max(1, round((y1 - y0) / k))
        m = int(k * 0.2)
        err = 0.0; cnt = 0
        for j in range(h):
            for i in range(w):
                c = a[int(y0 + j * k) + m:int(y0 + (j + 1) * k) - m, int(x0 + i * k) + m:int(x0 + (i + 1) * k) - m]
                if c.size: err += c.reshape(-1, 3).std(0).sum(); cnt += 1
        err /= max(1, cnt)
        errs.append((err, n, k, w, h))
    # the true pixel grid shows as a sharp dip: much better than the grids just coarser and finer
    def dip(i):
        nb = [errs[j][0] for j in (i - 1, i + 1, i - 2, i + 2) if 0 <= j < len(errs)]
        return errs[i][0] / max(1e-6, min(nb))
    i = min(range(len(errs)), key=dip)
    _, n, k, w, h = errs[i]
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = im.load()
    m = int(k * 0.25)
    for j in range(h):
        for i in range(w):
            sl = (slice(int(y0 + j * k) + m, int(y0 + (j + 1) * k) - m), slice(int(x0 + i * k) + m, int(x0 + (i + 1) * k) - m))
            c = a[sl].reshape(-1, 3); f = fg[sl]
            if c.size and f.mean() > 0.5: px[i, j] = tuple(int(v) for v in np.median(c, 0)) + (255,)
    return im

def illustration(path, n=40):
    im = Image.open(path).convert('RGB').resize((n, n), Image.BOX)
    return im.convert('RGBA')

def lum(c): return 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2]

def retro(im, K=9):
    a = np.asarray(im).astype(float); h, w = a.shape[:2]
    m = a[..., 3] > 0; P = a[m][:, :3]
    K = min(K, max(2, len(np.unique(P.astype(int), axis=0))))
    rng = np.random.default_rng(1)
    C = P[rng.choice(len(P), K, replace=False)]
    for _ in range(30):
        lab = ((P[:, None] - C[None]) ** 2).sum(2).argmin(1)
        C = np.array([P[lab == k].mean(0) if (lab == k).any() else C[k] for k in range(K)])
    lab = ((P[:, None] - C[None]) ** 2).sum(2).argmin(1)
    L = np.full((h, w), -1); L[m] = lab
    cnt = np.bincount(lab, minlength=K)
    inside = m
    ring = np.zeros_like(m)
    for y in range(h):
        for x in range(w):
            if m[y, x] and any(not (0 <= x + dx < w and 0 <= y + dy < h) or not m[y + dy, x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))): ring[y, x] = True
    transparent = (~m).any()
    # the outline colour: what the sprite's outermost pixels mostly are (only sprites have one)
    xk = set()
    if transparent and ring.any():
        rl = L[ring]; oc = np.bincount(rl[rl >= 0], minlength=K).argmax()
        for k in range(K):
            if np.abs(C[k] - C[oc]).max() < 40 and lum(C[k]) < 90: xk.add(k)
    # the rest: three tones by brightness, split by pixel counts (darkest ~38%, brightest ~22%)
    rest = sorted([k for k in range(K) if k not in xk and cnt[k]], key=lambda k: lum(C[k]))
    lv = {k: lum(C[k]) for k in rest}
    if rest:
        cen = [lv[rest[0]], lv[rest[len(rest) // 2]], lv[rest[-1]]]
        for _ in range(30):
            g = {0: [], 1: [], 2: []}
            for k in rest: g[min(range(3), key=lambda i: abs(lv[k] - cen[i]))].append(k)
            cen = [sum(lv[k] * cnt[k] for k in g[i]) / max(1, sum(cnt[k] for k in g[i])) if g[i] else cen[i] for i in range(3)]
    tone_of = {k: min(range(3), key=lambda i: abs(lv[k] - cen[i])) for k in rest}
    if len(rest) >= 3:  # use all three tones
        if 2 not in tone_of.values(): tone_of[rest[-1]] = 2
        if 0 not in tone_of.values(): tone_of[rest[0]] = 0
    T = np.full((h, w), -1)
    for y in range(h):
        for x in range(w):
            k = L[y, x]
            if k < 0: continue
            T[y, x] = -2 if k in xk else tone_of.get(k, 1)
    out = T.copy()
    for y in range(h):
        for x in range(w):
            if T[y, x] != -2: continue
            nb = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            lines = sum(1 for X, Y in nb if 0 <= X < w and 0 <= Y < h and T[Y, X] == -2)
            out[y, x] = -1 if ring[y, x] or lines <= 2 else 0
    for _ in range(2):  # a lone pixel takes its neighbours' tone
        o2 = out.copy()
        for y in range(h):
            for x in range(w):
                t = out[y, x]
                if t < 0: continue
                nb = [out[y + dy, x + dx] for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and 0 <= y + dy < h and 0 <= x + dx < w]
                nb = [v for v in nb if v >= 0]
                if nb and nb.count(t) == 0: o2[y, x] = max(set(nb), key=nb.count)
        out = o2
    # tone colours: the average of their clusters, then spread apart for contrast and kept clear of the background
    cols = []
    for t in range(3):
        ks = [k for k, v in tone_of.items() if v == t]
        if ks:
            c = C[max(ks, key=lambda k: cnt[k])]   # the tone's most common colour
        else:
            c = np.array([128, 128, 128])
        hh, ll, ss = colorsys.rgb_to_hls(*(c / 255))
        ll = [max(0.30, min(0.42, ll)), max(0.50, min(0.66, ll)), max(0.80, min(0.93, ll + 0.12))][t]
        ss = min(1, ss * 1.15 + (0.05 if t < 2 else 0))
        cols.append(tuple(int(v * 255) for v in colorsys.hls_to_rgb(hh, ll, ss)))
    res = Image.new('RGB', (w, h), BG); p = res.load()
    for y in range(h):
        for x in range(w):
            if out[y, x] >= 0: p[x, y] = cols[out[y, x]]
    return res, (~m).any()

def place(sprite, center):
    """the sprite on a square dark canvas with a 2-pixel margin (figures stand near the bottom)"""
    w, h = sprite.size; n = max(w, h) + 4
    c = Image.new('RGB', (n, n), BG)
    x = (n - w) // 2; y = (n - h) // 2 if center else n - h - 2
    c.paste(sprite, (x, y)); return c

def for_game(im):
    """the game's copy: a sprite (dark corners) gets a transparent background and is trimmed to its subject;
    a full-bleed picture stays square"""
    im = im.convert('RGBA'); w, h = im.size; px = im.load()
    if not all(px[x, y][:3] == BG for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))): return im
    for y in range(h):
        for x in range(w):
            if px[x, y][:3] == BG: px[x, y] = (0, 0, 0, 0)
    bb = im.getbbox()
    return im.crop(bb) if bb else im

def install():
    """copy tools/art_retro/cards into public/art/retro/cards in the game's form, and write the manifest"""
    src = os.path.join(OUT, 'cards'); dst = os.path.join(ROOT, 'public/art/retro/cards'); os.makedirs(dst, exist_ok=True)
    m = {}
    for f in sorted(os.listdir(src)):
        if not f.endswith('.png'): continue
        for_game(Image.open(os.path.join(src, f))).save(os.path.join(dst, f))
        m['card:' + f[:-4]] = 'art/retro/cards/' + f
    json.dump(m, open(os.path.join(ROOT, 'src/data/artRetro.json'), 'w'), indent=1)
    print('installed', len(m))

def main():
    if sys.argv[1:] == ['--install']: return install()
    only = set(sys.argv[1:])
    src = json.load(open(os.path.join(ROOT, 'tools/art_sources.json')))
    cards = {c['id']: c for c in json.load(open(os.path.join(ROOT, 'src/data/cards.json')))['cards']}
    for kind in ('cards', 'heroes'):
        os.makedirs(os.path.join(OUT, kind), exist_ok=True)
        for id_, spec in src[kind].items():
            if only and id_ not in only: continue
            path = os.path.join(ROOT, 'public/art/v2', kind, id_ + '.webp')
            if not os.path.exists(path): continue
            tribe = spec.get('tribe') or (cards[id_]['tribe'] if kind == 'cards' and id_ in cards else 'neutral' if kind == 'cards' else 'hero')
            if spec.get('px'):
                im = native_sprite(path, tribe, spec.get('center', False))
                if im is None: continue
                if max(im.size) > 56: im = im.resize((round(im.width * 48 / max(im.size)), round(im.height * 48 / max(im.size))), Image.NEAREST)
                r, _ = retro(im)
                r = place(r, spec.get('center', False))
            else:
                r, _ = retro(illustration(path))
            r.save(os.path.join(OUT, kind, id_ + '.png'))
            print(kind, id_, r.size, flush=True)

if __name__ == '__main__':
    main()
