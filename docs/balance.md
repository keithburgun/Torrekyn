# Balance report (November 2026)

All numbers come from games where every seat is played by the Expert bot (`tests/report.test.ts`,
combined by `tools/balance_report.py`). Placement: 1 = first, 6 = last, 3.5 = average.

## Heroes

3,000 games at 45 Health each, then 3,000 more with the new starting Health.
Health is worth about **0.055 places per point** (measured: 10 less Health = 0.6 places worse, 10 more = 0.5 places better).

| Hero | Avg place at 45 Health | Win rate | New Health | Avg place now |
|---|---|---|---|---|
| May Danaris | 2.99 | 26% | 36 | 3.45 |
| Clover | 2.99 | 25% | 36 | 3.46 |
| Abragail | 2.99 | 27% | 36 | 3.45 |
| Trevor L | 3.32 | 20% | 42 | 3.55 |
| Venice Gorn | 3.40 | 18% | 43 | 3.51 |
| Andromeda Robin | 3.48 | 15% | 45 | 3.52 |
| Gelf Lanz | 3.62 | 16% | 47 | 3.46 |
| Eve Williams | 3.65 | 12% | 48 | 3.50 |
| Bill Milton | 3.74 | 12% | 49 | 3.53 |
| Derby Pocket | 3.75 | 14% | 50 | 3.50 |
| Croh Vosh | 3.75 | 12% | 50 | 3.44 |
| Omar Evans | 3.76 | 13% | 50 | 3.50 |
| Bunny Wizard | 3.86 | 14% | 52 | 3.55 |
| Locas Clare | 4.14 | 4% | 57 | 3.59 |

## Tribes

Two ways of looking at it:

**Committed** (3,000 games): 4 seats each try to build one of the game's tribes, 2 seats play freely. Average placement:
```
== committed to a tribe (Expert skill) vs uncommitted Expert seats
  (uncommitted)        avg 3.46 ±0.02 n=6000
  Kindred Society      avg 3.38 ±0.04 win 18.8% top4 68.6%  n=1712  (ended with 3+ of the tribe 20%)
  Cloister             avg 3.42 ±0.04 win 19.3% top4 67.4%  n=1719  (ended with 3+ of the tribe 34%)
  Azure Order          avg 3.50 ±0.04 win 17.2% top4 66.3%  n=1667  (ended with 3+ of the tribe 32%)
  Alcove Prefex        avg 3.51 ±0.04 win 15.2% top4 67.5%  n=1775  (ended with 3+ of the tribe 57%)
  Business Demons      avg 3.58 ±0.04 win 16.1% top4 65.4%  n=1666  (ended with 3+ of the tribe 20%)
  Brambor              avg 3.61 ±0.04 win 14.7% top4 64.6%  n=1719  (ended with 3+ of the tribe 19%)
  Neverending Party    avg 3.66 ±0.04 win 14.8% top4 63.2%  n=1742  (ended with 3+ of the tribe 23%)
```

**Finished with** (the 3,000 hero games): average placement by the tribe with 3+ units in the final army:
```
  Alcove Prefex        avg 2.89 ±0.02 n=4839
  Kindred Society      avg 3.14 ±0.06 n=847
  Cloister             avg 3.23 ±0.04 n=2254
  Azure Order          avg 3.63 ±0.04 n=1862
  mixed                avg 3.71 ±0.02 n=5381
  Neverending Party    avg 3.97 ±0.05 n=999
  Brambor              avg 4.36 ±0.05 n=893
  Business Demons      avg 4.85 ±0.04 n=925
```


## Cards

For each card: average placement of the players whose final army had it, compared with all cards of the same Tier
(+ = those players did better than average for that Tier). This shows what the Expert bot does well with;
cards the bot rarely keeps (low n) are less certain (± is the standard error).

### Neverending Party
```
  Necromancer            T4  avg 3.29  vs tier +0.26 ±0.04  (n=1693)
  Ancient Name           T5  avg 2.50  vs tier -0.04 ±0.03  (n=2213)
  Ash                    T1  avg 4.72  vs tier -0.04 ±0.08  (n=297)
  Skeleton               T1  avg 4.74  vs tier -0.06 ±0.14  (n=96)
  Lich                   T4  avg 3.72  vs tier -0.17 ±0.05  (n=1081)
  Returner               T5  avg 2.65  vs tier -0.19 ±0.05  (n=680)
  Romance                T4  avg 3.75  vs tier -0.20 ±0.05  (n=994)
  Memory                 T1  avg 4.94  vs tier -0.26 ±0.06  (n=512)
  Ashlie                 T2  avg 4.77  vs tier -0.43 ±0.05  (n=858)
  Abandon                T5  avg 2.89  vs tier -0.43 ±0.07  (n=414)
  Thicket                T2  avg 5.00  vs tier -0.66 ±0.07  (n=310)
  Bramble                T2  avg 5.00  vs tier -0.66 ±0.05  (n=576)
  Funeral                T3  avg 4.53  vs tier -0.72 ±0.20  (n=58)
  Sickle                 T3  avg 4.61  vs tier -0.79 ±0.09  (n=213)
  Horseman               T3  avg 4.72  vs tier -0.91 ±0.14  (n=94)
```

