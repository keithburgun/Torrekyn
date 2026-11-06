import { describe, it, expect } from 'vitest';
import { newGame as ng, human, buy, play, sell, combatDamage, selectHero } from '../src/engine/game';
const newGame = (s: number) => { const g = ng(s); selectHero(g, human(g).heroOffer![0]); return g; };
import { makeUnit } from '../src/engine/core';
import { Combat } from '../src/engine/combat';
import type { GameState, Player, Unit } from '../src/engine/types';

function fight(g: GameState, a: Unit[], b: Unit[]) {
  const pa = g.players[0], pb = g.players[1];
  pa.board = a; pb.board = b;
  pa.hero = undefined; pb.hero = undefined;
  const c = new Combat(g, { p: pa, board: a, slots: pa.slots, tier: 1, persistent: true },
    { p: pb, board: b, slots: pb.slots, tier: 1, persistent: true });
  return { c, winner: c.run() };
}

describe('mechanics', () => {
  it('damage cap is 15', () => {
    expect(combatDamage(5, 30, 0)).toBe(15);
    expect(combatDamage(2, 3, 1)).toBe(6);
  });

  it('buying 3 copies makes a golden with combined buffs', () => {
    const g = newGame(1);
    const p = human(g);
    p.gold = 99;
    p.shop = [makeUnit(g, 'ash'), makeUnit(g, 'ash'), makeUnit(g, 'ash')];
    p.shop[0].atk += 2;
    buy(g, p, 0); buy(g, p, 0); buy(g, p, 0);
    expect(p.hand.length).toBe(1);
    expect(p.hand[0].golden).toBe(true);
    expect(p.hand[0].atk).toBe(4);
    play(g, p, 0, 0);
    expect(p.discovers.length).toBe(1); // triple reward
  });

  it('divine shield blocks one hit', () => {
    const g = newGame(2);
    const { c, winner } = fight(g, [makeUnit(g, 'shield_azure')], [makeUnit(g, 'skel')]);
    expect(winner).toBe(0);
    expect(c.sides[0].units[0].hp).toBe(1);
  });

  it('reborn returns with 1 health', () => {
    const g = newGame(3);
    const big = makeUnit(g, 'ancient_name_neverending'); // 15/12
    const { c } = fight(g, [makeUnit(g, 'ash')], [big]);
    const frames = c.frames.filter((f) => f.note?.includes('Reborn'));
    expect(frames.length).toBe(1);
  });

  it('skeleton deathrattle spawns skels', () => {
    const g = newGame(4);
    const { c } = fight(g, [makeUnit(g, 'skeleton')], [makeUnit(g, 'tourmaline')]);
    expect(c.frames.some((f) => f.sides[0].some((u) => u.cardId === 'skel'))).toBe(true);
  });

  it('slots carry stats to whoever stands in them', () => {
    const g = newGame(5);
    const p: Player = human(g);
    p.board = [makeUnit(g, 'skel')];
    p.hand = [makeUnit(g, 'chosen_name')];
    play(g, p, 0, 1);
    expect(p.slots[1].atk).toBe(11);
    sell(g, p, 1);
    p.hand = [makeUnit(g, 'skel')];
    play(g, p, 0, 1);
    const c = new Combat(g, { p, board: p.board, slots: p.slots, tier: 1, persistent: true },
      { p: g.players[1], board: [], slots: g.players[1].slots, tier: 1, persistent: true });
    expect(c.sides[0].units[1].atk).toBe(12);
  });

  it('venomous kills big units', () => {
    const g = newGame(6);
    const { winner } = fight(g, [makeUnit(g, 'orange_ninja')], [makeUnit(g, 'honeysuckle_kindred')]);
    expect(winner).not.toBe(1);
  });
});

describe('heroes', () => {
  it('every hero power can be used without errors', async () => {
    const { HEROES, useHeroPower, canUseHeroPower } = await import('../src/engine/heroes');
    for (const h of HEROES) {
      const g = newGame(11);
      const p = human(g);
      p.hero = h.id;
      p.gold = 10;
      p.board = [makeUnit(g, 'ash'), makeUnit(g, 'lich')];
      g.players[p.nextOpponent ?? 1].board = [makeUnit(g, 'skeleton')];
      if (!h.passive) {
        expect(canUseHeroPower(g, p)).toBe(true);
        expect(useHeroPower(g, p, h.target ? p.board[0] : undefined)).toBe(true);
      }
    }
  });
});
