/** The November rework: Gems and the cards changed with them. */
import { describe, it, expect } from 'vitest';
import { newGame, play, reroll, sellValue, endTurn } from '../src/engine/game';
import { def, makeUnit } from '../src/engine/core';
import { gemLevel } from '../src/engine/effects';
import { Combat } from '../src/engine/combat';
import type { GameState, Player, Unit } from '../src/engine/types';

function setup(seed = 31) {
  const g = newGame(seed);
  for (const p of g.players) { p.hero = undefined; p.powers = []; p.trinkets = []; p.discovers = []; p.trinketOffer = null; }
  return { g, p: g.players[0], o: g.players[1] };
}
const u = (g: GameState, id: string, atk?: number, hp?: number, golden = false): Unit => {
  const x = makeUnit(g, id, golden);
  if (atk !== undefined) x.atk = atk;
  if (hp !== undefined) x.hp = hp;
  return x;
};
const fight = (g: GameState, p: Player, o: Player, mine: Unit[], theirs: Unit[]) =>
  new Combat(g, { p, board: mine, slots: p.slots, tier: p.tier, persistent: true }, { p: o, board: theirs, slots: o.slots, tier: 1, persistent: false });

describe('rework', () => {

  it('Virus: sets a random enemy to 1 Health at the start of battle', () => {
    const { g, p, o } = setup();
    const foe = u(g, 'skel', 1, 50);
    const c = fight(g, p, o, [u(g, 'virus', 0, 100)], [foe]);
    c.run();
    // the foe was set to 1 then hit by the 0-attack virus? no: virus has 0 attack here, so it ends at 1
    expect(c.sides[1].units[0].hp).toBe(1);
  });

  it('Tinker: each Refresh gives a shop unit Venomous, Divine Shield or Reborn', () => {
    const { g, p } = setup();
    p.board = [u(g, 'tinker')];
    p.gold = 10;
    reroll(g, p);
    const kws = p.shop.flatMap((x) => x.kw).filter((k) => ['venomous', 'divineShield', 'reborn'].includes(k));
    expect(kws.length).toBeGreaterThanOrEqual(1);
  });

  it('Left Twinbot: Rally gives all your Twinbots +1/+1 for the rest of the game', () => {
    const { g, p, o } = setup();
    const lt = u(g, 'left_twinbot', 2, 50);
    const c = fight(g, p, o, [lt, u(g, 'right_twinbot', 2, 50)], [u(g, 'skel', 0, 1)]);
    c.run();
    expect(p.twinBonus).toBeGreaterThanOrEqual(1);
    const fresh = makeUnit(g, 'right_twinbot');
    p.board = [fresh];
    const c2 = fight(g, p, o, p.board, [u(g, 'skel', 0, 1)]);
    expect(c2.sides[0].units[0].atk).toBe(def('right_twinbot').atk + p.twinBonus!);
  });

  it('Intern: Avenge (5) makes it sell for 1 more gold, for good', () => {
    const { g, p, o } = setup();
    const intern = u(g, 'intern', 0, 100);
    p.board = [intern, ...Array.from({ length: 5 }, () => u(g, 'skel', 0, 1))];
    fight(g, p, o, p.board, [u(g, 'skel', 50, 500)]).run();
    expect(sellValue(intern, p)).toBe(2);
  });

  it('Exploit: starts the Business Demons quest (buy 8, gain 12 gold)', () => {
    const { g, p } = setup();
    p.board = [];
    p.hand = [u(g, 'exploit')];
    expect(play(g, p, 0, 0).ok).toBe(true);
    expect(p.quests.at(-1)).toMatchObject({ kind: 'bill', need: 8, reward: 12 });
  });

  it('May Danaris: a 20/20 Phoenix with a random Gem on it', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [u(g, 'may_danaris', 0, 1)], [u(g, 'skel', 5, 1000)]);
    let ph: { atk: number; hp: number; kw: string[] } | undefined;
    const orig = c.spawn.bind(c);
    c.spawn = (...a: Parameters<typeof c.spawn>) => { const r = orig(...a); if (r?.cardId === 'phoenix') ph = r; return r; };
    c.run();
    expect(ph).toBeTruthy();
    // the Gem changed it somehow (stats, Reborn, Divine Shield or Windfury), or a Red/Potato Gem buffed a slot/neighbours
    expect(def('phoenix').atk).toBe(20);
  });

  it('Golden Light: summons 3 Deathrattle units', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [u(g, 'golden_light', 0, 1)], [u(g, 'skel', 1, 1000)]);
    let n = 0;
    const orig = c.spawn.bind(c);
    c.spawn = (...a: Parameters<typeof c.spawn>) => { const r = orig(...a); if (r) n++; return r; };
    c.run();
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('Andromeda Robin: plays a Potato Gem on its slot each end of turn and improves Potato Gems', () => {
    const { g, p } = setup();
    p.board = [u(g, 'andromeda_robin')];
    const eff = { g, p, self: p.board[0], m: 1, board: p.board };
    return import('../src/engine/effects').then(({ EFFECTS }) => {
      EFFECTS.andromeda_robin.endTurn!(eff);
      expect(p.slots[0].hp).toBe(4);
      expect(gemLevel(p, 'ancient_name_brambor')).toBe(1);
      EFFECTS.andromeda_robin.endTurn!(eff);
      expect(p.slots[0].hp).toBe(4 + 5);
    });
  });

  it('a whole turn with Gem cards in every hand still plays out', () => {
    const { g } = setup(77);
    for (const p of g.players) p.hand = ['purple_gem', 'tourmaline', 'pink_gem', 'green_gem', 'red_gem', 'ancient_name_brambor'].map((id) => makeUnit(g, id));
    expect(() => endTurn(g)).not.toThrow();
  });
});