### Azure Order
```
  Time Cannot Destroy    T4  avg 3.08  vs tier +0.47 ±0.03  (n=2159)
  Tourmaline             T1  avg 4.31  vs tier +0.36 ±0.04  (n=1395)
  Remember               T4  avg 3.25  vs tier +0.30 ±0.03  (n=1949)
  Shield                 T1  avg 4.74  vs tier -0.06 ±0.10  (n=219)
  Commitment             T5  avg 2.55  vs tier -0.09 ±0.04  (n=1379)
  Gelf Lanz              T5  avg 2.56  vs tier -0.10 ±0.03  (n=1601)
  Catapult               T4  avg 3.81  vs tier -0.26 ±0.06  (n=639)
  Royal Guard            T2  avg 4.67  vs tier -0.33 ±0.06  (n=613)
  Lake                   T1  avg 5.05  vs tier -0.37 ±0.26  (n=19)
  Front and Center       T3  avg 4.20  vs tier -0.38 ±0.05  (n=1190)
  Knight                 T3  avg 4.24  vs tier -0.42 ±0.05  (n=1007)
  Ocean Sky              T5  avg 2.91  vs tier -0.45 ±0.10  (n=196)
  Command                T2  avg 4.83  vs tier -0.49 ±0.07  (n=290)
  Longbow                T3  avg 4.50  vs tier -0.68 ±0.08  (n=367)
  Message                T2  avg 5.19  vs tier -0.85 ±0.08  (n=201)
```

### Kindred Society
```
  Librarian              T1  avg 4.33  vs tier +0.35 ±0.11  (n=180)
  Barton                 T4  avg 3.32  vs tier +0.23 ±0.03  (n=2270)
  Honeysuckle            T5  avg 2.29  vs tier +0.17 ±0.02  (n=3020)
  Hug                    T2  avg 4.36  vs tier -0.02 ±0.12  (n=193)
  Doctor                 T1  avg 4.81  vs tier -0.14 ±0.18  (n=70)
  Life                   T4  avg 3.81  vs tier -0.26 ±0.04  (n=1787)
  Architect              T1  avg 5.00  vs tier -0.32 ±0.30  (n=21)
  Pink Gem               T2  avg 4.69  vs tier -0.35 ±0.06  (n=478)
  1000 Miles             T4  avg 3.96  vs tier -0.41 ±0.21  (n=55)
  Restore                T5  avg 2.88  vs tier -0.42 ±0.05  (n=784)
  Therapist              T3  avg 4.43  vs tier -0.62 ±0.23  (n=44)
  Devotion               T5  avg 3.13  vs tier -0.67 ±0.11  (n=169)
  Builder                T3  avg 4.67  vs tier -0.85 ±0.13  (n=114)
  Patchwork              T2  avg 5.21  vs tier -0.86 ±0.20  (n=39)
  Vulnerability          T3  avg 4.70  vs tier -0.89 ±0.10  (n=203)
```

### Brambor
```
  Andromeda Robin        T5  avg 2.47  vs tier -0.01 ±0.04  (n=1081)
  Roll Guard             T2  avg 4.39  vs tier -0.05 ±0.05  (n=1023)
  Organizer              T1  avg 4.77  vs tier -0.09 ±0.09  (n=242)
  Sapling                T1  avg 4.89  vs tier -0.21 ±0.08  (n=245)
  Chosen Name            T5  avg 2.71  vs tier -0.25 ±0.04  (n=1258)
  Ancient Name           T5  avg 2.70  vs tier -0.25 ±0.06  (n=645)
  Farmer                 T1  avg 5.08  vs tier -0.40 ±0.14  (n=78)
  Splashmaster           T3  avg 4.25  vs tier -0.43 ±0.04  (n=1287)
  Distant Land           T4  avg 3.98  vs tier -0.44 ±0.06  (n=723)
  Witch                  T4  avg 4.10  vs tier -0.55 ±0.07  (n=512)
  Warlock                T4  avg 4.10  vs tier -0.55 ±0.16  (n=97)
  Root                   T2  avg 4.92  vs tier -0.58 ±0.06  (n=341)
  Honeysuckle            T2  avg 5.00  vs tier -0.66 ±0.05  (n=554)
  Cursed Vines           T3  avg 4.63  vs tier -0.81 ±0.17  (n=78)
  Elder                  T3  avg 4.74  vs tier -0.92 ±0.08  (n=317)
```

