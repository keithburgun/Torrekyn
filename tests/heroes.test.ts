/**
 * Every hero power, checked against what its text says.
 */
import { describe, it, expect } from 'vitest';
import { newGame, selectHero, human, buy, play, sell, chooseDiscover } from '../src/engine/game';
import { ALL_TRIBES, CARDS, def, isTribe, makeUnit } from '../src/engine/core';
import { EFFECTS } from '../src/engine/effects';
import { HEROES, heroHooks, buyCost, canUseHeroPower, useHeroPower, powerCost, heroDef } from '../src/engine/heroes';
import { Combat } from '../src/engine/combat';
import type { GameState, Player, Unit } from '../src/engine/types';

function setup(hero: string, seed = 3) {
  const g = newGame(seed, 'You', ALL_TRIBES);
  selectHero(g, hero);
  const p = human(g);
  p.gold = 50;
  p.discovers = [];
  p.trinketOffer = null;
  return { g, p };
}
const firstOf = (f: (id: string) => boolean) => CARDS.find((c) => !c.token && f(c.id))!.id;
const unit = (g: GameState, id: string, atk?: number, hp?: number): Unit => {
  const u = makeUnit(g, id);
  if (atk !== undefined) u.atk = atk;
  if (hp !== undefined) u.hp = hp;
  return u;
};
function combat(g: GameState, p: Player, mine: Unit[], theirs: Unit[], persistent = true) {
  const o = g.players[1];
  o.hero = undefined; o.powers = []; o.trinkets = [];
  return new Combat(g, { p, board: mine, slots: p.slots, tier: p.tier, persistent }, { p: o, board: theirs, slots: o.slots, tier: 1, persistent: false });
}

