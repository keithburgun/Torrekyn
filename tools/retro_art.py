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

# ---- the second method ("faithful"): set per card with a "retro" entry in art_sources.json ----
# {"retro": {"src": "S/Potato/shotgun.png", "fw": 32, "K": 5, "n": 48, "crop": [...], "lift": 0.1, "sat": 1.15, "tint": "silver", "draw": "coin"}}
# Sprites are read from the source sheets at their true pixel size (see-through shadow pixels dropped), illustrations shrunk to n px;
# then K colours that stay close to the original, with the sprite's outer outline dropped to the background.
ASSETS = os.environ.get('TORREKIN_ASSETS', '/tmp/claude-0/-home-claude/4bd39753-7300-558e-83b8-89912b7ef21f/scratchpad/assets')
def _roots(): return B.roots(ASSETS)

def native(im, box=None, frame_w=None):
    """source sprite at its true pixel size: first frame, upscaling undone, see-through (shadow) pixels dropped"""
    if box: im = im.crop(tuple(box))
    elif frame_w: im = im.crop((0, 0, frame_w, im.height))
    else: im = B.first_frame(im)
    a = np.asarray(im).copy()
    # find an integer upscale: every k x k block one colour
    h, w = a.shape[:2]
    for k in (8, 6, 5, 4, 3, 2):
        if h % k or w % k: continue
        blk = a.reshape(h // k, k, w // k, k, 4)
        if (blk == blk[:, :1, :, :1]).all():
            a = blk[:, 0, :, 0]; break
    al = a[..., 3]
    a[al < 200] = 0  # shadows and soft edges
    a[al >= 200, 3] = 255
    return B.trim(Image.fromarray(a, 'RGBA'))


def faithful(im, K=5, seed=1, sat=1.15, keep_outline=False, lift=0.0):
    """K colours that stay close to the original; the sprite's outline colour drops to the background"""
    a = np.asarray(im.convert('RGBA')).astype(float); h, w = a.shape[:2]
    m = a[..., 3] > 0; P = a[m][:, :3]
    K = min(K, max(2, len(np.unique(P.astype(int), axis=0))))
    rng = np.random.default_rng(seed)
    # k-means++ seeding
    C = [P[rng.integers(len(P))]]
    for _ in range(K - 1):
        d = np.min([((P - c) ** 2).sum(1) for c in C], 0)
        C.append(P[rng.choice(len(P), p=d / d.sum())] if d.sum() else P[rng.integers(len(P))])
    C = np.array(C)
    for _ in range(40):
        lab = ((P[:, None] - C[None]) ** 2).sum(2).argmin(1)
        C = np.array([P[lab == k].mean(0) if (lab == k).any() else C[k] for k in range(K)])
    L = np.full((h, w), -1); L[m] = lab
    transparent = (~m).any()
    drop = set()
    if transparent and not keep_outline:
        ring = np.zeros_like(m)
        for y in range(h):
            for x in range(w):
                if m[y, x] and any(not (0 <= x + dx < w and 0 <= y + dy < h) or not m[y + dy, x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))): ring[y, x] = True
        rl = L[ring]
        oc = np.bincount(rl[rl >= 0], minlength=K).argmax()
        if lum(C[oc]) < 70:
            # outer outline pixels of that colour become background
            for y in range(h):
                for x in range(w):
                    if ring[y, x] and L[y, x] == oc: L[y, x] = -1
            # repeat once (2px outlines)
    cols = []
    for c in C:
        hh, ll, ss = colorsys.rgb_to_hls(*(c / 255))
        ll = min(0.95, max(0.16, ll + lift))
        cols.append(tuple(int(v * 255) for v in colorsys.hls_to_rgb(hh, ll, min(1, ss * sat))))
    # lone pixels take their neighbours' colour
    out = L.copy()
    for y in range(h):
        for x in range(w):
            t = L[y, x]
            if t < 0: continue
            nb = [L[y + dy, x + dx] for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and 0 <= y + dy < h and 0 <= x + dx < w]
            nb = [v for v in nb if v >= 0]
            if len(nb) >= 5 and nb.count(t) == 0: out[y, x] = max(set(nb), key=nb.count)
    res = Image.new('RGB', (w, h), BG); p = res.load()
    for y in range(h):
        for x in range(w):
            if out[y, x] >= 0: p[x, y] = cols[out[y, x]]
    return res


