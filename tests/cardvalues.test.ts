/**
 * Measures what each card's ability is worth, for the bots (writes src/data/cardValues.json).
 * For every card (and its Golden version) at its tier: play it onto a typical army (Battlecries and
 * on-play effects happen, one end of turn passes), fight many random armies of that tier, and compare
 * with the same army where the card is replaced by a plain unit with identical stats and keywords.
 * The win-rate difference is converted into "+1/+1 equivalents" (what the bots' unit score uses).
 * Economy effects (gold, cards in hand) aren't visible to battles; ai.ts adds those by hand.
 * Run:  CARDVALUES=1 npx vitest run tests/cardvalues.test.ts
 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
import { newGame, play, endTurnEffects } from '../src/engine/game';
import { CARDS, makeUnit, pick, rand } from '../src/engine/core';
import { Combat } from '../src/engine/combat';
import { EFFECTS } from '../src/engine/effects';
import type { CardDef, GameState, Player, Unit } from '../src/engine/types';

const TRIALS = Number(process.env.CV_TRIALS ?? 160);

function randomArmy(g: GameState, tier: number, n: number, tribe?: string): Unit[] {
  const pool = CARDS.filter((c) => !c.token && c.tier <= tier && c.id !== 'virus');
  const same = pool.filter((c) => c.tribe === tribe);
  return Array.from({ length: n }, () => {
    const c = (tribe && same.length && rand(g) < 0.6 ? pick(g, same) : pick(g, pool))!;
    const u = makeUnit(g, c.id);
    // armies grow during the game: give each unit a little tier-based growth
    u.atk += tier; u.hp += tier;
    return u;
  });
}

function reset(p: Player) {
  p.board = []; p.hand = []; p.powers = []; p.trinkets = []; p.quests = []; p.discovers = [];
  p.slots = p.slots.map(() => ({ atk: 0, hp: 0, kw: [] }));
  p.tribeAtk = {}; p.gold = 0;
}

/** Win rate (ties count half) of `mine` + card vs random enemies, with the card played normally or as a plain stand-in. */
function trial(card: CardDef, golden: boolean, plain: boolean, seed: number, bonus = 0): number {
  const g = newGame(seed);
  const p = g.players[0];
  const o = g.players[1];
  reset(p); reset(o);
  p.tier = o.tier = card.tier;
  const tier = Math.max(card.tier, 2);
  const mine = randomArmy(g, tier, 4, card.tribe);
  const theirs = randomArmy(g, tier, 5);
  p.board = mine;
  let u = makeUnit(g, card.id, golden);
  if (plain) {
    // same stats and keywords, no ability
    const s = makeUnit(g, 'dragon');
    s.atk = u.atk + bonus; s.hp = u.hp + bonus; s.kw = [...u.kw];
    u = s;
  }
  p.hand = [u];
  const target = EFFECTS[card.id]?.target && !plain ? p.board[0]?.uid : undefined;
  play(g, p, 0, Math.floor(p.board.length / 2), target);
  p.discovers = [];
  endTurnEffects(g, p);
  p.discovers = [];
  let score = 0;
  for (let i = 0; i < 4; i++) {
    const c = new Combat(g, { p, board: p.board, slots: p.slots, tier, persistent: false }, { p: o, board: theirs, slots: o.slots, tier, persistent: false });
    const w = c.run();
    score += w === 0 ? 1 : w === -1 ? 0.5 : 0;
  }
  return score / 4;
}

/** win-rate change from +1/+1 on one unit (to convert win rates into stat points), per tier */
function statWorth(tier: number): number {
  const cards = CARDS.filter((c) => c.tier === tier && !c.token);
  let d = 0;
  for (let s = 0; s < TRIALS * 3; s++) {
    const c = cards[s % cards.length];
    d += trial(c, false, true, 1e6 + s, 2) - trial(c, false, true, 1e6 + s, 0);
  }
  return Math.max(0.002, d / (TRIALS * 3) / 2);
}

describe.skipIf(!process.env.CARDVALUES)('card values', () => {
  it('measures every card', () => {
    const worth: Record<number, number> = {};
    for (let t = 1; t <= 5; t++) worth[t] = statWorth(t);
    console.log('win-rate per +1/+1 by tier', worth);
    const out: Record<string, [number, number]> = {};
    for (const c of CARDS) {
      if (c.token && c.id !== 'pumpkin') continue;
      const v = [false, true].map((golden) => {
        let d = 0;
        for (let s = 0; s < TRIALS; s++) d += trial(c, golden, false, 5000 + s) - trial(c, golden, true, 5000 + s);
        return Math.round(((d / TRIALS) / worth[c.tier]) * 10) / 10;
      });
      out[c.id] = v as [number, number];
    }
    fs.writeFileSync('src/data/cardValues.json', JSON.stringify(out, null, 0).replace(/\],/g, '],\n'));
    const top = Object.entries(out).sort((a, b) => b[1][0] - a[1][0]);
    console.log('best', top.slice(0, 12).map(([k, v]) => `${k}:${v[0]}`).join(' '));
    console.log('worst', top.slice(-12).map(([k, v]) => `${k}:${v[0]}`).join(' '));
  }, 3600000);
});
