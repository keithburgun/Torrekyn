import { EFFECTS } from '../src/engine/effects';
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

  it('damage is 2 + 2 per surviving unit (no cap)', () => {
    expect(combatDamage(7, 0)).toBe(16);
    expect(combatDamage(3, 1)).toBe(9);
    expect(combatDamage(7, 4)).toBe(20);
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
    expect(p.hand[0].atk).toBe(6);
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
    const reborn = makeUnit(g, 'skel');
    reborn.kw = ['reborn'];
    const { c } = fight(g, [reborn], [big]);
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
    p.discovers = [];
    p.board = [makeUnit(g, 'skel')];
    p.hand = [makeUnit(g, 'ancient_name_brambor')]; // Potato Gem: +8 Health to the chosen unit's slot
    play(g, p, 0, 1, p.board[0].uid);
    expect(p.slots[0].hp).toBe(8);
    sell(g, p, 0);
    sell(g, p, 0);
    p.hand = [makeUnit(g, 'skel')];
    play(g, p, 0, 0);
    const c = new Combat(g, { p, board: p.board, slots: p.slots, tier: 1, persistent: true },
      { p: g.players[1], board: [], slots: g.players[1].slots, tier: 1, persistent: true });
    expect(c.sides[0].units[0].hp).toBe(def('skel').hp + 8);
  });

  it('venomous kills big units', () => {
    const g = newGame(6);
    const { winner } = fight(g, [makeUnit(g, 'white_ninja')], [makeUnit(g, 'honeysuckle_kindred')]);
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

  it('Gelf Lanz: Inspire gets 1 cheaper for each Azure unit bought', async () => {
    const { powerCost, heroDef } = await import('../src/engine/heroes');
    const { g, p } = withPower('gelf_lanz');
    p.gold = 20;
    p.shop = [makeUnit(g, 'knight'), makeUnit(g, 'knight'), makeUnit(g, 'ash')];
    buy(g, p, 0); buy(g, p, 0);
    expect(powerCost(g, p, heroDef('gelf_lanz')!)).toBe(1);
  });

  it('Derby Pocket: after 5 Battlecry units, Battlecries trigger twice', async () => {
    const { heroHooks } = await import('../src/engine/heroes');
    const { g, p } = withPower('derby_pocket');
    for (let i = 0; i < 5; i++) {
      expect(heroHooks.battlecryExtra(p)).toBe(0);
      p.hand = [makeUnit(g, 'ashlie')];
      play(g, p, 0, 0);
      p.board = [];
    }
    expect(heroHooks.battlecryExtra(p)).toBe(1);
  });

  it('Bill Milton: buying a Business Demon gives 1 gold', () => {
    const { g, p } = withPower('bill_milton');
    p.gold = 3;
    p.shop = [makeUnit(g, 'intern'), makeUnit(g, 'skel')];
    buy(g, p, 0);
    expect(p.gold).toBe(1);
  });

  it('Locas Clare steals the whole Tavern, then resets to 7', async () => {
    const { useHeroPower, powerCost, heroDef } = await import('../src/engine/heroes');
    const { g, p } = withPower('locas_clare');
    g.round = 5;
    p.gold = 10;
    expect(powerCost(g, p, heroDef('locas_clare')!)).toBe(3);
    const n = p.shop.length;
    expect(useHeroPower(g, p, undefined, 'locas_clare')).toBe(true);
    expect(p.shop.length).toBe(0);
    expect(p.hand.length).toBe(n);
    g.round = 6;
    expect(powerCost(g, p, heroDef('locas_clare')!)).toBe(7);
  });

  it('Omar Evans: every 4 units sold Discovers a Cloister unit', () => {
    const { g, p } = withPower('omar_evans');
    p.discovers = [];
    for (let i = 0; i < 4; i++) { p.board = [makeUnit(g, 'disciple')]; sell(g, p, 0); }
    expect(p.discovers.length).toBe(1);
    for (const id of p.discovers[0].options as string[]) expect(def(id).tribe).toBe('cloister');
  });

  it('Andromeda Robin starts with a Pumpkin that collects Deathrattles', async () => {
    const { gainPower } = await import('../src/engine/heroes');
    const g = newGame(5);
    const p = human(g);
    gainPower(g, p, 'andromeda_robin');
    expect(p.hand.some((u) => u.cardId === 'pumpkin')).toBe(true);
    // a Skeleton dies: the Pumpkin has its Deathrattle for the rest of that battle only
    const pumpkin = makeUnit(g, 'pumpkin');
    pumpkin.hp = 50;
    const pa = g.players[0], pb = g.players[1];
    pa.powers = []; pb.powers = [];
    pa.board = [pumpkin]; pb.board = [makeUnit(g, 'skeleton')];
    const c = new Combat(g, { p: pa, board: pa.board, slots: pa.slots, tier: 1, persistent: true }, { p: pb, board: pb.board, slots: pb.slots, tier: 1, persistent: true });
    c.run();
    expect(c.sides[0].units[0].mem.dr_skeleton).toBe(1);
    expect(pumpkin.mem.dr_skeleton).toBeUndefined();
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

describe('Gems', () => {
  it('Gems can be improved, show it, and can be played on units in battle', async () => {
    const { gemLevel, improveGem } = await import('../src/engine/effects');
    const { play } = await import('../src/engine/game');
    const g = newGame(21); const p = g.players[0];
    p.discovers = []; p.trinketOffer = null;
    const t = makeUnit(g, 'skel');
    p.board = [t];
    p.hand = [makeUnit(g, 'tourmaline')]; // Blue Gem: +10 Health
    play(g, p, 0, 1, t.uid);
    expect(t.hp).toBe(def('skel').hp + 10);
    improveGem(p, 'tourmaline', 2);
    expect(gemLevel(p, 'tourmaline')).toBe(2);
    p.hand = [makeUnit(g, 'tourmaline')];
    play(g, p, 0, 2, t.uid);
    expect(t.hp).toBe(def('skel').hp + 10 + 14);
    // Broken Land improves every Gem, Red included
    p.hand = [makeUnit(g, 'broken_land')];
    play(g, p, 0, 0);
    expect(gemLevel(p, 'red_gem')).toBe(1);
    expect(gemLevel(p, 'green_gem')).toBe(1);
  });

  it('Purple Gem: Reborn and +1/+1 until your next turn', async () => {
    const { play } = await import('../src/engine/game');
    const g = newGame(22); const p = g.players[0];
    p.discovers = []; p.trinketOffer = null;
    const t = makeUnit(g, 'skel');
    const base = [t.atk, t.hp];
    p.board = [t];
    p.hand = [makeUnit(g, 'purple_gem')];
    play(g, p, 0, 1, t.uid);
    expect([t.atk, t.hp]).toEqual([base[0] + 1, base[1] + 1]);
    expect(t.kw).toContain('reborn');
  });
});

describe('Treasure', () => {
  it('sells for 5 gold (10 Golden) only if you lost your last battle', async () => {
    const { sellValue } = await import('../src/engine/game');
    const g = newGame(4);
    const p = g.players[0];
    const t = makeUnit(g, 'treasure');
    expect([t.atk, t.hp]).toEqual([3, 9]);
    p.lostLast = false;
    expect(sellValue(t, p)).toBe(1);
    p.lostLast = true;
    expect(sellValue(t, p)).toBe(5);
    expect(sellValue(makeUnit(g, 'treasure', true), p)).toBe(10);
  });
});

describe('full hand and triples', () => {
  it('a card gained with a full hand waits and arrives when there is room', async () => {
    const { gainCard, play } = await import('../src/engine/game');
    const g = newGame(8); const p = g.players[0];
    p.discovers = []; p.trinketOffer = null; p.board = [];
    const ids = CARDS.filter((c) => !c.token && c.tier === 1).map((c) => c.id);
    p.hand = Array.from({ length: 10 }, (_, i) => makeUnit(g, ids[i % 2]));
    const extra = makeUnit(g, ids[2]);
    expect(gainCard(g, p, extra)).toBe(false);
    expect(p.overflow).toEqual([extra]);
    const idx = p.hand.findIndex((u) => !EFFECTS[u.cardId]?.target);
    play(g, p, idx, 0);
    expect(p.hand).toContain(extra);
    expect(p.overflow?.length).toBe(0);
  });

  it('locked units count toward a triple, and the Golden copy arrives unlocked', async () => {
    const { gainCard } = await import('../src/engine/game');
    const g = newGame(9); const p = g.players[0];
    p.discovers = []; p.hand = [];
    const id = CARDS.find((c) => !c.token && c.tier === 1)!.id;
    const locked = makeUnit(g, id); locked.mem.locked = 1;
    p.board = [locked, makeUnit(g, id)];
    gainCard(g, p, makeUnit(g, id));
    expect(p.board.length).toBe(0);
    const gold = p.hand.find((u) => u.golden)!;
    expect(gold).toBeTruthy();
    expect(gold.mem.locked).toBeUndefined();
  });
});