def illus_a(spec, n=40, crop=None):
    """like illus, but a see-through picture keeps its transparency (no backdrop)"""
    key, _, f = spec['src'].partition('/')
    im = Image.open(os.path.join(_roots()[key], f)).convert('RGBA')
    w, h = im.size
    cx, cy, s = crop or spec.get('crop', [0.5, 0.5, 1.0])
    side = s * min(w, h)
    l = min(max(0, cx * w - side / 2), w - side); t = min(max(0, cy * h - side / 2), h - side)
    im = im.crop((round(l), round(t), round(l + side), round(t + side)))
    im = im.convert('RGBa').resize((n, n), Image.BOX).convert('RGBA')
    a = np.asarray(im).copy()
    if a[..., 3].min() < 250:
        a[a[..., 3] < 140] = 0; a[a[..., 3] >= 140, 3] = 255
    else:
        a[..., 3] = 255
    return Image.fromarray(a, 'RGBA')


def draw_coin(n=28):
    """a plain gold coin: a solid disc with a darker rim and one small highlight"""
    from PIL import ImageDraw
    S = n + 4; im = Image.new('RGB', (S, S), BG); d = ImageDraw.Draw(im)
    d.ellipse((2, 2, 2 + n - 1, 2 + n - 1), fill=(176, 120, 30))
    d.ellipse((4, 4, 2 + n - 3, 2 + n - 3), fill=(236, 186, 64))
    d.ellipse((8, 8, 2 + n - 7, 2 + n - 7), fill=(214, 160, 46))
    d.ellipse((10, 10, 2 + n - 9, 2 + n - 9), fill=(236, 186, 64))
    d.rectangle((9, 8, 11, 9), fill=(255, 236, 170)); d.rectangle((8, 10, 9, 11), fill=(255, 236, 170))
    return im

def tinted(im, tint):
    if tint != 'silver': return im
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            c = px[x, y]
            if c == BG: continue
            hh, ll, ss = colorsys.rgb_to_hls(*(v / 255 for v in c))
            if ss > 0.25 and 0.5 < hh < 0.75:  # the blues become silver
                px[x, y] = tuple(int(v * 255) for v in colorsys.hls_to_rgb(0.62, min(0.92, ll * 1.05 + 0.08), 0.08))
    return im

def retro2(spec, r):
    if r.get('draw') == 'coin': return draw_coin()
    s = {'src': r.get('src', spec['src'])}
    px = r.get('px', spec.get('px', False))
    if px:
        key, _, f = s['src'].partition('/')
        im = native(Image.open(os.path.join(_roots()[key], f)).convert('RGBA'), r.get('box', spec.get('box')), r.get('fw'))
        if max(im.size) > 56: im = im.resize((round(im.width * 48 / max(im.size)), round(im.height * 48 / max(im.size))), Image.NEAREST)
        out = faithful(im, r.get('K', 4), sat=r.get('sat', 1.15), lift=r.get('lift', 0.0), keep_outline=r.get('outline', False))
        out = place(out, spec.get('center', False))
    else:
        im = illus_a({'src': s['src'], 'crop': r.get('crop', spec.get('crop'))}, r.get('n', 48))
        out = faithful(im, r.get('K', 5), sat=r.get('sat', 1.15), lift=r.get('lift', 0.0))
        if (np.asarray(im)[..., 3] == 0).any(): out = place(out, True)
    return tinted(out, r.get('tint'))

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
    src = os.path.join(OUT, 'cards'); dst = os.path.join(OUT, 'game'); os.makedirs(dst, exist_ok=True)
    m = {}
    for f in sorted(os.listdir(src)):
        if not f.endswith('.png'): continue
        g = for_game(Image.open(os.path.join(src, f))); g.save(os.path.join(dst, f))
        # 4x with hard edges: the browser scales that smoothly, so no pixel comes out doubled (see tools/upscale_ui.py)
        g = g.resize((g.width * 4, g.height * 4), Image.NEAREST)
        # bundled into the game as data URIs (tiny files; the artifact host limits how many files a page may have)
        import io, base64
        b = io.BytesIO(); g.save(b, 'PNG', optimize=True)
        m['card:' + f[:-4]] = 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()
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
            if spec.get('retro'):
                r = retro2(spec, spec['retro'])
            elif spec.get('px'):
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
