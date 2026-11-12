/**
 * Every ability does *something*: each hook is run in a small, friendly situation and the game state must change.
 * (Catches abilities that silently do nothing.) Passive auras handled elsewhere are listed in PASSIVE.
 */
import { describe, it, expect } from 'vitest';
import { newGame, buy, play, sell } from '../src/engine/game';
import { CARDS, makeUnit, def } from '../src/engine/core';
import { EFFECTS } from '../src/engine/effects';
import { Combat } from '../src/engine/combat';
import type { GameState, Player, Unit } from '../src/engine/types';

const FILL = ['ash', 'command', 'knight', 'doctor', 'hug', 'sapling', 'hunter', 'mod', 'pyro'];

function setup(seed: number) {
  const g = newGame(seed);
  for (const p of g.players) { p.hero = undefined; p.powers = []; p.trinkets = []; p.discovers = []; p.trinketOffer = null; }
  const p = g.players[0];
  p.tier = 4;
  p.gold = 20;
  p.lastOpponentBoard = ['ash', 'knight', 'mod'].map((id) => makeUnit(g, id));
  return { g, p, o: g.players[1] };
}

const snap = (g: GameState, p: Player, extra: unknown = null) =>
  JSON.stringify([p.board, p.hand, p.slots, p.discovers, p.quests, p.gold, p.maxGoldBonus, p.tribeAtk, p.gemBonus, p.redGemBonus,
    p.bannerBonus, p.alcoveAtkThisTier, p.twinBonus, p.freeRerolls, p.upgradeCost, p.shop, p.overflow, extra]);

