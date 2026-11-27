/** v0.14: Spells (like Battlegrounds' Tavern spells). One in the Tavern each Refresh; played from hand, then gone. */
import { describe, it, expect } from 'vitest';
import { newGame, play, buy, reroll, startTurn, endTurn, maxGoldFor, chooseDiscover, checkTriples } from '../src/engine/game';
import { makeUnit, def, CARDS, isSpell, isTribe } from '../src/engine/core';
import { Combat } from '../src/engine/combat';
import type { GameState, Unit } from '../src/engine/types';

function setup(seed = 7) {
  const g = newGame(seed, 'You', ['azure', 'kindred', 'brambor', 'cloister']);
  for (const p of g.players) { p.hero = undefined; p.powers = []; p.trinkets = []; p.discovers = []; p.trinketOffer = null; p.quests = []; }
  g.phase = 'shop'; g.round = 3;
  const p = g.players[0];
  p.tier = 5; p.gold = 50; p.board = []; p.hand = [];
  return { g, p };
}
const U = (g: GameState, id: string, atk?: number, hp?: number) => { const x = makeUnit(g, id); if (atk !== undefined) x.atk = atk; if (hp !== undefined) x.hp = hp; x.kw = []; return x; };
const cast = (g: GameState, p: ReturnType<typeof setup>['p'], id: string, target?: Unit) => { p.hand.push(makeUnit(g, id)); return play(g, p, p.hand.length - 1, 0, target?.uid); };

