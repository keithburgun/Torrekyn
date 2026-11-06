import { describe, it, expect } from 'vitest';
import { newGame, endTurn, human, alivePlayers, selectHero } from '../src/engine/game';
import { aiTakeTurn } from '../src/engine/ai';
import { CARDS } from '../src/engine/core';
import { EFFECTS } from '../src/engine/effects';
import type { GameState } from '../src/engine/types';

function check(g: GameState) {
  for (const p of g.players) {
    expect(p.board.length).toBeLessThanOrEqual(7);
    for (const u of [...p.board, ...p.hand, ...p.shop]) {
      expect(Number.isFinite(u.atk)).toBe(true);
      expect(Number.isFinite(u.hp)).toBe(true);
    }
    expect(Number.isFinite(p.gold)).toBe(true);
  }
}

function playOut(seed: number) {
  const g = newGame(seed);
  selectHero(g, human(g).heroOffer![0]);
  let rounds = 0;
  while (g.phase !== 'over' && rounds < 60) {
    aiTakeTurn(g, human(g));
    const res = endTurn(g);
    expect(res.length).toBeGreaterThan(0);
    check(g);
    // keep JSON round-trip working (save games)
    JSON.parse(JSON.stringify(g));
    rounds++;
  }
  return { g, rounds };
}

describe('Torrekin simulation', () => {
  it('every card has an effect entry or is vanilla', () => {
    const vanilla = CARDS.filter((c) => !EFFECTS[c.id] && c.text && !/^((Taunt|Divine Shield|Reborn|Venomous|Stealth)[.,]?\s*)+$/.test(c.text));
    expect(vanilla.map((c) => c.id)).toEqual([]);
  });

  it('plays 150 full games with bots without errors', () => {
    let totalRounds = 0;
    for (let s = 1; s <= 150; s++) {
      const { g, rounds } = playOut(s * 7919);
      expect(g.phase).toBe('over');
      totalRounds += rounds;
    }
    console.log('avg rounds', totalRounds / 150);
  });

  it('6 players, 60 health', () => {
    const g = newGame(42);
    selectHero(g, human(g).heroOffer![1]);
    expect(g.players.length).toBe(6);
    expect(g.players.every((p) => p.health === 60)).toBe(true);
    expect(alivePlayers(g).length).toBe(6);
  });
});
