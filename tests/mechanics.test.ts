import { CARDS } from '../src/engine/core';
import { describe, it, expect } from 'vitest';
import { newGame as ng, human, buy, play, sell, combatDamage, selectHero } from '../src/engine/game';
// a game past hero selection with no hero powers in the way (hero tests below give powers explicitly)
const newGame = (s: number) => {
  const g = ng(s);
  selectHero(g, human(g).heroOffer![0]);
  for (const p of g.players) { p.powers = []; p.hand = []; }
  return g;
};
import { def, makeUnit } from '../src/engine/core';
import { Combat } from '../src/engine/combat';
import type { GameState, Player, Unit } from '../src/engine/types';

function fight(g: GameState, a: Unit[], b: Unit[]) {
  const pa = g.players[0], pb = g.players[1];
  pa.board = a; pb.board = b;
  pa.hero = undefined; pb.hero = undefined; pa.powers = []; pb.powers = [];
  const c = new Combat(g, { p: pa, board: a, slots: pa.slots, tier: 1, persistent: true },
    { p: pb, board: b, slots: pb.slots, tier: 1, persistent: true });
  return { c, winner: c.run() };
}

describe('mechanics', () => {
  it('"Your X units have…" bonuses also apply to units summoned during a battle', () => {
    const g = newGame(11);
    const pa = g.players[0], pb = g.players[1];
    pa.hero = undefined; pb.hero = undefined; pa.powers = []; pb.powers = [];
    pa.trinkets = ['bronze_compass'];
    const c = new Combat(g, { p: pa, board: [makeUnit(g, 'skel')], slots: pa.slots, tier: 1, persistent: false },
      { p: pb, board: [makeUnit(g, 'skel')], slots: pb.slots, tier: 1, persistent: false });
    const base = CARDS.find((x) => x.id === 'skel')!.atk;
    expect(c.sides[0].units[0].atk).toBe(base + 12);
    const summoned = c.spawn(c.sides[0], 'skel', false, 1)!;
    expect(summoned.atk).toBe(base + 12);
    expect(c.spawn(c.sides[1], 'skel', false, 1)!.atk).toBe(base); // not the opponent's
  });

  it('Pyro\'s excess damage (only when attacking) hits one neighbour (both if Golden) and does not chain', async () => {
    for (const golden of [false, true]) {
      const g = newGame(7);
      const pyro = makeUnit(g, 'pyro'); pyro.atk = 40; pyro.hp = 40; pyro.golden = golden;
      const enemies = [0, 1, 2, 3, 4, 5, 6].map(() => { const u = makeUnit(g, 'skel'); u.atk = 1; u.hp = 1; return u; });
      const pa = g.players[0], pb = g.players[1];
      pa.hero = undefined; pb.hero = undefined; pa.powers = []; pb.powers = [];
      const c = new Combat(g, { p: pa, board: [pyro], slots: pa.slots, tier: 1, persistent: false },
        { p: pb, board: enemies, slots: pb.slots, tier: 1, persistent: false });
      const mine = c.sides[0].units[0];
      const theirs = c.sides[1].units;
      // hit back while defending: no spill
      c.damage(theirs[1], 40, mine);
      expect(theirs.filter((u) => u.hp <= 0).length).toBe(1);
      // attacking: spills once
      c.damage(theirs[4], 40, mine, false, true);
      const dead = theirs.filter((u) => u.hp <= 0).length;
      expect(dead).toBe(golden ? 4 : 3);
    }
  });

  it('damage cap is 15', () => {
    expect(combatDamage(5, 7, 0)).toBe(12);
    expect(combatDamage(2, 3, 1)).toBe(6);
    expect(combatDamage(6, 7, 4)).toBe(17); // no cap
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
  /** a game where the human has exactly this hero power */
  function withPower(id: string, seed = 11) {
    const g = newGame(seed);
    const p = human(g);
    p.hero = id;
    p.powers = [id];
    return { g, p };
  }

  it('every active hero power can be used without errors', async () => {
    const { HEROES, useHeroPower, canUseHeroPower } = await import('../src/engine/heroes');
    for (const h of HEROES.filter((x) => !x.passive)) {
      const { g, p } = withPower(h.id);
      p.gold = 10;
      p.tier = 4; // Bunny Wizard unlocks at Tier 4
      p.board = [makeUnit(g, 'ash'), makeUnit(g, 'lich')];
      p.lastOpponentBoard = [makeUnit(g, 'skeleton'), makeUnit(g, 'knight')]; // May Danaris
      expect(canUseHeroPower(g, p, h.id), h.id).toBe(true);
      if (!p.shop.length) p.shop = [makeUnit(g, 'ash')];
      expect(useHeroPower(g, p, h.target ? p.board[0] : h.targetShop ? p.shop[0] : undefined, h.id), h.id).toBe(true);
    }
  });

  it('Bunny Wizard is locked below Tier 4', async () => {
    const { canUseHeroPower } = await import('../src/engine/heroes');
    const { g, p } = withPower('bunny_wizard');
    p.gold = 10;
    p.tier = 3;
    expect(canUseHeroPower(g, p, 'bunny_wizard')).toBe(false);
  });

  it('Gelf Lanz: after buying an Azure unit, the next one costs 1 less', async () => {
    const { buyCost } = await import('../src/engine/heroes');
    const { g, p } = withPower('gelf_lanz');
    p.gold = 20;
    p.shop = [makeUnit(g, 'knight'), makeUnit(g, 'knight'), makeUnit(g, 'ash')];
    expect(buyCost(p, 'knight')).toBe(3);
    buy(g, p, 0);
    expect(buyCost(p, 'knight')).toBe(2);
    expect(buyCost(p, 'ash')).toBe(3);
  });

  it('Derby Pocket: after 5 Battlecry units, Battlecries trigger twice', async () => {
    const { heroHooks } = await import('../src/engine/heroes');
    const { g, p } = withPower('derby_pocket');
    for (let i = 0; i < 5; i++) {
      expect(heroHooks.battlecryTimes(p)).toBe(1);
      p.hand = [makeUnit(g, 'ashlie')];
      play(g, p, 0, 0);
      p.board = [];
    }
    expect(heroHooks.battlecryTimes(p)).toBe(2);
  });

  it('Bill Milton: playing a Business Demon gives 1 gold', () => {
    const { g, p } = withPower('bill_milton');
    p.gold = 0;
    p.hand = [makeUnit(g, 'intern'), makeUnit(g, 'ash')];
    play(g, p, 0, 0);
    expect(p.gold).toBe(1);
    play(g, p, 0, 0);
    expect(p.gold).toBe(1);
  });

  it('Locas Clare steals the whole Tavern, then resets to 10', async () => {
    const { useHeroPower, powerCost, heroDef } = await import('../src/engine/heroes');
    const { g, p } = withPower('locas_clare');
    g.round = 5;
    p.gold = 10;
    expect(powerCost(g, p, heroDef('locas_clare')!)).toBe(6);
    const n = p.shop.length;
    expect(useHeroPower(g, p, undefined, 'locas_clare')).toBe(true);
    expect(p.shop.length).toBe(0);
    expect(p.hand.length).toBe(n);
    g.round = 6;
    expect(powerCost(g, p, heroDef('locas_clare')!)).toBe(10);
  });

  it('Omar Evans: every 5 Cloister units sold gives a Cloister unit', () => {
    const { g, p } = withPower('omar_evans');
    for (let i = 0; i < 5; i++) { p.board = [makeUnit(g, 'disciple')]; sell(g, p, 0); }
    expect(p.hand.length).toBe(1);
    expect(def(p.hand[0].cardId).tribe).toBe('cloister');
  });

  it('Andromeda Robin starts with a Pumpkin that collects Deathrattles', async () => {
    const { gainPower } = await import('../src/engine/heroes');
    const g = newGame(5);
    const p = human(g);
    gainPower(g, p, 'andromeda_robin');
    expect(p.hand.some((u) => u.cardId === 'pumpkin')).toBe(true);
    // a Skeleton dies next to the Pumpkin: it keeps the Deathrattle for good
    const pumpkin = makeUnit(g, 'pumpkin');
    pumpkin.hp = 50;
    const pa = g.players[0], pb = g.players[1];
    pa.powers = []; pb.powers = [];
    pa.board = [pumpkin]; pb.board = [makeUnit(g, 'skeleton')];
    new Combat(g, { p: pa, board: pa.board, slots: pa.slots, tier: 1, persistent: true }, { p: pb, board: pb.board, slots: pb.slots, tier: 1, persistent: true }).run();
    expect(pumpkin.mem.dr_skeleton).toBe(1);
  });

  it('Croh Vosh: units summoned in combat get +1/+2', () => {
    const g = newGame(6);
    const pa = g.players[0], pb = g.players[1];
    pa.powers = ['croh_vosh']; pb.powers = [];
    const c = new Combat(g, { p: pa, board: [], slots: pa.slots, tier: 1, persistent: true }, { p: pb, board: [], slots: pb.slots, tier: 1, persistent: true });
    const u = c.spawn(c.sides[0], 'skel', false, 0)!;
    expect([u.atk, u.hp]).toEqual([2, 3]);
  });

  it('Clover summons a Dragon after 4 friendly deaths, and it grows', async () => {
    const { heroHooks } = await import('../src/engine/heroes');
    const g = newGame(7);
    const pa = g.players[0], pb = g.players[1];
    pa.powers = ['clover']; pb.powers = [];
    const c = new Combat(g, { p: pa, board: [], slots: pa.slots, tier: 1, persistent: true }, { p: pb, board: [], slots: pb.slots, tier: 1, persistent: true });
    for (let i = 0; i < 4; i++) heroHooks.onFriendlyDeath(c, c.sides[0]);
    expect(c.sides[0].units.map((u) => [u.cardId, u.atk, u.hp])).toEqual([['dragon', 1, 1]]);
    expect(pa.heroMem.brood).toBe(1);
    for (let i = 0; i < 4; i++) heroHooks.onFriendlyDeath(c, c.sides[0]);
    expect(c.sides[0].units[1].atk).toBe(2);
  });

  it('Trevor L gives Reborn after 5 friendly deaths', async () => {
    const { heroHooks } = await import('../src/engine/heroes');
    const g = newGame(8);
    const pa = g.players[0], pb = g.players[1];
    pa.powers = ['trevor_l']; pb.powers = [];
    const c = new Combat(g, { p: pa, board: [makeUnit(g, 'ash')], slots: pa.slots, tier: 1, persistent: true }, { p: pb, board: [], slots: pb.slots, tier: 1, persistent: true });
    const u = c.sides[0].units[0];
    u.kw = [];
    for (let i = 0; i < 5; i++) heroHooks.onFriendlyDeath(c, c.sides[0]);
    expect(u.kw).toContain('reborn');
  });

  it('Abragail swaps Well-Studied for two other Hero Powers on turn 4', async () => {
    const { g, p } = withPower('abragail');
    const { startTurn, chooseDiscover } = await import('../src/engine/game');
    g.round = 4;
    startTurn(g, p);
    expect(p.discovers.length).toBe(2);
    chooseDiscover(g, p, 0);
    chooseDiscover(g, p, 0);
    expect(p.powers.length).toBe(2);
    expect(p.powers).not.toContain('abragail');
  });
});

describe('Green Gem', () => {
  it('Deathrattle: gives your hand +1/+1, then +2/+2 next time (Golden: double)', async () => {
    const { Combat } = await import('../src/engine/combat');
    for (const golden of [false, true]) {
      const g = newGame(21);
      const pa = g.players[0], pb = g.players[1];
      pa.hero = undefined; pb.hero = undefined; pa.powers = []; pb.powers = []; pa.trinkets = []; pb.trinkets = [];
      const gem = makeUnit(g, 'green_gem', golden);
      const card = makeUnit(g, 'skel');
      const base = [card.atk, card.hp];
      pa.board = [gem]; pa.hand = [card];
      const k = golden ? 2 : 1;
      for (const round of [1, 2]) {
        const foe = makeUnit(g, 'skel'); foe.atk = 50; foe.hp = 50;
        new Combat(g, { p: pa, board: pa.board, slots: pa.slots, tier: 1, persistent: true }, { p: pb, board: [foe], slots: pb.slots, tier: 1, persistent: false }).run();
        const total = round === 1 ? k : k + 2 * k; // +1 then +2 (doubled when Golden)
        expect([card.atk - base[0], card.hp - base[1]]).toEqual([total, total]);
      }
      expect(gem.mem.imp).toBe(2);
    }
  });
});

describe('Treasure', () => {
  it('sells for 6 gold (12 Golden) only if you lost your last battle', async () => {
    const { sellValue } = await import('../src/engine/game');
    const g = newGame(4);
    const p = g.players[0];
    const t = makeUnit(g, 'treasure');
    expect([t.atk, t.hp]).toEqual([3, 9]);
    p.lostLast = false;
    expect(sellValue(t, p)).toBe(1);
    p.lostLast = true;
    expect(sellValue(t, p)).toBe(6);
    expect(sellValue(makeUnit(g, 'treasure', true), p)).toBe(12);
  });
});
