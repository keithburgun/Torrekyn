"""
Find card/hero art that shows the same sprite twice (also recolours and other frames of one sprite sheet).

    python3 tools/art_dupes.py <assets dir>                    # look-alike pairs among the art in use
    python3 tools/art_dupes.py <assets dir> X/foo.png S/a/b.png   # how close candidate images are to the art in use

Pixel sprites are compared by their silhouette (so a recolour still matches) and by their brightness structure;
illustrations by brightness structure. Lower = more alike: under ~0.12 is almost certainly the same sprite.
"""
import json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import build_art as B  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(R, src, px, crop=None, box=None):
    key, _, file = src.partition('/')
    path = os.path.join(R[key], file)
    im = Image.open(path).convert('RGBA')
    if px:
        im = B.first_frame(im, box)
        bbox = im.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
        if bbox: im = im.crop(bbox)
    elif crop:
        cx, cy, side = crop
        s = side * min(im.size); l = cx * im.width - s / 2; t = cy * im.height - s / 2
        im = im.crop((int(l), int(t), int(l + s), int(t + s)))
    return im


def sig(im):
    sq = max(im.size)
    canvas = Image.new('RGBA', (sq, sq), (0, 0, 0, 0)); canvas.paste(im, ((sq - im.width) // 2, (sq - im.height) // 2))
    mask = np.asarray(canvas.getchannel('A').resize((16, 16), Image.BILINEAR)) > 60
    g = np.asarray(canvas.convert('LA').resize((17, 16), Image.BILINEAR), dtype=int)
    lum = g[..., 0] * (g[..., 1] > 60)
    return mask.flatten(), (lum[:, 1:] > lum[:, :-1]).flatten()


def dist(a, b):
    m = (a[0] != b[0]).mean(); s = (a[1] != b[1]).mean()
    return round(float(0.5 * m + 0.5 * s), 3)


def main():
    R = B.roots(sys.argv[1])
    src = json.load(open(os.path.join(ROOT, 'tools/art_sources.json')))
    used = {}
    for kind in ('cards', 'heroes'):
        for id_, spec in src[kind].items():
            try: used[f'{kind[:-1]}:{id_}'] = (spec['src'], sig(load(R, spec['src'], spec.get('px'), spec.get('crop'), spec.get('box'))))
            except Exception as e: print('skip', id_, e)
    if len(sys.argv) > 2:
        for cand in sys.argv[2:]:
            s = sig(load(R, cand, True))
            near = sorted((dist(s, v[1]), k) for k, v in used.items())[:3]
            print(cand, near)
        return
    ks = sorted(used); out = []
    for i in range(len(ks)):
        for j in range(i + 1, len(ks)):
            d = dist(used[ks[i]][1], used[ks[j]][1])
            if d < 0.16: out.append((d, ks[i], ks[j]))
    for d, a, b in sorted(out): print(f'{d:.3f}  {a:<28} {b:<28} {used[a][0]}  |  {used[b][0]}')


if __name__ == '__main__':
    main()