describe('hero powers', () => {
  it('covers every hero', () => {
    const tested = ['andromeda_robin', 'gelf_lanz', 'derby_pocket', 'bunny_wizard', 'croh_vosh', 'may_danaris', 'locas_clare', 'venice_gorn',
      'omar_evans', 'eve_williams', 'abragail', 'bill_milton', 'clover', 'trevor_l'];
    expect(HEROES.map((h) => h.id).sort()).toEqual([...tested].sort());
  });

  it('Andromeda Robin: starts with a Pumpkin that keeps the Deathrattles of units that die in combat', () => {
    const { g, p } = setup('andromeda_robin');
    const pumpkin = [...p.hand, ...p.board].find((u) => u.cardId === 'pumpkin');
    expect(pumpkin).toBeTruthy();
    const dr = firstOf((id) => !!EFFECTS[id]?.deathrattle && def(id).tier === 1);
    pumpkin!.hp = 500; // it has to be alive when the other unit dies
    p.board = [pumpkin!, unit(g, dr, 1, 1)];
    combat(g, p, p.board, [unit(g, firstOf(() => true), 30, 30)]).run();
    expect(Object.keys(pumpkin!.mem).some((k) => k === `dr_${dr}`)).toBe(true);
  });

  it('Gelf Lanz: after buying an Azure unit, the next Azure unit costs 1 less', () => {
    const { g, p } = setup('gelf_lanz');
    const az = firstOf((id) => isTribe(id, 'azure'));
    const other = firstOf((id) => !isTribe(id, 'azure') && def(id).tribe !== 'neutral');
    expect(buyCost(p, az)).toBe(3);
    p.shop = [unit(g, az), unit(g, az)];
    const gold = p.gold;
    buy(g, p, 0);
    expect(p.gold).toBe(gold - 3);
    expect(buyCost(p, az)).toBe(2);
    expect(buyCost(p, other)).toBe(3);
  });

  it('Derby Pocket: after 5 Battlecry units, Battlecries trigger twice (even one that destroys itself)', () => {
    const { g, p } = setup('derby_pocket');
    const dummy = unit(g, firstOf((id) => !EFFECTS[id]), 1, 1);
    p.board = [dummy];
    const playSword = () => { p.hand = [unit(g, 'sword')]; expect(play(g, p, 0, p.board.length).ok).toBe(true); };
    for (let i = 0; i < 5; i++) playSword();
    expect(dummy.atk).toBe(1 + 5 * 4);
    expect(p.heroMem.coffee).toBe(5);
    playSword(); // Sword destroys itself, but the extra trigger still happens
    expect(dummy.atk).toBe(1 + 5 * 4 + 8);
    expect(p.board).toEqual([dummy]);
    // a normal Battlecry unit also fires twice
    const bc = firstOf((id) => !!EFFECTS[id]?.battlecry && !EFFECTS[id]?.target && id !== 'sword' && id !== 'shield_neutral');
    const before = p.battlecriesGame;
    p.hand = [unit(g, bc)];
    play(g, p, 0, p.board.length);
    expect(p.battlecriesGame - before).toBe(2);
  });

  it('Bunny Wizard: locked until Tier 4, then Discovers a Kindred unit', () => {
    const { g, p } = setup('bunny_wizard');
    expect(canUseHeroPower(g, p)).toBe(false);
    p.tier = 4;
    expect(useHeroPower(g, p)).toBe(true);
    expect(p.discovers.length).toBe(1);
    const opts = p.discovers[0].options as string[];
    expect(opts.length).toBeGreaterThan(0);
    for (const id of opts) { expect(isTribe(id, 'kindred')).toBe(true); expect(def(id).tier).toBeLessThanOrEqual(4); }
  });

  it('Croh Vosh: units summoned during combat get +1/+2 (not the opponent\'s)', () => {
    const { g, p } = setup('croh_vosh');
    const c = combat(g, p, [unit(g, 'skel')], [unit(g, 'skel')]);
    const d = def('skel');
    const mine = c.spawn(c.sides[0], 'skel', false, 1)!;
    expect([mine.atk, mine.hp]).toEqual([d.atk + 1, d.hp + 2]);
    const theirs = c.spawn(c.sides[1], 'skel', false, 1)!;
    expect([theirs.atk, theirs.hp]).toEqual([d.atk, d.hp]);
  });

  it('May Danaris: Discovers a unit from your last opponent\'s army', () => {
    const { g, p } = setup('may_danaris');
    p.lastOpponentBoard = [];
    expect(canUseHeroPower(g, p)).toBe(false);
    const ids = CARDS.filter((c) => !c.token).slice(0, 4).map((c) => c.id);
    p.lastOpponentBoard = ids.map((id) => unit(g, id));
    const gold = p.gold;
    expect(useHeroPower(g, p)).toBe(true);
    expect(p.gold).toBe(gold - 2);
    for (const id of p.discovers[0].options as string[]) expect(ids).toContain(id);
  });

  it('Locas Clare: steals the whole Tavern, then the cost resets to 10 and drops by 1 each turn', () => {
    const { g, p } = setup('locas_clare');
    const h = heroDef('locas_clare')!;
    expect(powerCost(g, p, h)).toBe(10);
    g.round += 3;
    expect(powerCost(g, p, h)).toBe(7);
    p.hand = [];
    const n = p.shop.length;
    expect(n).toBeGreaterThan(0);
    expect(useHeroPower(g, p)).toBe(true);
    expect(p.shop.length).toBe(0);
    expect(p.hand.length).toBe(n);
    g.round += 1;
    expect(powerCost(g, p, h)).toBe(10);
    g.round += 2;
    expect(powerCost(g, p, h)).toBe(8);
  });

  it('Venice Gorn: a seed sprouts 2 turns later into a unit 1 Tier above your Tavern', () => {
    const { g, p } = setup('venice_gorn');
    p.tier = 2;
    p.hand = [];
    expect(useHeroPower(g, p)).toBe(true);
    heroHooks.startTurn(g, p);
    expect(p.hand.length).toBe(0);
    heroHooks.startTurn(g, p);
    expect(p.hand.length).toBe(1);
    expect(def(p.hand[0].cardId).tier).toBe(3);
  });

  it('Omar Evans: every 5 Cloister units sold gives a random Cloister unit', () => {
    const { g, p } = setup('omar_evans');
    const cl = firstOf((id) => isTribe(id, 'cloister'));
    p.hand = [];
    p.board = Array.from({ length: 5 }, () => unit(g, cl));
    for (let i = 0; i < 4; i++) sell(g, p, 0);
    expect(p.hand.length).toBe(0);
    sell(g, p, 0);
    expect(p.hand.length).toBe(1);
    expect(isTribe(p.hand[0], 'cloister')).toBe(true);
    expect(p.heroMem.leaves).toBe(0);
  });

  it('Eve Williams: transforms a friendly unit into another of the same Tier with +3/+3', () => {
    const { g, p } = setup('eve_williams');
    const id = firstOf((x) => def(x).tier === 2);
    p.board = [unit(g, id)];
    expect(useHeroPower(g, p, p.board[0])).toBe(true);
    const nu = p.board[0];
    expect(nu.cardId).not.toBe(id);
    expect(def(nu.cardId).tier).toBe(2);
    expect([nu.atk, nu.hp]).toEqual([def(nu.cardId).atk + 3, def(nu.cardId).hp + 3]);
  });

  it('Abragail: on turn 4, Discovers two Hero Powers that replace hers', () => {
    const { g, p } = setup('abragail');
    g.round = 3;
    heroHooks.startTurn(g, p);
    expect(p.discovers.length).toBe(0);
    g.round = 4;
    heroHooks.startTurn(g, p);
    expect(p.discovers.length).toBe(2);
    chooseDiscover(g, p, 0);
    chooseDiscover(g, p, 0);
    expect(p.powers).not.toContain('abragail');
    expect(p.powers.length).toBe(2);
    for (const id of p.powers) expect(heroDef(id)).toBeTruthy();
  });

  it('Bill Milton: playing a Business Demon gives 1 gold', () => {
    const { g, p } = setup('bill_milton');
    const demon = firstOf((id) => isTribe(id, 'demons') && !EFFECTS[id]?.target && !EFFECTS[id]?.battlecry);
    const other = firstOf((id) => !isTribe(id, 'demons') && !EFFECTS[id]?.target && !EFFECTS[id]?.battlecry);
    p.board = [];
    p.hand = [unit(g, demon), unit(g, other)];
    const gold = p.gold;
    play(g, p, 0, 0);
    expect(p.gold).toBe(gold + 1);
    play(g, p, 0, 0);
    expect(p.gold).toBe(gold + 1);
  });

  it('Clover: Avenge (4) summons a Dragon, and each one makes future Dragons bigger', () => {
    const { g, p } = setup('clover');
    p.heroMem.brood = 0;
    const c = combat(g, p, Array.from({ length: 5 }, () => unit(g, 'skel')), [unit(g, 'skel')]);
    const s = c.sides[0];
    for (let i = 0; i < 3; i++) heroHooks.onFriendlyDeath(c, s);
    expect(s.units.some((u) => u.cardId === 'dragon')).toBe(false);
    heroHooks.onFriendlyDeath(c, s);
    const d1 = s.units.find((u) => u.cardId === 'dragon')!;
    expect([d1.atk, d1.hp]).toEqual([def('dragon').atk, def('dragon').hp]);
    expect(p.heroMem.brood).toBe(1);
    for (let i = 0; i < 4; i++) heroHooks.onFriendlyDeath(c, s);
    const d2 = s.units.filter((u) => u.cardId === 'dragon')[1];
    expect([d2.atk, d2.hp]).toEqual([def('dragon').atk + 1, def('dragon').hp + 1]);
  });

  it('Trevor L: Avenge (5) gives a random friendly unit Reborn', () => {
    const { g, p } = setup('trevor_l');
    const plain = firstOf((id) => !def(id).keywords.includes('reborn') && !EFFECTS[id]);
    const c = combat(g, p, [unit(g, plain), unit(g, plain)], [unit(g, 'skel')]);
    const s = c.sides[0];
    for (let i = 0; i < 4; i++) heroHooks.onFriendlyDeath(c, s);
    expect(s.units.some((u) => u.kw.includes('reborn'))).toBe(false);
    heroHooks.onFriendlyDeath(c, s);
    expect(s.units.filter((u) => u.kw.includes('reborn')).length).toBe(1);
  });
});
