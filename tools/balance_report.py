"""
Combines the balance-report shards (tests/report.test.ts) into tables.
  python3 tools/balance_report.py heroes h0.json h1.json
  python3 tools/balance_report.py tribes t0.json t1.json
  python3 tools/balance_report.py hp  x0.json x1.json
Placement: 1 = first, 6 = last, 3.5 = average.
"""
import json, sys, math, collections

mode, files = sys.argv[1], sys.argv[2:]
games = [g for f in files for g in json.load(open(f))]
cards = {c['id']: c for c in json.load(open('src/data/cards.json'))['cards']}
NAMES = {'neverending': 'Neverending Party', 'azure': 'Azure Order', 'kindred': 'Kindred Society', 'brambor': 'Brambor',
         'cloister': 'Cloister', 'alcove': 'Alcove Prefex', 'demons': 'Business Demons', 'neutral': 'Neutral'}

def stat(xs):
    n = len(xs); m = sum(xs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / max(1, n - 1))
    return m, sd / math.sqrt(n), n

print(f'{len(games)} games')
if mode == 'heroes':
    by = collections.defaultdict(list)
    for g in games:
        for p in g['players']: by[p['hero']].append(p['place'])
    out = []
    for h, xs in by.items():
        m, se, n = stat(xs)
        out.append({'hero': h, 'avg': round(m, 2), 'se': round(se, 2), 'n': n, 'win': round(sum(1 for x in xs if x == 1) / n, 3), 'top4': round(sum(1 for x in xs if x <= 4) / n, 3)})
    out.sort(key=lambda r: r['avg'])
    print(json.dumps(out, indent=1))
    # cards on final armies: average placement when the card is there, compared with other cards of the same tier
    with_card = collections.defaultdict(list); by_tier = collections.defaultdict(list)
    for g in games:
        for p in g['players']:
            seen = set(c.rstrip('*') for c in p['board'])
            for cid in seen:
                if cid not in cards or cards[cid].get('token'): continue
                with_card[cid].append(p['place']); by_tier[cards[cid]['tier']].append(p['place'])
    tier_avg = {t: sum(v) / len(v) for t, v in by_tier.items()}
    rows = []
    for cid, xs in with_card.items():
        m, se, n = stat(xs); c = cards[cid]
        rows.append({'id': cid, 'name': c['name'], 'tribe': c['tribe'], 'tier': c['tier'], 'avg': round(m, 2), 'vsTier': round(tier_avg[c['tier']] - m, 2), 'se': round(se, 2), 'n': n})
    json.dump(rows, open('/tmp/claude-0/-home-claude/4bd39753-7300-558e-83b8-89912b7ef21f/scratchpad/cards_rows.json', 'w'))
    for t in NAMES:
        rs = sorted([r for r in rows if r['tribe'] == t], key=lambda r: -r['vsTier'])
        print(f"\n== {NAMES[t]}")
        for r in rs: print(f"  {r['name']:<22} T{r['tier']}  avg {r['avg']:.2f}  vs tier {r['vsTier']:+.2f} ±{r['se']:.2f}  (n={r['n']})")
    main = collections.defaultdict(list)
    for g in games:
        for p in g['players']: main[p['main']].append(p['place'])
    print('\n== main tribe of final army (all Expert)')
    for t, xs in sorted(main.items(), key=lambda kv: sum(kv[1]) / len(kv[1])):
        m, se, n = stat(xs); print(f"  {NAMES.get(t, t):<20} avg {m:.2f} ±{se:.2f} n={n}")
elif mode == 'tribes':
    forced = collections.defaultdict(list); succeeded = collections.Counter(); free = []
    for g in games:
        for p in g['players']:
            if p['forced']:
                forced[p['forced']].append(p['place'])
                if p['main'] == p['forced']: succeeded[p['forced']] += 1
            else: free.append(p['place'])
    print('== committed to a tribe (Expert skill) vs uncommitted Expert seats')
    m, se, n = stat(free); print(f"  {'(uncommitted)':<20} avg {m:.2f} ±{se:.2f} n={n}")
    for t, xs in sorted(forced.items(), key=lambda kv: sum(kv[1]) / len(kv[1])):
        m, se, n = stat(xs)
        print(f"  {NAMES[t]:<20} avg {m:.2f} ±{se:.2f} win {sum(1 for x in xs if x == 1) / n:.1%} top4 {sum(1 for x in xs if x <= 4) / n:.1%}  n={n}  (ended with 3+ of the tribe {succeeded[t] / n:.0%})")
elif mode == 'hp':
    by = collections.defaultdict(list)
    for g in games:
        for p in g['players']: by[p.get('hpDelta', 0)].append(p['place'])
    for d, xs in sorted(by.items()):
        m, se, n = stat(xs); print(f"  health {d:+d}: avg {m:.3f} ±{se:.3f} n={n}")
