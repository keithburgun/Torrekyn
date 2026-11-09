"""
Builds the illustrated card and hero art (public/art/v2/) from Keith's art archives.

  python3 tools/build_art.py <assets dir> [ids...]

<assets dir> holds the unzipped archives (RGB_PNG, Illustrations, Images, Circle and square icons).
Which image each card/hero uses, and how it is cropped, lives in tools/art_sources.json.
Crops are [centre x, centre y, side] as fractions of the image (side = fraction of the shorter edge).
Pixel sprites (px: true) use their first animation frame, scaled up sharp on a tribe-coloured backdrop.
flip: true mirrors the result left-to-right.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 480

def roots(a):
    ill = os.path.join(a, 'x_Illustrations/Illustrations-20261107T142038Z-1-001/Illustrations')
    img = os.path.join(a, 'x_Images/Images')
    return {
        'R': os.path.join(a, 'x_RGB_PNG/RGB PNG'),
        'I': ill, 'C': os.path.join(ill, 'Characters'),
        'M': img, 'P': os.path.join(img, 'UI/characterportraits'), 'U': os.path.join(img, 'UI/characterportraits/UnitUIIcons'),
        'G': os.path.join(img, 'GemImages/Resources'), 'N': os.path.join(img, 'NMB Intro'), 'S': os.path.join(img, 'Units'),
        'T': os.path.join(img, 'Tiles'), 'UI': os.path.join(img, 'UI'),
        'K': os.path.join(a, 'x_Icons/Circle and square icons/RGB PNG'),
        'X': os.path.join(a, 'x_Sprites/Sprites'),
    }

# backdrop colours per tribe (centre, edge) for pixel sprites and transparent art
TRIBE_BG = {
    'neverending': ('#b9a3e8', '#4b2f7a'), 'azure': ('#9cc3ff', '#1f3a85'), 'kindred': ('#ffc2df', '#a8457a'),
    'brambor': ('#e6c49a', '#6b4422'), 'cloister': ('#a8dba0', '#2f6b35'), 'alcove': ('#fff1a0', '#b38a12'),
    'demons': ('#ffb0a0', '#8a2020'), 'neutral': ('#ffffff', '#262424'), 'hero': ('#d8ccf5', '#4a3d70'),
}

def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def backdrop(tribe):
    c, e = (hexrgb(x) for x in TRIBE_BG.get(tribe, TRIBE_BG['neutral']))
    n = 64
    g = Image.new('RGB', (n, n))
    px = g.load()
    for y in range(n):
        for x in range(n):
            d = min(1, ((x - n / 2) ** 2 + (y - n * 0.45) ** 2) ** 0.5 / (n * 0.62))
            px[x, y] = tuple(round(c[i] + (e[i] - c[i]) * d) for i in range(3))
    return g.resize((SIZE, SIZE), Image.BICUBIC).convert('RGBA')

def first_frame(im, box=None):
    if box:
        return im.crop(tuple(box))
    w, h = im.size
    if w > h and w % h == 0:
        im = im.crop((0, 0, h, h))
    return im

def trim(im):
    bb = im.getchannel('A').getbbox()
    return im.crop(bb) if bb else im

def scale2x(im):
    """EPX / Scale2x: doubles a sprite, rounding off stair-step diagonals instead of copying blocks"""
    import numpy as np
    a = np.asarray(im.convert('RGBA')).astype(np.int64)
    key = (a[..., 0] << 24) | (a[..., 1] << 16) | (a[..., 2] << 8) | a[..., 3]
    p = np.pad(key, 1, mode='edge')
    A, D, C, Bk = p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]
    pa = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode='edge')
    Cp, Bp = pa[1:-1, :-2], pa[1:-1, 2:]
    h, w = key.shape
    out = np.zeros((h * 2, w * 2, 4), np.int64)
    pick = lambda cond, src: np.where(cond[..., None], src, a)
    out[0::2, 0::2] = pick((C == A) & (C != D) & (A != Bk), Cp)
    out[0::2, 1::2] = pick((A == Bk) & (A != C) & (Bk != D), Bp)
    out[1::2, 0::2] = pick((D == C) & (D != Bk) & (C != A), Cp)
    out[1::2, 1::2] = pick((Bk == D) & (Bk != A) & (D != C), Bp)
    return Image.fromarray(out.astype('uint8'), 'RGBA')

# 'smooth': Scale2x three times, then a soft (Lanczos) resize: rounded edges, slightly soft. 'sharp': plain nearest-neighbour blocks.
PX_MODE = os.environ.get('PX_MODE', 'smooth')

def upscale_sprite(im, k):
    w, h = im.size
    if PX_MODE == 'sharp':
        return im.resize((w * max(1, int(k)), h * max(1, int(k))), Image.NEAREST)
    big = im
    while big.width < w * k:
        big = scale2x(big)
    # resize in premultiplied alpha so see-through edges don't pick up dark fringes
    big = big.convert('RGBa').resize((round(w * k), round(h * k)), Image.LANCZOS).convert('RGBA')
    return big

def pixel_art(path, tribe, box=None):
    im = trim(first_frame(Image.open(path).convert('RGBA'), box))
    w, h = im.size
    k = min(SIZE * 0.74 / w, SIZE * 0.74 / h)
    if PX_MODE == 'sharp':
        k = max(1, int(k))
    big = upscale_sprite(im, k)
    out = backdrop(tribe)
    # soft shadow under the sprite
    sh = Image.new('RGBA', out.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((SIZE * 0.24, SIZE * 0.8, SIZE * 0.76, SIZE * 0.9), fill=(0, 0, 0, 70))
    out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    x = (SIZE - big.width) // 2
    y = min(SIZE - big.height - int(SIZE * 0.12), (SIZE - big.height) // 2 + int(SIZE * 0.04))
    out.alpha_composite(big, (x, max(0, y)))
    return out.convert('RGB')

def cropped(path, crop, tribe):
    im = Image.open(path)
    w, h = im.size
    cx, cy, s = crop
    side = s * min(w, h)
    l = min(max(0, cx * w - side / 2), w - side)
    t = min(max(0, cy * h - side / 2), h - side)
    im = im.crop((round(l), round(t), round(l + side), round(t + side)))
    im.draft('RGB', (SIZE * 2, SIZE * 2))
    im = im.convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)
    if im.getchannel('A').getextrema()[0] < 250:
        bg = backdrop(tribe)
        bg.alpha_composite(im)
        im = bg
    return im.convert('RGB')

def main():
    assets = sys.argv[1]
    only = set(sys.argv[2:])
    R = roots(assets)
    src = json.load(open(os.path.join(ROOT, 'tools/art_sources.json')))
    cards = {c['id']: c for c in json.load(open(os.path.join(ROOT, 'src/data/cards.json')))['cards']}
    manifest = {}
    for kind in ('cards', 'heroes'):
        outdir = os.path.join(ROOT, 'public/art/v2', kind)
        os.makedirs(outdir, exist_ok=True)
        for id_, spec in src[kind].items():
            rel = f'art/v2/{kind}/{id_}.webp'
            manifest[f'{kind[:-1] if kind == "cards" else "hero"}:{id_}'] = rel
            if only and id_ not in only:
                continue
            key, _, file = spec['src'].partition('/')
            path = os.path.join(R[key], file)
            tribe = cards[id_]['tribe'] if kind == 'cards' and id_ in cards else 'neutral' if kind == 'cards' else 'hero'
            im = pixel_art(path, tribe, spec.get('box')) if spec.get('px') else cropped(path, spec['crop'], tribe)
            if spec.get('flip'):
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            im.save(os.path.join(ROOT, 'public', rel), 'WEBP', quality=82, method=6)
    json.dump(manifest, open(os.path.join(ROOT, 'src/data/artV2.json'), 'w'), indent=1)
    print('built', len(manifest))

if __name__ == '__main__':
    main()
