/**
 * Balance report data. Skipped normally.
 *   REPORT=heroes  all seats play as the Expert bot: placement per hero, per card on the final army, per main tribe
 *   REPORT=tribes  4 seats each committed to one of the game's tribes (Expert skill), 2 uncommitted Expert seats
 *   HPTEST=1       (with heroes) one seat starts with 10 less Health and one with 10 more: how much Health is worth
 * Options: GAMES (default 1000), SHARD / NSHARDS to split across processes, OUT (file to write).
 *   REPORT=heroes GAMES=2000 SHARD=0 NSHARDS=2 OUT=/tmp/h0.json npx vitest run tests/report.test.ts
 * tools/balance_report.py combines the shards into the tables.
 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
import { newGame, selectHero, endTurn, human } from '../src/engine/game';
import { def, pick } from '../src/engine/core';
import { profileForSkill } from '../src/engine/personas';
import type { GameState, Tribe } from '../src/engine/types';

const MODE = process.env.REPORT;
const GAMES = Number(process.env.GAMES ?? 1000);
const SHARD = Number(process.env.SHARD ?? 0);
const NSHARDS = Number(process.env.NSHARDS ?? 1);

function record(g: GameState) {
  return g.players.map((p) => {
    const counts: Record<string, number> = {};
    for (const u of p.board) {
      const d = def(u.cardId);
      if (d.tribe !== 'neutral' && !d.token) counts[d.tribe] = (counts[d.tribe] ?? 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      hero: p.hero, place: p.placement || 1, health: p.health, tier: p.tier,
      board: p.board.map((u) => u.cardId + (u.golden ? '*' : '')),
      main: top && top[1] >= 3 ? top[0] : 'mixed',
      forced: (p.bot as { tribe?: string } | undefined)?.tribe ?? null,
      hpDelta: (p as { hpDelta?: number }).hpDelta ?? 0,
    };
  });
}

describe.skipIf(!MODE)('balance report', () => {
  it(`${MODE}: ${GAMES} games`, () => {
    const out: unknown[] = [];
    const expert = profileForSkill(1);
    for (let s = SHARD; s < GAMES; s += NSHARDS) {
      const g = newGame(500000 + s);
      g.simulateAll = true;
      selectHero(g, pick(g, human(g).heroOffer!)!);
      for (const p of g.players) p.bot = { ...expert };
      if (MODE === 'tribes') {
        const tribes = [...g.tribes] as Tribe[];
        // seats 0..3 committed to the game's 4 tribes (seat order is random relative to heroes)
        const seats = g.players.map((_, i) => i).sort(() => 0);
        tribes.slice(0, 4).forEach((t, i) => { g.players[seats[(i + s) % 6]].bot = { ...expert, tribe: t }; });
      }
      if (process.env.HPTEST) {
        // health sensitivity: one seat starts 10 lower, another 10 higher
        const a = g.players[s % 6], b = g.players[(s + 3) % 6];
        a.health -= 10; (a as { hpDelta?: number }).hpDelta = -10;
        b.health += 10; (b as { hpDelta?: number }).hpDelta = 10;
      }
      let guard = 0;
      while (g.phase !== 'over' && guard++ < 80) endTurn(g);
      out.push({ seed: s, tribes: g.tribes, players: record(g) });
    }
    fs.writeFileSync(process.env.OUT ?? `/tmp/report-${MODE}-${SHARD}.json`, JSON.stringify(out));
  }, 7200000);
});