describe('every ability changes something', () => {
  const ids = CARDS.filter((c) => EFFECTS[c.id]).map((c) => c.id);
  for (const golden of [false, true]) {
    it(`shop hooks (${golden ? 'golden' : 'normal'})`, () => {
      const dead: string[] = [];
      for (const id of ids) {
        const e = EFFECTS[id];
        for (const hook of ['battlecry', 'endTurn', 'onSell', 'startTurn', 'onPlay'] as const) {
          if (!e[hook]) continue;
          let changed = false;
          for (let seed = 1; seed <= 6 && !changed; seed++) {
            const { g, p } = setup(seed * 7 + ids.indexOf(id));
            p.board = FILL.slice(0, 4).map((x) => makeUnit(g, x));
            p.hand = ['librarian', 'patchwork', 'secret'].map((x) => makeUnit(g, x));
            p.slots[0].atk = 2; // a slot with powers (Paradox copies it)
            const self = makeUnit(g, id, golden);
            p.board.splice(2, 0, self);
            const before = snap(g, p);
            (e[hook] as (c: unknown) => void)({ g, p, self, m: golden ? 2 : 1, board: p.board, target: e.target ? p.board[1] : undefined });
            changed = snap(g, p) !== before;
          }
          if (!changed) dead.push(`${id}.${hook}`);
        }
      }
      expect(dead).toEqual([]);
    });

    it(`combat hooks (${golden ? 'golden' : 'normal'})`, () => {
      const dead: string[] = [];
      for (const id of ids) {
        const e = EFFECTS[id];
        for (const hook of ['soc', 'rally', 'deathrattle', 'avengeFn'] as const) {
          if (!e[hook]) continue;
          let changed = false;
          for (let seed = 1; seed <= 6 && !changed; seed++) {
            const { g, p, o } = setup(seed * 13 + ids.indexOf(id));
            const mine: Unit[] = ['ash', 'shield_azure', 'knight', 'white_ninja', 'hunter'].map((x) => makeUnit(g, x));
            const selfU = makeUnit(g, id, golden);
            selfU.atk = Math.max(selfU.atk, 6);
            mine.splice(2, 0, selfU);
            p.board = mine;
            p.hand = ['librarian', 'orange_ninja', 'ambush', 'hug'].map((x) => makeUnit(g, x));
            p.hand[2].atk = 9; // a Cloister unit in hand for Ambush
            p.tier = 3; // Drill Sergeant
            p.slots[2].hp = 3; // Elder gives this slot's stats
            const theirs = ['ash', 'mod', 'knight', 'sapling'].map((x) => makeUnit(g, x));
            const c = new Combat(g, { p, board: mine, slots: p.slots, tier: p.tier, persistent: true }, { p: o, board: theirs, slots: o.slots, tier: 1, persistent: false });
            const side = c.sides[0];
            const cu = side.units[2];
            cu.killedBy = c.sides[1].units[1];
            const fp = () => snap(g, p, [c.sides.map((s) => s.units.map((u) => [u.cardId, u.atk, u.hp, u.kw])), side.secrets]);
            const before = fp();
            if (hook === 'deathrattle') {
              cu.hp = 0;
              side.units.splice(2, 1);
              e.deathrattle!(c.ctx(cu, 2));
            } else if (hook === 'rally') e.rally!(c.ctx(cu), c.sides[1].units[0]);
            else (e[hook] as (x: unknown) => void)(c.ctx(cu));
            for (const fn of side.afterFns) fn();
            changed = fp() !== before;
          }
          if (!changed) dead.push(`${id}.${hook}`);
        }
      }
      expect(dead).toEqual([]);
    });
  }

  it('every card with ability text has an ability', () => {
    const PASSIVE = new Set(['vulnerability', 'root', 'larva', 'orange_ninja', 'pyro', 'treasure', 'warmech', 'gem_wizard', 'sarinee', 'tom_judith', 'horseman', 'shield_azure', 'roll_guard', 'ash', 'white_ninja']);
    const missing = CARDS.filter((c) => !c.token && c.text && !PASSIVE.has(c.id) && !Object.keys(EFFECTS[c.id] ?? {}).length).map((c) => c.id);
    expect(missing).toEqual([]);
    expect(def('skel').text).toBe('');
  });

  // ---- abilities that wait for something to happen: make it happen for real ----
  const fightOf = (g: GameState, p: Player, o: Player, mine: Unit[], theirs: Unit[]) =>
    new Combat(g, { p, board: mine, slots: p.slots, tier: p.tier, persistent: true }, { p: o, board: theirs, slots: o.slots, tier: 1, persistent: false });
  const U = (g: GameState, id: string, atk?: number, hp?: number) => { const x = makeUnit(g, id); if (atk !== undefined) x.atk = atk; if (hp !== undefined) x.hp = hp; return x; };

  it('event abilities trigger in real battles', () => {
    const { g, p, o } = setup(5);
    // Funeral: a Reborn happens; Bramble: a Neverending unit dies; Vampire: a Deathrattle unit dies; Locas: a Taunt dies
    const funeral = U(g, 'funeral', 0, 100), bramble = U(g, 'bramble', 0, 100), vamp = U(g, 'vampire', 0, 100), locas = U(g, 'locas', 0, 100);
    p.board = [U(g, 'horseman', 1, 1), U(g, 'skeleton', 1, 1), U(g, 'ash', 1, 1), funeral, bramble, vamp, locas];
    const c = fightOf(g, p, o, p.board, [U(g, 'skel', 1, 400)]);
    c.run();
    expect(funeral.hp).toBeGreaterThan(100);
    expect(vamp.hp).toBeGreaterThan(100);
    expect(locas.atk).toBeGreaterThan(0);
    const cb = c.frames.at(-1)!.sides[0].find((x) => x.cardId === 'bramble');
    if (cb) expect(cb.atk).toBeGreaterThan(0);
  });

  it('Warlock grows when a Rally happens; Ocean Sky when a Divine Shield breaks; Biker when hit', () => {
    const { g, p, o } = setup(6);
    const warlock = U(g, 'warlock', 0, 100), ocean = U(g, 'ocean_sky', 0, 100);
    p.board = [U(g, 'cursed_vines', 1, 100), U(g, 'shield_azure', 1, 100), warlock, ocean];
    fightOf(g, p, o, p.board, [U(g, 'skel', 1, 30)]).run();
    expect(warlock.hp).toBeGreaterThan(100);
    expect(p.board[1].atk).toBeGreaterThan(1); // the Azure Shield got +3/+3 for good
    const c = fightOf(g, p, o, [U(g, 'biker', 1, 30)], [U(g, 'skel', 1, 30)]);
    c.run();
    const b = c.frames.find((f) => f.kind === 'hit')!.sides[0][0];
    expect(b.atk).toBeGreaterThan(1);
  });

  it('shop watchers: Shadow Place, Aerial Drone, Shopkeep, Patchwork, Devotion', () => {
    const { g, p } = setup(7);
    const shadow = U(g, 'shadow_place'), drone = U(g, 'aerial_drone'), keep = U(g, 'shopkeep'), patch = U(g, 'patchwork');
    p.board = [shadow, drone, keep, patch];
    p.hand = [U(g, 'hunter'), U(g, 'librarian')];
    const sum = () => p.board.reduce((s, x) => s + x.atk + x.hp, 0);
    let before = sum();
    play(g, p, 0, 4); // a Cloister unit: Shadow Place buffs two others
    expect(sum()).toBeGreaterThan(before + def('hunter').atk + def('hunter').hp);
    before = drone.atk;
    play(g, p, 0, 5); // a Battlecry: Aerial Drone grows
    expect(drone.atk).toBeGreaterThan(before);
    p.discovers = [];
    // Shopkeep: 4 buys gain a Tier 1 unit; Patchwork: a Kindred unit gained grows its slot
    p.gold = 99; p.hand = [];
    for (const id of ['doctor', 'architect', 'hug', 'command']) { p.shop = [U(g, id)]; buy(g, p, 0); }
    expect(p.hand.length).toBeGreaterThanOrEqual(5);
    expect(p.slots[3].hp).toBeGreaterThan(0);
    // Devotion: buying 8 Kindred units gives the outer slots Reborn
    p.board = []; p.hand = [U(g, 'devotion')];
    play(g, p, 0, 0);
    for (let i = 0; i < 8; i++) { p.hand = []; p.shop = [U(g, 'doctor')]; buy(g, p, 0); }
    expect(p.slots[0].kw).toContain('reborn');
  });
});
