"""Drops ground shadows from the retro card art: a flat blob lying under the figure, not touching it.
Run: python3 tools/retro_unshadow.py [--write]   (works on tools/art_retro/cards/*.png in place)"""
import sys, glob, os
import numpy as np
from PIL import Image
BG = (32, 31, 35)

def comps(m):
    h, w = m.shape; lab = np.full((h, w), -1); out = []
    for y in range(h):
        for x in range(w):
            if m[y, x] and lab[y, x] < 0:
                st = [(y, x)]; lab[y, x] = len(out); pts = []
                while st:
                    cy, cx = st.pop(); pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and lab[ny, nx] < 0:
                                lab[ny, nx] = len(out); st.append((ny, nx))
                out.append(pts)
    return out

def shadows(a):
    m = (a != BG).any(2)
    # full-bleed pictures (no dark corners) have no separate shadow to drop
    if m[0, 0] or m[0, -1] or m[-1, 0] or m[-1, -1]: return []
    cs = sorted(comps(m), key=len, reverse=True)
    if len(cs) < 2: return []
    body = cs[0]; by1 = max(y for y, _ in body); by0 = min(y for y, _ in body)
    found = []
    for c in cs[1:]:
        ys = [y for y, _ in c]; xs = [x for _, x in c]
        hh = max(ys) - min(ys) + 1; ww = max(xs) - min(xs) + 1
        if min(ys) >= by1 - 1 and hh <= max(4, (by1 - by0 + 1) * 0.5) and ww >= max(5, 1.5 * hh) \
                and len({tuple(a[y, x]) for y, x in c}) == 1:  # a shadow is one flat colour
            found.append(c)
    return found

if __name__ == '__main__':
    write = '--write' in sys.argv
    for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'art_retro/cards/*.png'))):
        im = Image.open(f).convert('RGB'); a = np.asarray(im).copy()
        sh = shadows(a)
        if not sh: continue
        print(os.path.basename(f), [len(c) for c in sh])
        if write:
            for c in sh:
                for y, x in c: a[y, x] = BG
            Image.fromarray(a).save(f)