describe('Spells', () => {
  it('the Tavern has exactly one Spell after every Refresh, on the right, up to your Tier; Spells are never in the pool', () => {
    const { g, p } = setup();
    for (const tier of [1, 2, 3, 4, 5]) {
      p.tier = tier;
      for (let i = 0; i < 20; i++) {
        reroll(g, p);
        expect(p.shop.filter((u) => isSpell(u)).length).toBe(1);
        expect(isSpell(p.shop[p.shop.length - 1])).toBe(true);
        expect(def(p.shop[p.shop.length - 1].cardId).tier).toBeLessThanOrEqual(tier);
      }
    }
    for (const c of CARDS.filter((x) => x.spell)) expect(g.pool[c.id]).toBeUndefined();
  });

  it('the conversions: Gems are Tier 3 Spells for 2, Banners Tier 2, Shield Tier 1 for 1', () => {
    for (const id of ['tourmaline', 'pink_gem', 'ancient_name_brambor', 'green_gem', 'red_gem', 'purple_gem', 'white_gem']) expect([def(id).spell, def(id).tier, def(id).cost]).toEqual([true, 3, 2]);
    for (const id of ['silver_banner', 'gold_banner', 'red_banner']) expect([def(id).spell, def(id).tier, def(id).cost]).toEqual([true, 2, 2]);
    expect([def('shield_neutral').spell, def('shield_neutral').tier, def('shield_neutral').cost]).toEqual([true, 1, 1]);
    expect([def('omni_gem').spell, def('omni_gem').tier, def('omni_gem').cost]).toEqual([true, 4, 5]);
  });

  it("buying costs the Spell's price (Haste: Health), and it goes to your hand; casting uses it up", () => {
    const { g, p } = setup();
    p.shop = [makeUnit(g, 'coin'), makeUnit(g, 'haste')];
    p.gold = 5;
    expect(buy(g, p, 0).ok).toBe(true);
    expect(p.gold).toBe(4);
    const hp = p.health;
    expect(buy(g, p, 0).ok).toBe(true);
    expect([p.gold, p.health]).toEqual([4, hp - 2]);
    expect(play(g, p, 0, 0).ok).toBe(true); // Coin
    expect(play(g, p, 0, 0).ok).toBe(true); // Haste
    expect([p.gold, p.hand.length, p.board.length]).toEqual([6, 0, 0]);
    p.health = 2; p.shop = [makeUnit(g, 'haste')];
    expect(buy(g, p, 0).ok).toBe(false); // not with your last Health
  });

  it('Spells work with a full army, never triple, and nothing "when you play a unit" happens', () => {
    const { g, p } = setup();
    p.board = ['ash', 'skeleton', 'knight', 'disciple', 'farmer', 'therapist', 'sword'].map((id) => U(g, id, 1, 1));
    p.hand = [makeUnit(g, 'coin'), makeUnit(g, 'coin'), makeUnit(g, 'coin')];
    checkTriples(g, p);
    expect(p.hand.map((u) => [u.cardId, u.golden])).toEqual([['coin', false], ['coin', false], ['coin', false]]);
    const before = p.battlecriesThisTurn;
    expect(play(g, p, 0, 0).ok).toBe(true);
    expect(p.battlecriesThisTurn).toBe(before);
    expect(p.board.length).toBe(7);
  });

  it('a targeted Spell needs a unit; Spells are not "units in your hand"', () => {
    const { g, p } = setup();
    expect(cast(g, p, 'tourmaline').ok).toBe(false);
    p.hand = [];
    const a = U(g, 'ash', 1, 1), h = U(g, 'ash', 1, 1);
    p.board = [a]; p.hand = [h, makeUnit(g, 'coin')];
    cast(g, p, 'red_banner'); // four random friendly units: the army, not the hand
    expect([a.hp, h.hp, p.hand[1].hp]).toEqual([3, 1, 0]);
  });

  it('Coin, Invest, Soda, Strike Oil, Heal Up! (to at most 10)', () => {
    const { g, p } = setup();
    p.gold = 0; p.goldNextTurn = 0; p.freeRerolls = 0;
    cast(g, p, 'coin'); expect(p.gold).toBe(1);
    cast(g, p, 'invest'); expect(p.goldNextTurn).toBe(2);
    cast(g, p, 'scope'); expect(p.freeRerolls).toBe(2);
    const max = maxGoldFor(g, p);
    cast(g, p, 'strike_oil'); expect(maxGoldFor(g, p)).toBe(max + 1);
    p.health = 3; cast(g, p, 'heal_up'); expect(p.health).toBe(8);
    cast(g, p, 'heal_up'); expect(p.health).toBe(10); // up to 10
    p.health = 14; cast(g, p, 'heal_up'); expect(p.health).toBe(14); // never lowers it
    expect(def('scope').name).toBe('Soda');
  });

  it('Growth Sprout (Tier 1), Potential (your Tier), Last of Our Kind (your most common faction)', () => {
    const { g, p } = setup();
    cast(g, p, 'growth_sprout');
    expect(p.discovers[0].options.every((id) => def(id).tier === 1 && !def(id).spell)).toBe(true);
    chooseDiscover(g, p, 0);
    p.tier = 4;
    cast(g, p, 'potential');
    expect(p.discovers[0].options.every((id) => def(id).tier === 4)).toBe(true);
    chooseDiscover(g, p, 0);
    for (let i = 0; i < 10; i++) {
      cast(g, p, 'omni_gem');
      expect(p.discovers[0].options.every((id) => def(id).tier === 5 && !def(id).spell)).toBe(true);
      p.discovers = [];
    }
    p.board = [U(g, 'knight'), U(g, 'knight'), U(g, 'disciple')];
    cast(g, p, 'last_of_our_kind');
    expect(p.discovers[0].options.every((id) => isTribe(id, 'azure') && def(id).tier <= 4)).toBe(true);
  });

  it("Blessin': +2/+2 to the chosen unit and every unit sharing a faction with it", () => {
    const { g, p } = setup();
    const k1 = U(g, 'knight', 1, 1), k2 = U(g, 'knight', 1, 1), d = U(g, 'disciple', 1, 1);
    p.board = [k1, k2, d];
    cast(g, p, 'blessin', k1);
    expect([k1.atk, k2.atk, d.atk]).toEqual([3, 3, 1]);
  });

  it('Devour!: sells the chosen unit (you get its Gold) and gives its stats to a random friendly unit', () => {
    const { g, p } = setup();
    const a = U(g, 'ash', 5, 7), b = U(g, 'ash', 1, 1);
    p.board = [a, b]; p.gold = 0;
    cast(g, p, 'devour', a);
    expect(p.board).toEqual([b]);
    expect([b.atk, b.hp, p.gold]).toEqual([6, 8, 1]);
  });

  it('Banners: the chosen unit and its neighbours; each Banner improves the next; Red Banner: four random units +1/+2', () => {
    const { g, p } = setup();
    const us = [1, 2, 3, 4].map(() => U(g, 'ash', 1, 1));
    p.board = [...us];
    cast(g, p, 'silver_banner', us[1]);
    expect(us.map((u) => u.atk)).toEqual([4, 4, 4, 1]);
    cast(g, p, 'gold_banner', us[3]);
    expect(us.map((u) => u.hp)).toEqual([1, 1, 5, 5]);
    p.bannerBonus = 0;
    cast(g, p, 'red_banner');
    expect(us.every((u) => u.hp >= 3)).toBe(true);
  });

  it('Different Power Time: Discover a Hero Power that replaces yours', () => {
    const { g, p } = setup();
    p.hero = 'zara'; p.powers = ['zara'];
    cast(g, p, 'different_power_time');
    expect(p.discovers[0].powers).toBe(true);
    const pick = p.discovers[0].options[0];
    chooseDiscover(g, p, 0);
    expect(p.powers).toEqual([pick]);
  });

  it('Elder: Start of Combat, ONE other Brambor unit gets its Attack', () => {
    const { g, p } = setup();
    const o = g.players[1];
    const e = U(g, 'elder', 5, 50), b1 = U(g, 'farmer', 1, 50), b2 = U(g, 'farmer', 1, 50);
    const c = new Combat(g, { p, board: [e, b1, b2], tier: 5, persistent: false }, { p: o, board: [U(g, 'skel', 0, 99)], tier: 1, persistent: false });
    c.run();
    const f = c.frames[c.frames.findIndex((x) => x.kind === 'attack') - 1];
    expect(f.sides[0].filter((u) => u.cardId === 'farmer').map((u) => u.atk).sort()).toEqual([1, 6]);
  });

  it('bots buy and cast Spells, and finish games with them around', () => {
    const g = newGame(99);
    let cast = 0;
    const { players } = g;
    g.players[0].heroOffer = undefined;
    g.simulateAll = true;
    for (const pl of players) { pl.hero = pl.hero ?? 'zara'; }
    g.phase = 'shop'; g.round = 0;
    const start = (): void => { g.round++; for (const pl of players) startTurn(g, pl); };
    start();
    for (let r = 0; r < 14 && (g.phase as string) !== 'over'; r++) {
      endTurn(g);
      cast = players.reduce((s, pl) => s + (pl.spellsCast ?? 0), 0);
    }
    expect(cast).toBeGreaterThan(5);
    // (Gems that arrive at End of Turn or after the battle, e.g. Corrivath Harp's, wait in hand for the next turn)
    for (const pl of players) expect(pl.hand.filter((u) => isSpell(u)).length).toBeLessThanOrEqual(6);
  });

  it('Corn Snail (Tier 1 Kindred 2/2): after 3 Spells played while it is in your army, +6/+6, only once; Librarian is a Tier 3 2/4', () => {
    expect([def('librarian').tier, def('librarian').atk, def('librarian').hp]).toEqual([3, 2, 4]);
    expect([def('corn_snail').tribe, def('corn_snail').tier, def('corn_snail').atk, def('corn_snail').hp]).toEqual(['kindred', 1, 2, 2]);
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const s = makeUnit(g, 'corn_snail', golden);
      p.board = [s];
      cast(g, p, 'coin'); cast(g, p, 'coin');
      expect(s.atk).toBe(def('corn_snail').atk * (golden ? 2 : 1));
      cast(g, p, 'coin');
      const m = golden ? 2 : 1;
      expect([s.atk, s.hp]).toEqual([(2 + 6) * m, (2 + 6) * m]);
      for (let i = 0; i < 4; i++) cast(g, p, 'coin');
      expect([s.atk, s.hp]).toEqual([(2 + 6) * m, (2 + 6) * m]); // only once
    }
  });

  it('Medic (Tier 4 Kindred 9/9): +2 Health per Health your hero is missing (Golden +4), wherever it is', async () => {
    const { effStats } = await import('../src/engine/core');
    const { g, p } = setup();
    p.maxHealth = 25; p.health = 25;
    const m = makeUnit(g, 'medic'), gm = makeUnit(g, 'medic', true);
    expect(effStats(p, m, 'board').hp).toBe(9);
    p.health = 15;
    expect(effStats(p, m, 'hand').hp).toBe(9 + 20);
    expect(effStats(p, gm, 'board').hp).toBe(18 + 40);
    p.health = 30; // above the start (Heal Up can't, but just in case): no bonus, never less
    expect(effStats(p, m, 'board').hp).toBe(9);
  });

  it('Ballooneer (Tier 2 Azure 2/2): Rally gives another Azure unit +1/+1 and the Rally, which then spreads', () => {
    expect([def('ballooneer').tribe, def('ballooneer').tier, def('ballooneer').atk, def('ballooneer').hp]).toEqual(['azure', 2, 2, 2]);
    const { g, p } = setup();
    const o = g.players[1];
    const b = U(g, 'ballooneer', 1, 100), k1 = U(g, 'knight', 1, 100), k2 = U(g, 'knight', 1, 100);
    k1.atk = 1; k2.atk = 1;
    const c = new Combat(g, { p, board: [b, k1, k2], tier: 2, persistent: false }, { p: o, board: [U(g, 'skel', 0, 999)], tier: 1, persistent: false });
    c.run();
    const notes = c.frames.map((f) => f.note ?? '');
    expect(notes.some((n) => n.startsWith('Ballooneer: Rally'))).toBe(true);
    expect(notes.some((n) => n.startsWith("Knight: Ballooneer's Rally"))).toBe(true); // a Knight was given it and used it
    expect(b.atk).toBe(1); // (battle-only: the army is untouched)
  });

  it('Royal Guard: Deathrattle, summon 2 Bulwarks (Golden: 4); Gelf Lanz is 10/20; Lake says Done! once it has doubled', async () => {
    const { unitCounter } = await import('../src/engine/fx');
    expect([def('gelf_lanz').atk, def('gelf_lanz').hp]).toEqual([10, 20]);
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const o = g.players[1];
      const c = new Combat(g, { p, board: [makeUnit(g, 'royal_guard', golden)], tier: 2, persistent: false }, { p: o, board: [U(g, 'skel', 99, 99)], tier: 1, persistent: false });
      c.run();
      const most = Math.max(...c.frames.map((f) => f.sides[0].filter((u) => u.cardId === 'shield_azure').length));
      expect(most).toBe(golden ? 4 : 2);
    }
    const { g } = setup();
    const lake = makeUnit(g, 'lake');
    expect(unitCounter(lake)).toBe('0/3');
    lake.mem.done = 1;
    expect(unitCounter(lake)).toBe('Done!');
  });

  it('the Tavern shows 3 units at Tier 1 and 4 from Tier 2 on (plus the Spell)', async () => {
    const { reroll } = await import('../src/engine/game');
    const { CONFIG } = await import('../src/engine/core');
    expect(CONFIG.shopSize).toEqual([0, 3, 4, 4, 4, 4]);
    const { g, p } = setup();
    for (const t of [1, 2, 5]) { p.tier = t; reroll(g, p); expect(p.shop.filter((u) => !isSpell(u)).length).toBe(t === 1 ? 3 : 4); }
  });

  it('Sapling: Deathrattle: Brambor units in the Tavern have +1/+1 this game (Golden +2/+2); a practice battle changes nothing', async () => {
    const { reroll } = await import('../src/engine/game');
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const o = g.players[1];
      new Combat(g, { p, board: [makeUnit(g, 'sapling', golden)], tier: 1, persistent: false }, { p: o, board: [U(g, 'skel', 99, 99)], tier: 1, persistent: false }).run();
      expect(p.shopBuff).toBeUndefined();
      new Combat(g, { p, board: [makeUnit(g, 'sapling', golden)], tier: 1, persistent: true }, { p: o, board: [U(g, 'skel', 99, 99)], tier: 1, persistent: false }).run();
      const m = golden ? 2 : 1;
      expect(p.shopBuff).toEqual({ brambor: [m, m] });
      p.tier = 5; p.gold = 99;
      for (let i = 0; i < 10; i++) {
        reroll(g, p);
        for (const u of p.shop.filter((x) => !isSpell(x))) expect(u.atk - def(u.cardId).atk).toBe(isTribe(u, 'brambor') ? m : 0);
      }
    }
  });

  it('Root: Arrive: from now on, each Refresh gives a random Tavern unit +6/+6 (Golden: twice)', async () => {
    const { reroll } = await import('../src/engine/game');
    for (const golden of [false, true]) {
      const { g, p } = setup();
      p.tier = 1; p.board = []; p.hand = [makeUnit(g, 'root', golden)];
      play(g, p, 0, 0);
      p.gold = 99;
      reroll(g, p);
      const extra = p.shop.filter((u) => !isSpell(u)).reduce((s, u) => s + u.atk - def(u.cardId).atk, 0);
      expect(extra).toBe(6 * (golden ? 2 : 1));
    }
  });

  it('Chosen Name is 5/5', () => { expect([def('chosen_name').atk, def('chosen_name').hp]).toEqual([5, 5]); });

  it('Igloo Tank (Tier 3 Azure 1/8 Taunt): each Azure unit appearing in the Tavern: it and the Igloo get +2 Attack', async () => {
    const { reroll } = await import('../src/engine/game');
    expect([def('igloo_tank').tribe, def('igloo_tank').tier, def('igloo_tank').atk, def('igloo_tank').hp, def('igloo_tank').keywords]).toEqual(['azure', 3, 1, 8, ['taunt']]);
    const { g, p } = setup();
    const ig = makeUnit(g, 'igloo_tank');
    p.board = [ig]; p.tier = 5; p.gold = 99;
    let azure = 0;
    for (let i = 0; i < 15; i++) {
      reroll(g, p);
      for (const u of p.shop.filter((x) => isTribe(x, 'azure'))) { azure++; expect(u.atk).toBe(def(u.cardId).atk + 2); }
    }
    expect(azure).toBeGreaterThan(0);
    expect(ig.atk).toBe(1 + 2 * azure);
  });

  it('Hack Factory (Tier 2 Alcove 2/3): End of Turn, the unit to its left becomes a random higher-Tier unit (up to Tier 6)', async () => {
    const { endTurnEffects } = await import('../src/engine/game');
    expect([def('hack_factory').tribe, def('hack_factory').tier, def('hack_factory').atk, def('hack_factory').hp]).toEqual(['alcove', 2, 2, 3]);
    let six = false;
    for (let seed = 1; seed < 60; seed++) {
      const { g, p } = setup(seed);
      const l = makeUnit(g, 'ash'), hf = makeUnit(g, 'hack_factory'), r = makeUnit(g, 'skeleton');
      p.board = [l, hf, r];
      endTurnEffects(g, p);
      expect(def(l.cardId).tier).toBeGreaterThan(1);
      expect(def(l.cardId).spell).toBeFalsy();
      expect([l.atk, l.hp]).toEqual([def(l.cardId).atk, def(l.cardId).hp]);
      expect(r.cardId).toBe('skeleton'); // (Golden: both sides)
      if (def(l.cardId).tier === 6) six = true;
    }
    expect(six).toBe(true);
  });

  it('Faris (Tier 2 Neutral 6/1): +3 Attack and Bubble whenever a friendly unit is summoned in battle', () => {
    const { g, p } = setup();
    const o = g.players[1];
    const f = U(g, 'faris', 6, 1);
    const c = new Combat(g, { p, board: [makeUnit(g, 'skeleton'), f], tier: 2, persistent: false }, { p: o, board: [U(g, 'skel', 1, 99)], tier: 1, persistent: false });
    c.run();
    const after = c.frames.find((fr) => (fr.note ?? '').startsWith('Summon Skel'));
    const fr = after!.sides[0].find((u) => u.cardId === 'faris')!;
    expect(fr.atk).toBeGreaterThanOrEqual(6 + 3);
    expect(fr.kw).toContain('divineShield');
  });

  it('Deathberry Bush (Tier 4 Neverending 1/8): summons in battle happen twice (Golden: 3 times)', () => {
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const o = g.players[1];
      const c = new Combat(g, { p, board: [makeUnit(g, 'skeleton'), makeUnit(g, 'deathberry_bush', golden)], tier: 4, persistent: false }, { p: o, board: [U(g, 'skel', 1, 999)], tier: 1, persistent: false });
      c.run();
      const most = Math.max(...c.frames.map((fr) => fr.sides[0].filter((u) => u.cardId === 'skel').length));
      expect(most).toBe(golden ? 6 : 4); // Skeleton's 2 Skels, each summoned 2x (3x)
    }
  });
});
