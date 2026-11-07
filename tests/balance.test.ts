/**
 * Hero balance: bots in every seat, many games, average placement per hero (1 = best, 6 = worst).
 * Skipped normally; run with  BALANCE=1 npx vitest run tests/balance.test.ts  (writes balance.json).
 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
import { newGame, selectHero, endTurn, human } from '../src/engine/game';
import { HEROES } from '../src/engine/heroes';
import { pick } from '../src/engine/core';

const GAMES = Number(process.env.BALANCE_GAMES ?? 800);

describe.skipIf(!process.env.BALANCE)('balance', () => {
  it(`simulates ${GAMES} games`, () => {
    const stats = new Map<string, { sum: number; n: number; wins: number }>();
    for (const h of HEROES) stats.set(h.id, { sum: 0, n: 0, wins: 0 });
    for (let s = 0; s < GAMES; s++) {
      const g = newGame(1000 + s);
      g.simulateAll = true;
      selectHero(g, pick(g, human(g).heroOffer!)!);
      let guard = 0;
      while (g.phase !== 'over' && guard++ < 80) endTurn(g);
      for (const p of g.players) {
        const st = stats.get(p.hero!)!;
        st.sum += p.placement || 1;
        st.n++;
        if ((p.placement || 1) === 1) st.wins++;
      }
    }
    const out = [...stats].map(([id, st]) => ({ id, avg: +(st.sum / st.n).toFixed(2), games: st.n, winRate: +(st.wins / st.n).toFixed(3) }))
      .sort((a, b) => a.avg - b.avg);
    console.table(out);
    fs.writeFileSync('balance.json', JSON.stringify(out, null, 1));
  }, 600000);
});
