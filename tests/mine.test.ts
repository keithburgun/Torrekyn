/**
 * Pop-off mining: many bot games; records armies that pop off (a unit at 100+ Attack or Health, grown 100+ beyond its
 * printed stats; or a win streak of 8+), a late-game baseline (round 9+), and how many rounds units stay in the army.
 * Skipped normally. Run:  MINE=1 N=3000 SHARD=0 NSHARDS=2 KEEP=10 OUT=/tmp/m0.json npx vitest run tests/mine.test.ts
 * then  python3 tools/mine_report.py /tmp/m0.json /tmp/m1.json
 */
import { it } from 'vitest';
import fs from 'node:fs';
import { newGame, selectHero, endTurn, human } from '../src/engine/game';
import { pick, def, effStats } from '../src/engine/core';
it.skipIf(!process.env.MINE)('mine', () => {
  const N = Number(process.env.N ?? 100), SH = Number(process.env.SHARD ?? 0), NS = Number(process.env.NSHARDS ?? 1);
  const keep = Number(process.env.KEEP ?? 0);
  const pops: unknown[] = [], streaks: unknown[] = [], base: unknown[] = [], ages: number[] = [];
  const sells: number[] = []; let unitsSeen = 0;
  for (let s = SH; s < N; s += NS) {
    const g = newGame(60000 + s); g.simulateAll = true;
    selectHero(g, pick(g, human(g).heroOffer!)!);
    for (const p of g.players) p.bot = { noise: 0, blunder: 0, x: { keep } } as never;
    const since = new Map<number, number>();
    const popped = new Set<number>(), streaked = new Set<number>();
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 80) {
      // armies as the turn's shopping left them (the battle is fought with these)
      const before = new Map(g.players.map((p) => [p.id, p.board.map((u) => u.uid)]));
      endTurn(g);
      const r = g.round - 1;
      for (const p of g.players) {
        const now = new Set(p.board.map((u) => u.uid));
        for (const uid of before.get(p.id) ?? []) if (!now.has(uid) && since.has(uid)) { ages.push(r - since.get(uid)!); since.delete(uid); }
        for (const u of p.board) if (!since.has(u.uid)) { since.set(u.uid, r); unitsSeen++; }
        if (!p.alive) continue;
        const army = p.board.map((u) => { const st = effStats(p, u, 'board'); return { id: u.cardId, g: u.golden, atk: st.atk, hp: st.hp, grown: st.atk + st.hp - (def(u.cardId).atk + def(u.cardId).hp) * (u.golden ? 2 : 1) }; });
        const big = army.filter((u) => (u.atk >= 100 || u.hp >= 100) && u.grown >= 100);
        if (big.length && !popped.has(p.id)) { popped.add(p.id); pops.push({ seed: s, round: r, hero: p.hero, army, big: big.map((u) => u.id) }); }
        if ((p.streak ?? 0) >= 8 && !streaked.has(p.id)) { streaked.add(p.id); streaks.push({ seed: s, round: r, hero: p.hero, army }); }
        if (r >= 9) base.push({ seed: s, round: r, army });
      }
    }
    for (const p of g.players) sells.push(p.board.length);
  }
  fs.writeFileSync(process.env.OUT ?? '/tmp/mine.json', JSON.stringify({ pops, streaks, base, ages, unitsSeen }));
}, 7200000);
