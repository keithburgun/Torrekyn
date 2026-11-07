/**
 * Bot arena: lobbies of bots with different profiles play many games; reports each profile's average
 * placement and head-to-head record (how often it finished above the other), converted to an Elo gap.
 * Skipped normally. Run:  ARENA=1 npx vitest run tests/arena.test.ts
 *   ARENA_A / ARENA_B: JSON profiles (default: A = baseline features off, B = Expert)
 *   ARENA_GAMES: number of games (default 600)
 */
import { describe, it } from 'vitest';
import { newGame, selectHero, endTurn, human } from '../src/engine/game';
import { pick, shuffle } from '../src/engine/core';
import { BASELINE, EXPERT } from '../src/engine/ai';
import type { BotProfile } from '../src/engine/types';

export function arena(profiles: BotProfile[], games: number, seed0 = 7000) {
  const k = profiles.length;
  const place = profiles.map(() => ({ sum: 0, n: 0, wins: 0 }));
  const h2h = profiles.map(() => profiles.map(() => 0)); // h2h[i][j] = times i finished above j
  const t0 = performance.now();
  for (let s = 0; s < games; s++) {
    const g = newGame(seed0 + s);
    g.simulateAll = true;
    selectHero(g, pick(g, human(g).heroOffer!)!);
    // seats split evenly between the profiles, in random order
    const seats = shuffle(g, g.players.map((_, i) => i % k));
    g.players.forEach((p, i) => { p.bot = profiles[seats[i]]; });
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 80) endTurn(g);
    g.players.forEach((p, i) => {
      const pl = p.placement || 1;
      place[seats[i]].sum += pl; place[seats[i]].n++; if (pl === 1) place[seats[i]].wins++;
      g.players.forEach((q, j) => { if (seats[i] !== seats[j] && pl < (q.placement || 1)) h2h[seats[i]][seats[j]]++; });
    });
  }
  const ms = performance.now() - t0;
  return { place, h2h, ms };
}

export const eloGap = (wins: number, losses: number) => {
  const p = Math.min(0.99, Math.max(0.01, wins / Math.max(1, wins + losses)));
  return Math.round(400 * Math.log10(p / (1 - p)));
};

describe.skipIf(!process.env.ARENA)('arena', () => {
  it('A vs B', () => {
    const A: BotProfile = process.env.ARENA_A ? JSON.parse(process.env.ARENA_A) : BASELINE;
    const B: BotProfile = process.env.ARENA_B ? JSON.parse(process.env.ARENA_B) : EXPERT;
    const games = Number(process.env.ARENA_GAMES ?? 600);
    const r = arena([A, B], games);
    const [a, b] = r.place;
    console.log(`games ${games} in ${(r.ms / 1000).toFixed(1)}s | A avg ${(a.sum / a.n).toFixed(2)} win ${(100 * a.wins / a.n).toFixed(1)}% | B avg ${(b.sum / b.n).toFixed(2)} win ${(100 * b.wins / b.n).toFixed(1)}% | B above A ${(100 * r.h2h[1][0] / (r.h2h[1][0] + r.h2h[0][1])).toFixed(1)}% => B is ${eloGap(r.h2h[1][0], r.h2h[0][1])} Elo vs A`);
  }, 3600000);
});
