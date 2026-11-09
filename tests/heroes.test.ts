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
      'omar_evans', 'eve_williams', 'abragail', 'bill_milton', 'clover', 'trevor_l', 'mazrael_bettencourt'];
    expect(HEROES.map((h) => h.id).sort()).toEqual([...tested].sort());
  });

  it('Andromeda Robin: starts with a Pumpkin that takes the Deathrattles of units that die, for that battle only', () => {
    const { g, p } = setup('andromeda_robin');
    const pumpkin = [...p.hand, ...p.board].find((u) => u.cardId === 'pumpkin');
    expect(pumpkin).toBeTruthy();
    const dr = firstOf((id) => !!EFFECTS[id]?.deathrattle && def(id).tier === 1);
    pumpkin!.hp = 500; // it has to be alive when the other unit dies
    p.board = [pumpkin!, unit(g, dr, 1, 1)];
    const c = combat(g, p, p.board, [unit(g, firstOf(() => true), 30, 30)]);
    c.run();
    expect(c.frames.some((f) => f.note?.includes('Pumpkin gained'))).toBe(true);
    expect(Object.keys(pumpkin!.mem).some((k) => k.startsWith('dr_'))).toBe(false); // gone after the battle
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
    // Shield destroys itself in its Battlecry: +1/+2 to the right-most unit each trigger
    const playShield = () => { p.hand = [unit(g, 'shield_neutral')]; expect(play(g, p, 0, p.board.length).ok).toBe(true); };
    for (let i = 0; i < 5; i++) playShield();
    expect([dummy.atk, dummy.hp]).toEqual([1 + 5, 1 + 10]);
    expect(p.heroMem.coffee).toBe(5);
    playShield(); // the extra trigger still happens even though Shield is gone
    expect([dummy.atk, dummy.hp]).toEqual([1 + 5 + 2, 1 + 10 + 4]);
    expect(p.board).toEqual([dummy]);
    // a normal Battlecry unit also fires twice
    const bc = firstOf((id) => !!EFFECTS[id]?.battlecry && !EFFECTS[id]?.target && id !== 'shield_neutral');
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
    expect(p.gold).toBe(gold - 3);
    for (const id of p.discovers[0].options as string[]) expect(ids).toContain(id);
  });

  it('Locas Clare: steals the whole Tavern, then the cost resets to 7 and drops by 1 each turn', () => {
    const { g, p } = setup('locas_clare');
    const h = heroDef('locas_clare')!;
    expect(powerCost(g, p, h)).toBe(7);
    g.round += 3;
    expect(powerCost(g, p, h)).toBe(4);
    p.hand = [];
    const n = p.shop.length;
    expect(n).toBeGreaterThan(0);
    expect(useHeroPower(g, p)).toBe(true);
    expect(p.shop.length).toBe(0);
    expect(p.hand.length).toBe(n);
    g.round += 1;
    expect(powerCost(g, p, h)).toBe(7);
    g.round += 2;
    expect(powerCost(g, p, h)).toBe(5);
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

  it('Omar Evans: every 4 units sold Discovers a Cloister unit', () => {
    const { g, p } = setup('omar_evans');
    const cl = firstOf((id) => !isTribe(id, 'cloister') && !EFFECTS[id]?.onSell && !EFFECTS[id]?.onSellOther); // any tribe counts
    p.hand = [];
    p.discovers = [];
    p.board = Array.from({ length: 4 }, () => unit(g, cl));
    for (let i = 0; i < 3; i++) sell(g, p, 0);
    expect(p.discovers.length).toBe(0);
    sell(g, p, 0);
    expect(p.discovers.length).toBe(1);
    for (const id of p.discovers[0].options as string[]) expect(isTribe(id, 'cloister')).toBe(true);
    expect(p.heroMem.leaves).toBe(0);
  });

  it('Eve Williams: Doom Bauble loads a Tavern unit and fires it in the next battle with room, then it is gone', () => {
    const { g, p } = setup('eve_williams');
    const shopUnit = unit(g, firstOf((x) => !EFFECTS[x] && def(x).tier === 1), 7, 1);
    p.shop = [shopUnit];
    const gold = p.gold;
    expect(useHeroPower(g, p, shopUnit)).toBe(true);
    expect(p.gold).toBe(gold - 1);
    expect(p.shop.length).toBe(0);
    expect(p.bauble).toEqual([shopUnit]);
    // a full army: it waits
    const plain = firstOf((x) => !EFFECTS[x] && def(x).tier === 1);
    const full = combat(g, p, Array.from({ length: 7 }, () => unit(g, plain, 0, 100)), [unit(g, plain, 0, 50)]);
    full.fireBaubles(full.sides[0]);
    expect(p.bauble?.length).toBe(1);
    // room: summoned, attacks a random enemy at once (ignoring Taunt), and isn't kept
    p.board = [unit(g, plain, 0, 100)];
    const foes = [unit(g, plain, 0, 50), unit(g, plain, 0, 50)];
    foes[0].kw = ['taunt'];
    const hits = new Set<number>();
    for (let k = 0; k < 30; k++) {
      p.bauble = [unit(g, shopUnit.cardId, 7, 1)];
      const c = combat(g, p, p.board, foes.map((f) => ({ ...f, kw: [...f.kw] })));
      c.fireBaubles(c.sides[0]);
      expect(p.bauble.length).toBe(0);
      const enemy = c.sides[1].units;
      enemy.forEach((u, i) => { if (u.hp < 50) hits.add(i); });
      expect(c.sides[0].units.length).toBe(2); // the army's unit plus the fired one
    }
    expect(hits.has(1)).toBe(true); // not only the Taunt
    expect(p.board.length).toBe(1);
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

  it('Mazrael Bettencourt: skips turn 1 and Discovers Tier 3, 4 and 5 units that unlock at those Tavern Tiers', () => {
    const g2 = newGame(5, 'You', ALL_TRIBES);
    selectHero(g2, 'mazrael_bettencourt');
    const m = human(g2);
    expect(m.shop.length).toBe(0);
    expect(m.gold).toBe(0);
    expect(m.discovers.map((d) => d.unlockTier)).toEqual([3, 4, 5]);
    for (let i = 0; i < 3; i++) chooseDiscover(g2, m, 0);
    expect(m.hand.map((u) => def(u.cardId).tier)).toEqual([3, 4, 5]);
    expect(play(g2, m, 0, 0)).toEqual({ ok: false, reason: 'Unlocks at Tavern Tier 3' });
    m.tier = 3;
    expect(play(g2, m, 0, 0).ok).toBe(true);
    expect(m.board[0].mem.unlockTier).toBeUndefined();
    expect(play(g2, m, 0, 1).ok).toBe(false); // the Tier 4 one still waits
  });
});
