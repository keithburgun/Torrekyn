/**
 * Elo calibration for bots. Skipped normally.
 *  SKILLS=1     one lobby seat per skill level (0, 0.2 … 1): average placement and Elo gaps, to check the dial.
 *  CALIBRATE=1  random lobbies of the 15 personas; fits everyone's Elo from who finished above whom,
 *               anchored so the Expert (xX_TavernKing_Xx) is 2000; writes src/data/personaElo.json.
 *               Also places the original (pre-improvement) bot on the same scale for reference.
 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
import { newGame, selectHero, endTurn, human } from '../src/engine/game';
import { pick, sample } from '../src/engine/core';
import { BASELINE } from '../src/engine/ai';
import { PERSONAS, personaProfile, profileForSkill, EXPERT_ELO } from '../src/engine/personas';
import type { BotProfile } from '../src/engine/types';
import { arena } from './arena.test';

/**
 * Fit Elo ratings from pairwise "finished above" counts: Bradley-Terry strengths by the standard
 * minorization-maximization iteration (always converges), then Elo = 400 * log10(strength).
 */
export function fitElo(w: number[][], anchor: number, anchorElo: number): number[] {
  const n = w.length;
  let pi = new Array(n).fill(1);
  for (let it = 0; it < 5000; it++) {
    const next = pi.map((_, i) => {
      let wins = 0, den = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const games = w[i][j] + w[j][i];
        if (!games) continue;
        wins += w[i][j];
        den += games / (pi[i] + pi[j]);
      }
      return den ? Math.max(1e-9, wins / den) : pi[i];
    });
    const g = Math.exp(next.reduce((a, x) => a + Math.log(x), 0) / n); // keep the scale fixed
    const norm = next.map((x) => x / g);
    const delta = norm.reduce((a, x, i) => a + Math.abs(x - pi[i]), 0);
    pi = norm;
    if (delta < 1e-10) break;
  }
  const r = pi.map((x) => 400 * Math.log10(x));
  const off = anchorElo - r[anchor];
  return r.map((x) => Math.round(x + off));
}

describe.skipIf(!process.env.SKILLS)('skill ladder', () => {
  it('one seat per skill', () => {
    const skills = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const r = arena(skills.map(profileForSkill), Number(process.env.GAMES ?? 400));
    const elo = fitElo(r.h2h, 5, EXPERT_ELO);
    skills.forEach((s, i) => console.log(`skill ${s}: avg place ${(r.place[i].sum / r.place[i].n).toFixed(2)}, win ${(100 * r.place[i].wins / r.place[i].n).toFixed(1)}%, Elo ${elo[i]}`));
    console.log(`${(r.ms / 1000).toFixed(0)}s`);
  }, 3600000);
});

describe.skipIf(!process.env.CALIBRATE)('persona Elo', () => {
  it('random persona lobbies', () => {
    const games = Number(process.env.GAMES ?? 2000);
    // index 15 = the original bot, for reference
    const profiles: BotProfile[] = [...PERSONAS.map(personaProfile), BASELINE];
    const n = profiles.length;
    const w = profiles.map(() => profiles.map(() => 0));
    const place = profiles.map(() => ({ sum: 0, n: 0, wins: 0 }));
    const t0 = performance.now();
    for (let s = 0; s < games; s++) {
      const g = newGame(90000 + s);
      g.simulateAll = true;
      selectHero(g, pick(g, human(g).heroOffer!)!);
      const who = sample(g, profiles.map((_, i) => i), 6);
      g.players.forEach((p, i) => { p.bot = profiles[who[i]]; });
      let guard = 0;
      while (g.phase !== 'over' && guard++ < 80) endTurn(g);
      g.players.forEach((p, i) => {
        const pl = p.placement || 1;
        place[who[i]].sum += pl; place[who[i]].n++; if (pl === 1) place[who[i]].wins++;
        g.players.forEach((q, j) => { if (i !== j && pl < (q.placement || 1)) w[who[i]][who[j]]++; });
      });
    }
    const elo = fitElo(w, 0, EXPERT_ELO);
    const out: Record<string, number> = {};
    PERSONAS.forEach((p, i) => { out[p.id] = elo[i]; });
    fs.writeFileSync('src/data/personaElo.json', JSON.stringify(out, null, 1));
    const rows = profiles.map((_, i) => ({ who: i < PERSONAS.length ? PERSONAS[i].name : '(original bot)', skill: i < PERSONAS.length ? PERSONAS[i].skill : '-', elo: elo[i],
      avg: +(place[i].sum / place[i].n).toFixed(2), win: `${(100 * place[i].wins / place[i].n).toFixed(1)}%`, games: place[i].n }));
    console.table(rows);
    console.log(`${games} games in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }, 7200000);
});