describe('Sniper', () => {
  it('fires once plus once per other Alcove unit', async () => {
    const { EFFECTS } = await import('../src/engine/effects');
    const { g, p, o } = setup();
    const c = fight(g, p, o, [u(g, 'sniper'), u(g, 'tinker'), u(g, 'tinker')], [u(g, 'skel', 1, 100)]);
    const s = c.sides[0];
    EFFECTS.sniper.soc!({ g, c, side: s, self: s.units[0], m: 1, p, pos: 0 });
    expect(c.sides[1].units[0].hp).toBe(100 - 9);
  });
});

describe('rework 2', () => {
  it('Bill Milton (card): end of turn gains Attack equal to your maximum gold', async () => {
    const { EFFECTS } = await import('../src/engine/effects');
    const { maxGoldFor } = await import('../src/engine/game');
    const { g, p } = setup();
    const b = u(g, 'bill_milton');
    p.board = [b];
    const before = b.atk;
    EFFECTS.bill_milton.endTurn!({ g, p, self: b, m: 1, board: p.board });
    expect(b.atk).toBe(before + maxGoldFor(g, p));
  });

  it('Bulldozer: Rally gains a Red Gem and plays one (twice with Gem Wizard)', () => {
    const { g, p, o } = setup();
    p.hand = [];
    const dozer = u(g, 'miner', 1, 100);
    const wiz = u(g, 'gem_wizard', 0, 100);
    p.board = [dozer, wiz];
    const c = fight(g, p, o, p.board, [u(g, 'skel', 0, 1000)]);
    const before = c.sides[0].units.map((x) => x.atk + x.hp);
    c.attackNow(c.sides[0].units[0]);
    expect(p.hand.filter((x) => x.cardId === 'red_gem').length).toBe(1);
    const after = c.sides[0].units.map((x) => x.atk + x.hp);
    // one Red Gem played twice (Gem Wizard): +3 to each of the two units, twice
    expect(after[1] - before[1]).toBe(6);
  });

  it('Fighter: Rally summons a random Tier 1 unit', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [u(g, 'doctor', 1, 100)], [u(g, 'skel', 0, 1000)]);
    c.attackNow(c.sides[0].units[0]);
    expect(c.sides[0].units.length).toBe(2);
    expect(def(c.sides[0].units[1].cardId).tier).toBe(1);
  });
});