### Cloister
```
  Secret                 T3  avg 3.34  vs tier +0.47 ±0.03  (n=3494)
  Forest Abomination     T3  avg 3.44  vs tier +0.37 ±0.03  (n=3304)
  Disciple               T1  avg 4.67  vs tier +0.00 ±0.22  (n=40)
  Omar Evans             T5  avg 2.51  vs tier -0.05 ±0.02  (n=3484)
  Green Ninja            T2  avg 4.50  vs tier -0.16 ±0.04  (n=1278)
  Ambush                 T4  avg 3.71  vs tier -0.16 ±0.20  (n=78)
  Shine Like a Knife     T5  avg 2.63  vs tier -0.17 ±0.04  (n=1211)
  Red Sea Snake          T4  avg 3.76  vs tier -0.21 ±0.07  (n=556)
  Storyteller            T1  avg 4.92  vs tier -0.25 ±0.05  (n=483)
  Larva                  T4  avg 3.83  vs tier -0.28 ±0.20  (n=46)
  Hunter                 T2  avg 4.82  vs tier -0.48 ±0.05  (n=513)
  Owl                    T2  avg 4.87  vs tier -0.53 ±0.09  (n=230)
  Shadow Place           T5  avg 3.27  vs tier -0.81 ±0.17  (n=81)
  Songstress             T3  avg 4.92  vs tier -1.10 ±0.13  (n=118)
```

### Alcove Prefex
```
  Sniper                 T2  avg 3.60  vs tier +0.74 ±0.03  (n=4339)
  May Danaris            T5  avg 2.03  vs tier +0.43 ±0.02  (n=2794)
  Mod                    T2  avg 4.00  vs tier +0.34 ±0.03  (n=2447)
  Left Twinbot           T1  avg 4.47  vs tier +0.21 ±0.11  (n=166)
  Right Twinbot          T1  avg 4.47  vs tier +0.21 ±0.14  (n=105)
  WARMECH                T5  avg 2.26  vs tier +0.20 ±0.03  (n=2263)
  Golden Light           T5  avg 2.35  vs tier +0.10 ±0.02  (n=3668)
  Robot Boy              T4  avg 3.48  vs tier +0.07 ±0.03  (n=3215)
  Chaos                  T2  avg 4.33  vs tier +0.01 ±0.22  (n=45)
  Computer               T3  avg 3.92  vs tier -0.10 ±0.03  (n=2769)
  Paradox                T4  avg 3.82  vs tier -0.27 ±0.24  (n=38)
  Tinker                 T1  avg 5.04  vs tier -0.36 ±0.24  (n=26)
  Aerial Drone           T3  avg 4.24  vs tier -0.43 ±0.26  (n=45)
  Scientist              T4  avg 4.19  vs tier -0.64 ±0.08  (n=333)
  Virus                  T3  avg 4.46  vs tier -0.65 ±0.35  (n=13)
```

### Business Demons
```
  Pyro                   T2  avg 4.09  vs tier +0.25 ±0.04  (n=1892)
  Exploit                T5  avg 2.32  vs tier +0.14 ±0.30  (n=19)
  Gargoil                T4  avg 3.48  vs tier +0.07 ±0.20  (n=77)
  Shopkeep               T1  avg 4.80  vs tier -0.12 ±0.05  (n=625)
  Drill Sgt.             T1  avg 4.88  vs tier -0.21 ±0.04  (n=978)
  Intern                 T1  avg 4.93  vs tier -0.25 ±0.07  (n=385)
  Red Gem                T3  avg 4.07  vs tier -0.25 ±0.04  (n=1401)
  Purveyor               T4  avg 3.99  vs tier -0.44 ±0.07  (n=428)
  Miner                  T4  avg 4.03  vs tier -0.48 ±0.12  (n=182)
  Investor               T3  avg 4.43  vs tier -0.61 ±0.26  (n=35)
  Biker                  T3  avg 4.45  vs tier -0.63 ±0.04  (n=1190)
  Bill Milton            T5  avg 3.18  vs tier -0.72 ±0.23  (n=45)
  Jeweler                T2  avg 5.09  vs tier -0.75 ±0.10  (n=122)
  Gem Wizard             T5  avg 3.27  vs tier -0.81 ±0.31  (n=30)
  Treasure               T2  avg 5.20  vs tier -0.86 ±0.20  (n=10)
```

### Neutral
```
  Locas                  T3  avg 3.52  vs tier +0.30 ±0.02  (n=6337)
  Pickaxe                T1  avg 4.48  vs tier +0.20 ±0.05  (n=893)
  Sword                  T1  avg 4.50  vs tier +0.18 ±0.50  (n=12)
  Broken Land            T5  avg 2.46  vs tier +0.00 ±0.02  (n=5068)
  Vampire                T3  avg 3.90  vs tier -0.08 ±0.03  (n=3742)
  Sarinee                T4  avg 3.67  vs tier -0.12 ±0.03  (n=1896)
  Spoonful               T4  avg 3.84  vs tier -0.30 ±0.15  (n=90)
  Poison                 T3  avg 4.19  vs tier -0.37 ±0.06  (n=777)
  Gold Banner            T2  avg 4.84  vs tier -0.50 ±0.03  (n=1476)
  Silver Banner          T2  avg 4.99  vs tier -0.65 ±0.05  (n=760)
  Grief                  T4  avg 4.21  vs tier -0.67 ±0.09  (n=312)
  Omni-Gem               T5  avg 3.14  vs tier -0.68 ±0.11  (n=191)
  Shield                 T1  avg 5.50  vs tier -0.82 ±0.20  (n=14)
  Scout                  T2  avg 5.23  vs tier -0.89 ±0.05  (n=395)
  Tom Judith             T5  avg 3.41  vs tier -0.96 ±0.10  (n=211)
```
