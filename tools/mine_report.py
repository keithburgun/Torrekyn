"""Pop-off mining report (tests/mine.test.ts output): which cards and pairs are over-represented in armies that pop off."""
import json, sys, collections, itertools
files = sys.argv[1:]
D = {'pops': [], 'streaks': [], 'base': [], 'ages': [], 'unitsSeen': 0}
for f in files:
    d = json.load(open(f))
    for k in ('pops', 'streaks', 'base', 'ages'): D[k] += d[k]
    D['unitsSeen'] += d['unitsSeen']
cards = {c['id']: c for c in json.load(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', 'src/data/cards.json')))['cards']}
name = lambda i: cards.get(i, {'name': i})['name']
pops, streaks, base, ages = D['pops'], D['streaks'], D['base'], D['ages']
print(f"pop-offs: {len(pops)}  streaks of 8+: {len(streaks)}  late-game armies (round 9+): {len(base)}")
print(f"avg round of pop-off {sum(p['round'] for p in pops)/max(1,len(pops)):.1f}; streak reached at round {sum(p['round'] for p in streaks)/max(1,len(streaks)):.1f}")
a = sorted(ages); n = len(a)
print(f"units leaving the army: {n}; rounds on the army: median {a[n//2]}, 25% {a[n//4]}, 75% {a[3*n//4]}; left within 1 round {sum(1 for x in a if x<=1)/n:.0%}")
big = collections.Counter(i for p in pops for i in set(p['big']))
print('\nunits that reached triple digits (how often):')
for i, c in big.most_common(15): print(f"  {name(i):<22} {c}")
def setof(x): return set(u['id'] for u in x['army'] if u['id'] in cards and not cards[u['id']].get('token'))
def lift(group, label, minsup=25, top=20):
    B = [setof(x) for x in base]; G = [setof(x) for x in group]
    pb = collections.Counter(i for s in B for i in s); pg = collections.Counter(i for s in G for i in s)
    rows = []
    for i, c in pg.items():
        if c < minsup: continue
        l = (c / len(G)) / max(1e-9, pb[i] / len(B))
        rows.append((l, i, c))
    rows.sort(reverse=True)
    print(f"\n{label}: cards most over-represented (in X% of these armies vs Y% of late armies)")
    for l, i, c in rows[:top]: print(f"  {name(i):<22} x{l:4.1f}  {c/len(G):4.0%} vs {pb[i]/len(B):4.0%}")
    # pairs
    pairs_b = collections.Counter(); pairs_g = collections.Counter()
    for s in B: pairs_b.update(itertools.combinations(sorted(s), 2))
    for s in G: pairs_g.update(itertools.combinations(sorted(s), 2))
    prow = []
    for pr, c in pairs_g.items():
        if c < minsup: continue
        pg_ = c / len(G); pb_ = pairs_b[pr] / len(B)
        # how much more than the two cards' own lifts would predict
        l1 = (pg[pr[0]] / len(G)) / max(1e-9, pb[pr[0]] / len(B)); l2 = (pg[pr[1]] / len(G)) / max(1e-9, pb[pr[1]] / len(B))
        lp = pg_ / max(1e-9, pb_)
        prow.append((lp, lp / max(l1, l2), pr, c))
    prow.sort(reverse=True)
    print(f"  pairs (lift; 'synergy' = pair lift beyond the better card alone):")
    for lp, syn, pr, c in prow[:top]: print(f"  {name(pr[0]) + ' + ' + name(pr[1]):<44} x{lp:4.1f}  synergy x{syn:3.1f}  {c/len(G):4.0%} vs {pairs_b[pr]/len(B):5.1%}")
lift(pops, 'POP-OFFS')
lift(streaks, 'WIN STREAKS 8+', minsup=15)
