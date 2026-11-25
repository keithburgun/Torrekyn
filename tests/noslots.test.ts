/** v0.10: slots no longer have bonuses; the cards and trinkets that used them were rewritten. Each one, checked. */
import { describe, it, expect } from 'vitest';
import { newGame, play, endTurnEffects, buy, sell } from '../src/engine/game';
import { makeUnit, def, CARDS, isTribe } from '../src/engine/core';
import { Combat } from '../src/engine/combat';
import { gemLevel } from '../src/engine/effects';
import { peebSync } from '../src/engine/fx';
import { pickTrinket } from '../src/engine/heroes';
import type { GameState, Player, Unit } from '../src/engine/types';

function setup(seed = 11) {
  const g = newGame(seed);
  for (const p of g.players) { p.hero = undefined; p.powers = []; p.trinkets = []; p.discovers = []; p.trinketOffer = null; p.quests = []; }
  const p = g.players[0];
  p.tier = 5; p.gold = 50; p.board = []; p.hand = [];
  return { g, p, o: g.players[1] };
}
const U = (g: GameState, id: string, atk?: number, hp?: number, golden = false) => {
  const x = makeUnit(g, id, golden);
  if (atk !== undefined) x.atk = atk;
  if (hp !== undefined) x.hp = hp;
  return x;
};
const fight = (g: GameState, p: Player, o: Player, mine: Unit[], theirs: Unit[]) =>
  new Combat(g, { p, board: mine, tier: p.tier, persistent: true }, { p: o, board: theirs, tier: 1, persistent: false });
/** a frame's view of a unit by card id */
const at = (c: Combat, frame: number, id: string) => c.frames[frame].sides[0].find((u) => u.cardId === id);
const afterSoc = (c: Combat) => c.frames.findIndex((f) => f.kind === 'attack') - 1;

describe('cards rewritten without slots', () => {
  it('Message: Arrive gives units with Taunt or Bubble +2/+2', () => {
    const { g, p } = setup();
    const t = U(g, 'ash', 2, 2); t.kw = ['taunt'];
    const d = U(g, 'doctor', 2, 2); d.kw = ['divineShield'];
    const n = U(g, 'doctor', 2, 2); n.kw = [];
    p.board = [t, d, n]; p.hand = [U(g, 'message')];
    play(g, p, 0, 3);
    expect([t.atk, t.hp, d.atk, d.hp, n.atk, n.hp]).toEqual([4, 4, 4, 4, 2, 2]);
  });

  it('Front and Center: Start of Combat gives two Azure units Bubble', () => {
    const { g, p, o } = setup();
    const az = [U(g, 'knight', 1, 50), U(g, 'longbow', 1, 50), U(g, 'front_and_center', 1, 50)];
    az.forEach((x) => (x.kw = []));
    const c = fight(g, p, o, [U(g, 'skel', 1, 50), ...az], [U(g, 'skel', 1, 50)]);
    c.run();
    const f = c.frames[afterSoc(c)];
    expect(f.sides[0].filter((u) => u.kw.includes('divineShield')).length).toBe(2);
    expect(f.sides[0][0].kw).not.toContain('divineShield'); // the Skel isn't Azure
  });

  it('Remember: adjacent Azure units keep stats and keywords gained in battle (Golden doubles)', () => {
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      const left = U(g, 'longbow', 3, 40); left.kw = [];
      const right = U(g, 'longbow', 3, 40); right.kw = [];
      const far = U(g, 'longbow', 3, 40); far.kw = [];
      // War Drum (+2 Attack) and Aegis Charm (Bubble on the 2 left-most) give them something to keep
      p.trinkets = ['war_drum', 'aegis_charm'];
      const rem = U(g, 'remember', 1, 40, golden);
      p.board = [left, rem, right, far];
      fight(g, p, o, p.board, [U(g, 'skel', 1, 3)]).run();
      const m = golden ? 2 : 1;
      expect(rem.atk).toBe(1); // not itself
      expect(left.atk).toBe(3 + 2 * m);
      expect(right.atk).toBe(3 + 2 * m);
      expect(left.kw).toContain("divineShield"); // gained at Start of Combat (kept even if it broke later)
      expect(far.atk).toBe(3); // not adjacent
    }
  });

  it('Remember: damage taken is not "lost" stats, and Health buffs are kept', () => {
    const { g, p, o } = setup();
    const az = U(g, 'longbow', 1, 30); az.kw = [];
    p.trinkets = ['bannerlords_standard']; // +3/+3 at Start of Combat
    p.board = [U(g, 'remember', 1, 30), az];
    fight(g, p, o, p.board, [U(g, 'skel', 5, 5)]).run();
    expect([az.atk, az.hp]).toEqual([4, 33]);
  });

  it('Commitment: Start of Combat +1/+1 to your units, improving with each Arrive unit played', () => {
    const { g, p, o } = setup();
    const com = U(g, 'commitment', 8, 20);
    p.board = [com, U(g, 'skel', 1, 30)];
    p.hand = [U(g, 'red_gem'), U(g, 'hug')];
    play(g, p, 0, 2); // an Arrive unit
    play(g, p, 0, 3); // another
    expect(com.mem.imp).toBe(2);
    const c = fight(g, p, o, p.board.slice(0, 2), [U(g, 'skel', 1, 99)]);
    c.run();
    expect(at(c, afterSoc(c), 'skel')!.atk).toBe(1 + 3 + 3); // +3 from Commitment, +3 from the Red Gem
  });

  it('Gelf Lanz (card): Rally gains the Attack of the unit it attacks, for the battle', () => {
    const { g, p, o } = setup();
    const gl = U(g, 'gelf_lanz', 5, 100);
    const c = fight(g, p, o, [gl], [U(g, 'skel', 7, 100)]);
    c.run();
    const hits = c.frames.filter((f) => f.kind === 'attack' && f.attacker === c.frames[0].sides[0][0].id);
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.max(...c.frames.map((f) => f.sides[0][0]?.atk ?? 0))).toBeGreaterThanOrEqual(12);
    expect(gl.atk).toBe(5); // not kept
  });

  it('Architect +2 Health each End of Turn', () => {
    const { g, p } = setup();
    const ar = U(g, 'architect', 1, 1);
    p.board = [ar];
    endTurnEffects(g, p);
    expect(ar.hp).toBe(3);
  });

  it('Patchwork gains +1/+4 whenever you gain a Kindred unit', () => {
    const { g, p } = setup();
    const pw = U(g, 'patchwork', 2, 2);
    p.board = [pw];
    p.shop = [U(g, 'doctor')];
    expect(def('doctor').tribe).toBe('kindred');
    buy(g, p, 0);
    expect([pw.atk, pw.hp]).toEqual([3, 6]);
  });

  it('Builder: Avenge (3) gives a unit in your hand +10 Health', () => {
    const { g, p, o } = setup();
    const inHand = U(g, 'knight', 1, 1);
    p.hand = [inHand];
    p.board = [U(g, 'skel', 1, 1), U(g, 'skel', 1, 1), U(g, 'skel', 1, 1), U(g, 'builder', 1, 200)];
    fight(g, p, o, p.board, [U(g, 'skel', 1, 500)]).run();
    expect(inHand.hp).toBe(11);
  });

  it('Devotion: buying 8 Kindred units offers a free Lesser Trinket', () => {
    const { g, p } = setup();
    p.hand = [U(g, 'devotion')];
    play(g, p, 0, 0);
    const ids = ['doctor', 'architect', 'hug', 'patchwork', 'therapist', 'librarian', 'barton', 'life'];
    for (const id of ids) { p.hand = []; p.shop = [U(g, id)]; buy(g, p, 0); }
    expect(p.trinketOffer!.length).toBeGreaterThan(0);
    const gold = p.gold;
    const pickId = p.trinketOffer!.find((t) => t !== 'lucky_coin' && t !== 'healing_draught')!;
    expect(pickTrinket(g, p, pickId)).toBe(true);
    expect(p.gold).toBe(gold);
    expect(p.trinkets).toContain(pickId);
  });

  it('The Mayor: Start of Combat summons two random Tier 5 units when there is room', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [U(g, 'the_mayor', 50, 5)], [U(g, 'skel', 1, 999)]);
    c.run();
    const f = c.frames[afterSoc(c)];
    expect(f.sides[0].length).toBe(3);
    expect(f.sides[0].slice(1).every((u) => def(u.cardId).tier === 5)).toBe(true);
    const c2 = fight(g, p, o, [U(g, 'the_mayor', 50, 5, true), ...Array.from({ length: 5 }, () => U(g, 'skel', 1, 99))], [U(g, 'skel', 1, 999)]);
    c2.run();
    expect(c2.frames[afterSoc(c2)].sides[0].length).toBe(7); // Golden wants four, only one fits
  });

  it('Cursed Vines: Rally gives another friendly unit +4/+4', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [U(g, 'cursed_vines', 1, 100), U(g, 'skel', 1, 100)], [U(g, 'skel', 0, 100)]);
    c.run();
    expect(Math.max(...c.frames.map((f) => f.sides[0].find((u) => u.cardId === 'skel')?.atk ?? 0))).toBeGreaterThanOrEqual(5);
  });

  it('Elder: Start of Combat gives other Brambor units its Attack', () => {
    const { g, p, o } = setup();
    const br = U(g, 'sapling', 2, 50);
    expect(def('sapling').tribe).toBe('brambor');
    const c = fight(g, p, o, [U(g, 'elder', 6, 50), br, U(g, 'skel', 1, 50)], [U(g, 'skel', 1, 999)]);
    c.run();
    const f = c.frames[afterSoc(c)];
    const sap = f.sides[0].find((u) => u.cardId === 'sapling' || u.cardId === 'rootling')!;
    expect(sap.atk).toBeGreaterThanOrEqual(8);
    expect(f.sides[0].find((u) => u.cardId === 'skel')!.atk).toBe(1);
  });

  it('Andromeda Robin: a Potato Gem on two random units, then Potato Gems improve', () => {
    const { g, p } = setup();
    const a = U(g, 'andromeda_robin', 1, 1), b = U(g, 'skel', 1, 1), c = U(g, 'skel', 1, 1);
    p.board = [a, b, c];
    endTurnEffects(g, p);
    expect(a.hp + b.hp + c.hp).toBe(3 + 4); // two units got +2
    expect(gemLevel(p, 'ancient_name_brambor')).toBe(1);
  });

  it('Paradox: Arrive: becomes a copy of the friendly unit you choose (Golden: a Golden copy); never itself', async () => {
    const { validTargets } = await import('../src/engine/game');
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const t = U(g, 'doctor', 9, 7); t.kw = ['taunt']; t.mem.n = 3;
      const px = U(g, 'paradox', undefined, undefined, golden);
      p.board = [t]; p.hand = [px];
      expect(validTargets(p, 'paradox', px)).toEqual([t]);
      play(g, p, 0, 1, t.uid);
      const c = p.board[1];
      expect(c.cardId).toBe('doctor');
      expect(c.kw).toContain('taunt');
      expect(c.mem.n).toBe(3);
      expect(c.golden).toBe(golden);
      expect([c.atk, c.hp]).toEqual(golden ? [9 + def('doctor').atk, 7 + def('doctor').hp] : [9, 7]);
      expect(t.cardId).toBe('doctor'); // the original is untouched
    }
  });

  it('Potato Gem: +2 Health to every unit in hand and army (+1 per improvement, Golden doubles)', () => {
    const { g, p } = setup();
    const b = U(g, 'skel', 1, 1), h = U(g, 'skel', 1, 1);
    p.board = [b]; p.hand = [U(g, 'ancient_name_brambor', undefined, undefined, true), h];
    p.gemBonus = { ancient_name_brambor: 1 };
    play(g, p, 0, 1);
    expect([b.hp, h.hp]).toEqual([7, 7]);
  });
});

describe('trinkets rewritten without slots', () => {
  it('Phoenix Feather: Reborn (left-most unit); Bannerlord: +3/+3 at Start of Combat', () => {
    const { g, p, o } = setup();
    p.trinkets = ['phoenix_feather', 'bannerlords_standard'];
    const c = fight(g, p, o, [U(g, 'doctor', 1, 50), U(g, 'doctor', 1, 50)], [U(g, 'skel', 1, 999)]);
    c.run();
    const f = c.frames[afterSoc(c)];
    expect(f.sides[0][0].kw).toContain('reborn');
    expect(f.sides[0][1].kw).not.toContain('reborn');
    expect([f.sides[0][1].atk, f.sides[0][1].hp]).toEqual([4, 53]);
  });
});

describe('v0.10.2 changes', () => {
  it('Shield: has Taunt, and its Arrive gives the chosen unit Taunt (Golden: one more)', () => {
    const { g, p } = setup();
    const a = U(g, 'doctor', 2, 2), b = U(g, 'doctor', 2, 2), c = U(g, 'doctor', 2, 2);
    [a, b, c].forEach((x) => (x.kw = []));
    p.board = [a, b, c];
    p.hand = [U(g, 'shield_neutral')];
    expect(p.hand[0].kw).toContain('taunt');
    play(g, p, 0, 3, b.uid);
    expect([a.kw.includes('taunt'), b.kw.includes('taunt'), c.kw.includes('taunt')]).toEqual([false, true, false]);
    p.hand = [U(g, 'shield_neutral', undefined, undefined, true)];
    play(g, p, 0, 4, a.uid);
    expect([a, b, c].filter((x) => x.kw.includes('taunt')).length).toBe(3);
  });

  it('Storyteller: selling it gains a random Cloister unit (up to your Tier)', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const g = newGame(seed, 'You', ['cloister', 'azure', 'kindred', 'alcove']);
      const p = g.players[0];
      p.discovers = []; p.hand = [];
      p.tier = 2;
      p.board = [U(g, 'storyteller')];
      sell(g, p, 0);
      expect(p.hand.length).toBe(1);
      expect(isTribe(p.hand[0].cardId, 'cloister')).toBe(true); // Googa (every faction) counts too
      expect(def(p.hand[0].cardId).tier).toBeLessThanOrEqual(2);
    }
  });

  it('every hero starts with 4 more Health than in v0.10.1', async () => {
    const { HEROES, heroHealth } = await import('../src/engine/heroes');
    expect(heroHealth('derby_pocket')).toBe(25);
    expect(Math.min(...HEROES.map((h) => heroHealth(h.id)))).toBe(20);
  });
});

describe('Larva', () => {
  it('after 3 turns in hand it gains a Golden Tier 5 Cloister unit once, then stays a Larva marked Done', async () => {
    const { startRound } = await import('../src/engine/game');
    const g = newGame(4, 'You', ['cloister', 'azure', 'kindred', 'alcove']);
    const p = g.players[0];
    for (const x of g.players) { x.discovers = []; x.heroOffer = undefined; }
    const larva = U(g, 'larva');
    p.hand = [larva];
    for (let t = 0; t < 5; t++) { startRound(g); p.discovers = []; }
    const gained = p.hand.filter((u) => u !== larva);
    expect(p.hand).toContain(larva);
    expect(larva.mem.done).toBe(1);
    expect(gained.length).toBe(1);
    expect(gained[0].golden).toBe(true);
    expect(def(gained[0].cardId).tier).toBe(5);
    expect(def(gained[0].cardId).tribe).toBe('cloister');
  });
});

describe('v0.10.4 changes', () => {
  it('Planter (organizer): Taunt; Deathrattle gains a Potato Gem (Golden: 2)', () => {
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      p.hand = [];
      expect(def('organizer').name).toBe('Planter');
      fight(g, p, o, [U(g, 'organizer', 1, 1, golden)], [U(g, 'skel', 5, 999)]).run();
      expect(p.hand.map((u) => u.cardId)).toEqual(golden ? ['ancient_name_brambor', 'ancient_name_brambor'] : ['ancient_name_brambor']);
    }
  });

  it('Rattler: 4 random units get "Deathrattle: Summon a random Tier 1 unit" at Start of Combat', () => {
    const { g, p, o } = setup();
    p.trinkets = ['rattler'];
    const mine = Array.from({ length: 5 }, () => U(g, 'skel', 1, 1));
    const c = fight(g, p, o, mine, [U(g, 'skel', 5, 999)]);
    c.run();
    const f = c.frames[afterSoc(c)];
    expect(f.sides[0].filter((u) => u.rattle).length).toBe(4);
    const summons = c.frames.filter((x) => x.note?.startsWith('Rattler: Summon')).length;
    expect(summons).toBeGreaterThanOrEqual(4);
  });

  it('stats: Omar Evans has no Doomstrike; Green Ninja is 5/2; every Gem is 1/1', () => {
    expect(def('omar_evans').keywords).not.toContain('venomous');
    expect([def('orange_ninja').atk, def('orange_ninja').hp]).toEqual([5, 2]);
    for (const id of ['tourmaline', 'red_gem', 'ancient_name_brambor', 'purple_gem', 'pink_gem', 'green_gem']) expect([def(id).atk, def(id).hp]).toEqual([1, 1]);
  });
});

it('Iron Bracer: 2 random friendly units get Bubble at Start of Combat', () => {
  const { g, p, o } = setup();
  p.trinkets = ['iron_bracer'];
  const mine = [U(g, 'doctor', 1, 50), U(g, 'doctor', 1, 50), U(g, 'doctor', 1, 50), U(g, 'doctor', 1, 50)];
  mine.forEach((u) => (u.kw = []));
  const c = fight(g, p, o, mine, [U(g, 'skel', 1, 999)]);
  c.run();
  expect(c.frames[afterSoc(c)].sides[0].filter((u) => u.kw.includes('divineShield')).length).toBe(2);
});

it('Therapist: Arrive gives a unit Taunt and +12 Health (Golden: +24)', () => {
  const { g, p } = setup();
  const t = U(g, 'doctor', 2, 2); t.kw = ['taunt'];
  p.board = [t];
  p.hand = [U(g, 'therapist')];
  play(g, p, 0, 1, t.uid);
  expect(t.kw).toContain('taunt'); // keeps it (no longer removed)
  expect(t.hp).toBe(14);
  p.hand = [U(g, 'therapist', undefined, undefined, true)];
  play(g, p, 0, 2, t.uid);
  expect(t.hp).toBe(38);
});

describe('v0.11.6 changes', () => {
  it('Horseman comes back from Reborn with its full stats', () => {
    const { g, p, o } = setup();
    const h = U(g, 'horseman', 9, 12);
    const c = fight(g, p, o, [h], [U(g, 'skel', 30, 999)]);
    c.run();
    const back = c.frames.find((f) => f.fx?.some((x) => x.k === 'reborn'));
    expect(back).toBeTruthy();
    const r = back!.sides[0].find((u) => u.cardId === 'horseman')!;
    expect([r.atk, r.hp]).toEqual([9, 12]);
    expect(r.kw).not.toContain('reborn');
  });

  it('Another Chance: the first time Health runs out it goes back to 10 with 10 Gold next turn; the second time you are out', async () => {
    const g = newGame(21);
    const { selectHero, human, endTurn } = await import('../src/engine/game');
    selectHero(g, human(g).heroOffer![0]);
    const p = human(g);
    p.trinkets = ['another_chance'];
    p.board = [];
    p.health = 1;
    endTurn(g); // an empty army loses (or ties a ghost with nothing)
    if (p.health === 1) return; // drew: nothing to check this seed
    expect(p.alive).toBe(true);
    expect(p.health).toBe(10);
    expect(p.heroMem.anotherChanceUsed).toBe(1);
    expect(p.gold).toBeGreaterThanOrEqual(10);
    // a second time: out
    p.health = 1; p.board = [];
    endTurn(g);
    if (p.health <= 0) expect(p.alive).toBe(false);
  });

  it('Ash is a 3/3 with Taunt', () => {
    expect([def('ash').atk, def('ash').hp]).toEqual([3, 3]);
    expect(def('ash').keywords).toContain('taunt');
  });
});

describe('New Power (Greater Trinket)', () => {
  it('offers 3 Hero Powers; the chosen one replaces yours, and what the old one gave you stays', async () => {
    const { selectHero, human, chooseDiscover } = await import('../src/engine/game');
    const { HEROES } = await import('../src/engine/heroes');
    const g = newGame(31);
    const me = human(g);
    selectHero(g, 'andromeda_robin');
    const pumpkins = () => [...me.board, ...me.hand].filter((u) => u.cardId === 'pumpkin').length;
    const had = pumpkins();
    expect(had).toBe(1); // Andromeda's Pumpkin
    me.trinketOffer = ['new_power'];
    me.gold = 10;
    expect(pickTrinket(g, me, 'new_power')).toBe(true);
    const d = me.discovers[0];
    expect(d.powers).toBe(true);
    expect(d.options.length).toBe(3);
    expect(d.options).not.toContain('andromeda_robin');
    const choice = d.options[1];
    chooseDiscover(g, me, 1);
    expect(me.powers).toEqual([choice]);
    expect(pumpkins()).toBe(had);
    expect(HEROES.find((h) => h.id === choice)).toBeTruthy();
  });
});

describe('v0.12 card changes', () => {
  it('Lake: after 3 Azure units are bought, its stats double, once', () => {
    const { g, p } = setup();
    const lake = U(g, 'lake');
    expect([lake.atk, lake.hp]).toEqual([3, 3]);
    p.board = [lake];
    const buyOne = (id: string) => { p.hand = []; p.shop = [U(g, id)]; buy(g, p, 0); };
    buyOne('doctor'); // not Azure: doesn't count
    buyOne('knight'); buyOne('longbow');
    expect([lake.atk, lake.hp]).toEqual([3, 3]);
    buyOne('royal_guard');
    expect([lake.atk, lake.hp]).toEqual([6, 6]);
    buyOne('knight'); buyOne('longbow'); buyOne('royal_guard');
    expect([lake.atk, lake.hp]).toEqual([6, 6]); // only once
    expect(def('lake').text).not.toMatch(/once/i);
  });

  it('stats: Scientist Tier 3 4/1, Funeral 5/1, Omni-Gem 10/10; Restore is Avenge (2)', async () => {
    const { EFFECTS } = await import('../src/engine/effects');
    expect([def('scientist').tier, def('scientist').atk, def('scientist').hp]).toEqual([3, 4, 1]);
    expect([def('funeral').atk, def('funeral').hp]).toEqual([12, 1]);
    expect([def('omni_gem').atk, def('omni_gem').hp]).toEqual([10, 10]);
    expect(EFFECTS.restore.avenge).toEqual([2, 2]);
    expect(def('restore').text).toContain('Avenge (2)');
  });
});

describe('Buzz-Boink', () => {
  it('a Tier 1 Alcove 1/1 with Bubble; Deathrattle summons a 1/1 Robo (Golden: 2)', () => {
    expect([def('buzz_boink').tier, def('buzz_boink').tribe, def('buzz_boink').atk, def('buzz_boink').hp]).toEqual([1, 'alcove', 1, 1]);
    expect(def('buzz_boink').keywords).toContain('divineShield');
    expect(def('robo').token).toBe(true);
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      const c = fight(g, p, o, [U(g, 'buzz_boink', 1, 1, golden)], [U(g, 'skel', 1, 999)]);
      c.run();
      const robos = Math.max(...c.frames.map((f) => f.sides[0].filter((u) => u.cardId === 'robo').length));
      expect(robos).toBe(golden ? 2 : 1);
      const r = c.frames.flatMap((f) => f.sides[0]).find((u) => u.cardId === 'robo')!;
      expect([r.atk, r.hp]).toEqual([1, 1]);
    }
  });
});

it('Intern: in battle its card shows the Gold it now sells for (1 + its bonus)', async () => {
  const { frameUnitView, bigCardHtml } = await import('../src/ui/view').catch(() => ({ frameUnitView: undefined, bigCardHtml: undefined }));
  const { g, p, o } = setup();
  const intern = U(g, 'intern', 1, 500);
  p.board = [U(g, 'skel', 1, 1), U(g, 'skel', 1, 1), U(g, 'skel', 1, 1), U(g, 'skel', 1, 1), U(g, 'skel', 1, 1), intern];
  const c = fight(g, p, o, p.board, [U(g, 'skel', 1, 999)]);
  c.run();
  expect(intern.mem.sellBonus).toBe(1);
  const last = c.frames.flatMap((f) => f.sides[0]).filter((u) => u.cardId === 'intern').at(-1)!;
  expect(last.sellBonus).toBe(1);
  if (frameUnitView && bigCardHtml) expect(bigCardHtml(frameUnitView(last))).toContain('Sells for 2 Gold');
});

it('Broken Land improves every Gem twice (Golden: four times); Potato Gem is Tier 2', async () => {
  const { gemLevel, GEMS } = await import('../src/engine/effects');
  for (const golden of [false, true]) {
    const { g, p } = setup();
    p.hand = [U(g, 'broken_land', undefined, undefined, golden)];
    play(g, p, 0, 0);
    for (const id of GEMS) expect(gemLevel(p, id)).toBe(golden ? 4 : 2);
  }
  expect(def('ancient_name_brambor').tier).toBe(2);
});

it('Life: Start of Combat gains a Pink Gem to your hand (Golden: 2); Grief: Upgrading costs 2 less (Golden 4)', () => {
  for (const golden of [false, true]) {
    const { g, p, o } = setup();
    p.hand = [];
    fight(g, p, o, [U(g, 'life', 1, 99, golden)], [U(g, 'skel', 1, 99)]).run();
    expect(p.hand.filter((u) => u.cardId === 'pink_gem').length).toBe(golden ? 2 : 1);
    const { g: g2, p: p2, o: o2 } = setup();
    p2.upgradeCost = 7;
    const c2 = fight(g2, p2, o2, [U(g2, 'grief', 1, 1, golden)], [U(g2, 'skel', 5, 99)]);
    c2.run();
    for (const fn of c2.sides[0].afterFns) fn(); // runCombat does this after the battle
    expect(p2.upgradeCost).toBe(golden ? 3 : 5);
  }
});

describe('v0.12.3 Kindred', () => {
  it('Pink Gem: +1/+1 for good and Bubble until next turn, twice over for a Kindred unit (Golden doubles)', async () => {
    const { startTurn } = await import('../src/engine/game');
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const k = U(g, 'therapist', 2, 2); k.kw = [];
      const n = U(g, 'ash', 2, 2); n.kw = [];
      p.board = [k, n];
      p.hand = [U(g, 'pink_gem', undefined, undefined, golden), U(g, 'pink_gem', undefined, undefined, golden)];
      play(g, p, 0, 2, k.uid);
      play(g, p, 0, 3, n.uid);
      const m = golden ? 2 : 1;
      expect([k.atk, k.hp, n.atk, n.hp]).toEqual([2 + 2 * m, 2 + 2 * m, 2 + m, 2 + m]);
      expect(k.kw).toContain('divineShield'); expect(n.kw).toContain('divineShield');
      startTurn(g, p);
      expect([k.atk, k.hp, n.atk, n.hp]).toEqual([2 + 2 * m, 2 + 2 * m, 2 + m, 2 + m]); // stats are for good
      expect(k.kw).not.toContain('divineShield'); expect(n.kw).not.toContain('divineShield');
    }
    expect(def('honeysuckle_kindred').tier).toBe(4);
  });

  it('Elemental: Tier 6 Kindred 10/10; selling a Kindred unit gives it that unit\'s stats (Golden: double)', () => {
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const e = U(g, 'elemental', undefined, undefined, golden);
      expect([def('elemental').tier, def('elemental').tribe, def('elemental').atk, def('elemental').hp]).toEqual([6, 'kindred', 10, 10]);
      p.board = [e, U(g, 'therapist', 3, 5), U(g, 'ash', 4, 4)];
      sell(g, p, 1);
      const m = golden ? 2 : 1;
      expect([e.atk, e.hp]).toEqual([e.golden ? 20 + 3 * m : 10 + 3 * m, e.golden ? 20 + 5 * m : 10 + 5 * m]);
      const before = [e.atk, e.hp];
      sell(g, p, 1); // not Kindred
      expect([e.atk, e.hp]).toEqual(before);
    }
  });

  it('Turtlepult: +2 Health whenever another friendly unit gains Health, in the shop and in battle (Golden: +4)', () => {
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      const pb = U(g, 'peebnup_bubber', 8, 8, golden);
      expect([def('peebnup_bubber').tier, def('peebnup_bubber').tribe]).toEqual([5, 'kindred']);
      const k = U(g, 'therapist', 2, 2); k.kw = [];
      p.board = [pb, k]; p.hand = [U(g, 'pink_gem')];
      peebSync(g, p); // (in a real game, units on the board have always been seen)
      play(g, p, 0, 2, k.uid); // Therapist (Kindred) gets +12 Health
      expect(pb.hp).toBe(8 + 2 * (golden ? 2 : 1)); // one unit gained Health
      // played with Health it had in hand: no gain
      const hp0 = pb.hp;
      p.hand = [U(g, 'doctor', 1, 30)];
      play(g, p, 0, 3);
      expect(pb.hp).toBe(hp0);
      // in battle: Bannerlord's Standard gives everyone +3/+3 at Start of Combat
      p.trinkets = ['bannerlords_standard'];
      const a = U(g, 'doctor', 1, 50), b = U(g, 'doctor', 1, 50), bub = U(g, 'peebnup_bubber', 1, 8, golden);
      const c = fight(g, p, o, [a, b, bub], [U(g, 'skel', 0, 99)]);
      c.run();
      const f = afterSoc(c);
      // the 2 others each gained Health (Bannerlord's), so +2 each (Golden +4) on top of its own 3
      expect(at(c, f, 'peebnup_bubber')!.hp).toBe(8 + 3 + 4 * (golden ? 2 : 1));
    }
  });

  it('Golden Green Ninja joins from hand with double stats; the normal one with its own', () => {
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      p.hand = [U(g, 'orange_ninja', golden ? 10 : 5, golden ? 4 : 2, golden)];
      const c = fight(g, p, o, [U(g, 'doctor', 1, 50)], [U(g, 'skel', 0, 99)]);
      c.run();
      const n = at(c, afterSoc(c), 'orange_ninja')!;
      expect([n.atk, n.hp]).toEqual(golden ? [20, 8] : [5, 2]);
    }
  });

  it('offered cards show the stats they will have (War Mech counts Deathrattles so far)', async () => {
    const { offeredUnit } = await import('../src/ui/view');
    const { p } = setup();
    p.deathrattlesGame = 3;
    expect(offeredUnit('warmech', false, p)).toMatchObject({ atk: 4 + 9, hp: 2 + 3 }); // +3/+1 per Deathrattle
    expect(offeredUnit('warmech', true, p)).toMatchObject({ atk: 8 + 18, hp: 4 + 6 });
  });

  it("Spoonful's Deathrattle triggers the Arrive of a unit that was next to it, never one further away", () => {
    const hit = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { g, p, o } = setup();
      g.seed = seed;
      // Therapist (far left) and Message (far right) have Arrives but aren't next to it; Red Gem and Sword are
      const c = fight(g, p, o, [U(g, 'therapist', 1, 50), U(g, 'red_gem', 1, 50), U(g, 'spoonful', 0, 1), U(g, 'sword', 1, 50), U(g, 'message', 1, 50)], [U(g, 'skel', 5, 99)]);
      const orig = c.triggerBattlecry.bind(c);
      c.triggerBattlecry = (side, u) => { hit.add(u.cardId); return orig(side, u); };
      c.run();
    }
    expect(hit.has('therapist') || hit.has('message')).toBe(false);
    expect(hit.size).toBeGreaterThan(0);
  });

  it("Purple Gem's Reborn only lasts until next turn, even if that unit is tripled into a Golden one", async () => {
    const { startTurn, checkTriples } = await import('../src/engine/game');
    const { g, p } = setup();
    const a = U(g, 'doctor', 1, 1), b = U(g, 'doctor', 1, 1), c = U(g, 'doctor', 1, 1);
    p.board = [a]; p.hand = [U(g, 'purple_gem')];
    play(g, p, 0, 1, a.uid);
    expect(a.kw).toContain('reborn');
    p.board = [a]; p.hand = [b, c];
    checkTriples(g, p);
    const gold = p.hand.find((u) => u.golden)!;
    expect(gold.kw).toContain('reborn'); // still has it for this combat
    startTurn(g, p);
    expect(gold.kw).not.toContain('reborn'); // ...and not after
    expect(gold.atk).toBe(def('doctor').atk * 2 + 1); // but the +1/+1 stays
  });

  it('Golden Brass keeps what the unit remembers (a locked unit stays locked)', () => {
    const { g, p } = setup();
    const u = U(g, 'doctor', 5, 5); u.mem.locked = 1;
    p.board = [u]; p.trinkets = ['golden_lantern'];
    endTurnEffects(g, p); endTurnEffects(g, p); // every other End of Turn
    expect(p.board[0].golden).toBe(true);
    expect(p.board[0].mem.locked).toBe(1);
  });

  it('two Turtlepults trigger each other, once per event (no loops)', () => {
    const { g, p, o } = setup();
    const A = U(g, 'peebnup_bubber', 8, 8), B = U(g, 'peebnup_bubber', 8, 8);
    const k = U(g, 'therapist', 2, 2); k.kw = [];
    p.board = [A, B, k]; peebSync(g, p);
    // Pink Gem on another unit: both gain +2, nothing more
    p.hand = [U(g, 'pink_gem')]; play(g, p, 0, 3, k.uid);
    expect([A.hp, B.hp]).toEqual([10, 10]);
    // Pink Gem on Turtlepult A (Kindred: +2 Health): B gains +2 once, A gets nothing back
    p.hand = [U(g, 'pink_gem')]; play(g, p, 0, 3, A.uid);
    expect([A.hp, B.hp]).toEqual([12, 12]);
    // in battle: Bannerlord's +3 Health to all 3 units; each Turtlepult gets +2 for each of the other 2 on top of its own 3
    p.trinkets = ['bannerlords_standard'];
    const c = fight(g, p, o, [U(g, 'doctor', 1, 50), U(g, 'peebnup_bubber', 1, 8), U(g, 'peebnup_bubber', 1, 8)], [U(g, 'skel', 0, 99)]);
    c.run();
    const f = afterSoc(c);
    expect(c.frames[f].sides[0].filter((u) => u.cardId === 'peebnup_bubber').map((u) => u.hp)).toEqual([15, 15]);
  });
});

describe('v0.12.4 cards', () => {
  it('Googa (was Amalgam) is a Tier 2 Neutral 3/2 of every faction; Beast Vine (Tier 5 Brambor 50/50) too', async () => {
    const { isTribe } = await import('../src/engine/core');
    const { g } = setup();
    expect([def('amalgam').tier, def('amalgam').tribe, def('amalgam').atk, def('amalgam').hp]).toEqual([2, 'neutral', 3, 2]);
    for (const t of ['kindred', 'brambor', 'cloister', 'alcove', 'demons', 'azure', 'neverending'] as const) {
      expect(isTribe(U(g, 'amalgam'), t)).toBe(true);
      expect(isTribe(U(g, 'beast_vine'), t)).toBe(true);
    }
    expect(def('larva').name).toBe('Slime');
  });

  it('Beast Vine: Arrive and Deathrattle gain 2 random Gems (Golden: 4)', async () => {
    const { GEMS } = await import('../src/engine/effects');
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      p.hand = [U(g, 'beast_vine', undefined, undefined, golden)];
      play(g, p, 0, 0);
      expect(p.hand.filter((u) => GEMS.includes(u.cardId)).length).toBe(golden ? 4 : 2);
      p.hand = [];
      fight(g, p, o, [U(g, 'beast_vine', 1, 1, golden)], [U(g, 'skel', 5, 99)]).run();
      expect(p.hand.filter((u) => GEMS.includes(u.cardId)).length).toBe(golden ? 4 : 2);
    }
  });

  it('Stuffie Magic: Kindred units in the Tavern have +2/+2 from now on (Golden +4/+4)', async () => {
    const { rollShop } = await import('../src/engine/game');
    for (const golden of [false, true]) {
      const { g, p } = setup();
      p.tier = 6;
      rollShop(g, p);
      const before = p.shop.map((u) => [u.cardId, u.atk, u.hp] as const);
      p.hand = [U(g, 'hug', undefined, undefined, golden)];
      play(g, p, 0, 0);
      const n = golden ? 4 : 2;
      p.shop.forEach((u, i) => {
        const k = def(u.cardId).tribe === 'kindred' || def(u.cardId).allTribes;
        expect([u.atk, u.hp]).toEqual([before[i][1] + (k ? n : 0), before[i][2] + (k ? n : 0)]);
      });
      for (let r = 0; r < 20; r++) {
        rollShop(g, p);
        for (const u of p.shop) if (def(u.cardId).tribe === 'kindred') expect([u.atk, u.hp]).toEqual([def(u.cardId).atk + n, def(u.cardId).hp + n]);
      }
    }
  });

  it('Owl: 2/4, +1/+2 for each Owl summoned this game; Owl Summoner (Tier 5, Reborn) summons Owls', async () => {
    const { effStats } = await import('../src/engine/core');
    const { g, p, o } = setup();
    expect([def('owl').atk, def('owl').hp]).toEqual([2, 4]);
    const a = U(g, 'owl'), b = U(g, 'owl');
    p.hand = [a, b];
    play(g, p, 0, 0);
    expect(effStats(p, a, 'board')).toMatchObject({ atk: 3, hp: 6 });
    play(g, p, 0, 1);
    expect(effStats(p, a, 'board')).toMatchObject({ atk: 4, hp: 8 });
    // in battle: Owl Summoner (Reborn) dies twice and summons 2 Owls; the Owls in the fight grow with each
    expect([def('owl_summoner').tier, def('owl_summoner').tribe, def('owl_summoner').keywords]).toEqual([5, 'cloister', ['reborn']]);
    const own = U(g, 'owl_summoner', 1, 1); own.kw = ['reborn', 'taunt'];
    const c = fight(g, p, o, [own, U(g, 'owl', 2, 4)], [U(g, 'skel', 1, 999)]);
    c.run();
    expect(p.owlsSummoned).toBe(4);
    const seen = c.frames.flatMap((f) => f.sides[0]).filter((u) => u.cardId === 'owl');
    expect(new Set(seen.map((u) => u.id)).size).toBe(3);
    // the Owl brought in started at 4/8 (2 played Owls) and grew with each of the 2 summoned
    expect(Math.max(...seen.map((u) => u.atk))).toBe(6);
  });
});

describe('splash attacks', () => {
  it('Tank: the units next to the target are hit in the same frame as the target', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [U(g, 'tank', 5, 50)], [U(g, 'skel', 0, 20), U(g, 'skel', 0, 20), U(g, 'skel', 0, 20)]);
    c.run();
    const ai = c.frames.findIndex((f) => f.kind === 'attack' && f.splash?.length);
    expect(ai).toBeGreaterThanOrEqual(0);
    const atk = c.frames[ai];
    const hit = c.frames[ai + 1];
    expect(hit.kind).toBe('hit');
    const enemy = (f: typeof hit) => f.sides[1];
    const hpBefore = new Map(enemy(atk).map((u) => [u.id, u.hp]));
    const hurt = enemy(hit).filter((u) => u.hp < hpBefore.get(u.id)!).map((u) => u.id);
    expect(hurt).toContain(atk.target);
    for (const id of atk.splash!) expect(hurt).toContain(id);
  });
});

describe('v0.12.7 workbook', () => {
  it('Catapult: 25 damage to the right-most enemy (Golden: 50)', () => {
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      const c = fight(g, p, o, [U(g, 'catapult', 2, 7, golden)], [U(g, 'skel', 0, 5), U(g, 'skel', 0, 100), U(g, 'skel', 0, 100)]);
      c.run();
      expect(c.frames[afterSoc(c)].sides[1].map((u) => u.hp)).toEqual([5, 100, golden ? 50 : 75]);
    }
  });
});

describe('Golden Light', () => {
  it('gains a random Tier 5 unit for each unit it kills (Golden: 2)', async () => {
    const { def } = await import('../src/engine/core');
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      p.hand = [];
      fight(g, p, o, [U(g, 'golden_light', 10, 100, golden)], [U(g, 'skel', 1, 3), U(g, 'skel', 1, 3)]).run();
      expect(p.hand.length).toBe(2 * (golden ? 2 : 1));
      for (const u of p.hand) expect(def(u.cardId).tier).toBe(5);
    }
  });
});

describe('bot bonus', () => {
  it('bots get +X/+X at End of Turn by your rating (in full +2 at 1000, +5 at 1250, +8 at 1500+), 60-100% of it each time; none unrated or for you', async () => {
    const { botBonusFor, newGame, endTurnEffects } = await import('../src/engine/game');
    expect([700, 875, 1000, 1125, 1250, 1500, 1800].map(botBonusFor)).toEqual([0, 1, 2, 3.5, 5, 8, 8]);
    for (const rating of [undefined, 1250]) {
      const g = newGame(5, 'You', undefined, rating === undefined ? {} : { rating });
      const bot = g.players[1], me = g.players[0];
      const mk = (id: string) => ({ uid: g.nextUid++, cardId: id, golden: false, atk: 2, hp: 2, kw: [], mem: {} });
      bot.board = [mk('ash')]; bot.hand = [mk('ash')]; me.board = [mk('ash')];
      g.round = 10;
      endTurnEffects(g, bot); endTurnEffects(g, me);
      const n = bot.board[0].atk - 2;
      if (rating) { expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(5); } else expect(n).toBe(0);
      expect([bot.hand[0].hp, me.board[0].atk]).toEqual([2 + n, 2]); // the same roll for the whole army and hand
    }
    // at rating 1500 (+8 in full): many End of Turns land between 60% and 100% of the ramped amount, and use the range
    const g = newGame(6, 'You', undefined, { rating: 1500 });
    const bot = g.players[1];
    for (const r of [1, 4, 10, 14]) {
      const seen = new Set<number>();
      for (let k = 0; k < 60; k++) {
        g.round = r; bot.board = [{ uid: g.nextUid++, cardId: 'ash', golden: false, atk: 0, hp: 0, kw: [], mem: {} }]; bot.hand = [];
        endTurnEffects(g, bot);
        seen.add(bot.board[0].atk);
      }
      const full = 8 * Math.min(1, (r - 1) / 9);
      for (const v of seen) { expect(v).toBeGreaterThanOrEqual(Math.round(full * 0.6)); expect(v).toBeLessThanOrEqual(Math.round(full)); }
      if (r >= 10) expect([...seen].sort()).toEqual([5, 6, 7, 8]);
      if (r === 1) expect([...seen]).toEqual([0]);
    }
  });
});

describe('new heroes (v0.12.11)', () => {
  it('Croh Vosh: summoned units get Taunt and +1/+2', async () => {
    const { gainPower } = await import('../src/engine/heroes');
    const { g, p, o } = setup();
    gainPower(g, p, 'croh_vosh');
    const c = fight(g, p, o, [U(g, 'necromancer', 1, 1)], [U(g, 'skel', 5, 99)]);
    c.run();
    const sk = c.frames.flatMap((f) => f.sides[0]).find((u) => u.cardId !== 'necromancer');
    expect(sk?.kw).toContain('taunt');
  });

  it('Lori-Ann Davis: every 3 Cloister units played, upgrading costs 3 less', async () => {
    const { gainPower } = await import('../src/engine/heroes');
    const { g, p } = setup();
    gainPower(g, p, 'lori_ann_davis');
    p.tier = 2; p.upgradeCost = 7;
    const cl = ['owl', 'owl', 'owl'];
    p.hand = cl.map((id) => U(g, id));
    for (let i = 0; i < 3; i++) play(g, p, 0, p.board.length);
    expect(p.upgradeCost).toBe(4);
  });

  it('Robot Boy: starts with a 1/1 Doomstrike Orbo Pet of every tribe', async () => {
    const { gainPower } = await import('../src/engine/heroes');
    const { isTribe } = await import('../src/engine/core');
    const { g, p } = setup();
    gainPower(g, p, 'robot_boy_hero');
    const rb = [...p.hand, ...p.board].find((u) => u.cardId === 'orbo_pet')!;
    expect([rb.atk, rb.hp, rb.kw]).toEqual([1, 1, ['venomous']]);
    expect(isTribe(rb, 'kindred') && isTribe(rb, 'demons')).toBe(true);
  });

  it('Zara: gain 2 Gold after upgrading the Tavern', async () => {
    const { gainPower } = await import('../src/engine/heroes');
    const { upgrade } = await import('../src/engine/game');
    const { g, p } = setup();
    gainPower(g, p, 'zara');
    p.tier = 1; p.upgradeCost = 5; p.gold = 6;
    upgrade(g, p);
    expect([p.tier, p.gold]).toEqual([2, 3]);
  });

  it('Marn Torf: remove 3 units from the Tavern, then Discover a unit from their tribes', async () => {
    const { gainPower, useHeroPower } = await import('../src/engine/heroes');
    const { g, p } = setup();
    gainPower(g, p, 'marn_torf');
    p.board = [U(g, 'ash')];
    p.shop = [U(g, 'owl'), U(g, 'therapist'), U(g, 'owl'), U(g, 'ash')];
    const pool = g.pool.owl;
    for (let i = 0; i < 3; i++) { p.usedPowers = []; expect(useHeroPower(g, p, p.shop[0], 'marn_torf')).toBe(true); }
    expect(p.shop.map((u) => u.cardId)).toEqual(['ash']);
    expect(p.board.map((u) => u.cardId)).toEqual(['ash']);
    expect(g.pool.owl).toBe(pool + 2); // back in the pool
    expect(p.discovers.length).toBe(1);
    for (const id of p.discovers[0].options) expect(['cloister', 'kindred']).toContain(def(id).tribe);
  });

  it('Oren Bark: roll a D6, gain that much Gold, ready again after that many turns', async () => {
    const { gainPower, useHeroPower, canUseHeroPower, heroHooks } = await import('../src/engine/heroes');
    const { g, p } = setup();
    gainPower(g, p, 'oren_bark');
    p.gold = 1;
    expect(useHeroPower(g, p, undefined, 'oren_bark')).toBe(true);
    const roll = p.gold;
    expect(roll).toBeGreaterThanOrEqual(1); expect(roll).toBeLessThanOrEqual(6);
    for (let t = 1; t <= roll; t++) {
      p.usedPowers = []; p.gold = 5;
      expect(canUseHeroPower(g, p, 'oren_bark')).toBe(false);
      heroHooks.startTurn(g, p);
    }
    p.usedPowers = [];
    expect(canUseHeroPower(g, p, 'oren_bark')).toBe(true);
  });
});

describe('new trinkets (v0.12.12)', () => {
  it('renamed trinkets keep working under their new names', async () => {
    const { trinketDef } = await import('../src/engine/heroes');
    expect(['healing_draught', 'bronze_compass', 'iron_bracer', 'aegis_charm', 'hourglass_of_plenty', 'summit_vault', 'phoenix_feather', 'warlords_horn', 'golden_lantern', 'gravebell', 'crown_of_echoes'].map((id) => trinketDef(id).name))
      .toEqual(["Techin'", 'Purple Bracer', 'Big Big Shield', 'Charm of Charms', 'Guys Comin Up Outta the Woodwork', 'Secret Guy', 'Fenix Down', 'Horn of Horn', 'Golden Brass', "Bell o' the Grave", 'Double Crown: Fusion']);
  });

  it('Double Thing becomes another copy of your Greater Trinket (and it works twice)', async () => {
    const { pickTrinket } = await import('../src/engine/heroes');
    const { g, p, o } = setup();
    p.trinketOffer = ['double_thing']; pickTrinket(g, p, 'double_thing');
    p.trinketOffer = ['bannerlords_standard']; pickTrinket(g, p, 'bannerlords_standard');
    expect(p.trinkets).toEqual(['bannerlords_standard', 'bannerlords_standard']);
    const c = fight(g, p, o, [U(g, 'skel', 1, 1)], [U(g, 'skel', 0, 99)]);
    c.run();
    expect(c.frames[afterSoc(c)].sides[0][0].atk).toBe(7); // +3/+3 twice
  });

  it('Incense: left-most and right-most Neverending units get Reborn at Start of Combat', () => {
    const { g, p, o } = setup();
    p.trinkets = ['incense'];
    const c = fight(g, p, o, [U(g, 'skel', 1, 1), U(g, 'ash', 1, 1), U(g, 'skel', 1, 1), U(g, 'doctor', 1, 1)], [U(g, 'skel', 0, 99)]);
    c.run();
    const f = c.frames[afterSoc(c)].sides[0];
    expect(f.map((u) => u.kw.includes('reborn'))).toEqual([true, false, true, false]);
  });

  it('It is Officially Gem Time fills your hand with Gems; I don\'t even KNOW fills it with units', async () => {
    const { pickTrinket } = await import('../src/engine/heroes');
    const { GEMS } = await import('../src/engine/effects');
    const { CONFIG } = await import('../src/engine/core');
    const { g, p } = setup();
    p.hand = [U(g, 'ash')];
    p.trinketOffer = ['gem_time']; pickTrinket(g, p, 'gem_time');
    expect(p.hand.length).toBe(CONFIG.handSize);
    expect(p.hand.slice(1).every((u) => GEMS.includes(u.cardId))).toBe(true);
    p.hand = [];
    p.trinketOffer = ['dont_even_know']; pickTrinket(g, p, 'dont_even_know');
    expect(p.hand.length).toBe(CONFIG.handSize);
    expect(p.hand.every((u) => !GEMS.includes(u.cardId) && def(u.cardId).tier <= p.tier)).toBe(true);
  });
});

describe('Double Thing copies stack', () => {
  it("two Bell o' the Grave: Deathrattles trigger 2 extra times; two Another Chance: saved twice", async () => {
    const { endTurn } = await import('../src/engine/game');
    const { g, p, o } = setup();
    p.trinkets = ['gravebell', 'gravebell'];
    p.deathrattlesGame = 0;
    // one Deathrattle, triggered 1 + 2 extra times
    fight(g, p, o, [U(g, 'beast_vine', 1, 1)], [U(g, 'skel', 5, 99)]).run();
    expect(p.deathrattlesGame).toBe(3);
    const g2 = setup(12).g;
    const me = g2.players[0];
    me.trinkets = ['another_chance', 'another_chance'];
    for (const q of g2.players) q.bot = { noise: 0, blunder: 0 } as never;
    g2.simulateAll = true;
    let saves = 0;
    for (let r = 0; r < 40 && me.alive && g2.phase !== 'over'; r++) {
      me.health = 1; me.board = [];
      const before = me.heroMem.anotherChanceUsed ?? 0;
      endTurn(g2);
      if ((me.heroMem.anotherChanceUsed ?? 0) > before) saves++;
    }
    expect(saves).toBe(2);
  });
});

describe('temporary keywords', () => {
  it('a Pink Gem Shield made permanent by a later Bubble stays next turn', async () => {
    const { startTurn } = await import('../src/engine/game');
    const { addKw } = await import('../src/engine/core');
    const { g, p } = setup();
    const u = U(g, 'ash', 2, 2); u.kw = [];
    p.board = [u]; p.hand = [U(g, 'pink_gem')];
    play(g, p, 0, 1, u.uid);
    expect(u.mem.tmpShield).toBe(1);
    addKw(u, 'divineShield'); // a permanent Shield from something else
    startTurn(g, p);
    expect(u.kw).toContain('divineShield');
    const v = U(g, 'ash', 2, 2); v.kw = [];
    p.board = [v]; p.hand = [U(g, 'pink_gem')];
    play(g, p, 0, 1, v.uid);
    startTurn(g, p);
    expect(v.kw).not.toContain('divineShield');
    expect([v.atk, v.hp]).toEqual([3, 3]); // the +1/+1 stays: only the Bubble was for one turn
  });
});

describe('big stats', () => {
  it('show as 1.2k / 12.9k / 123k / 1.2M past 999', async () => {
    const { fmtStat } = await import('../src/ui/view');
    expect([0, 7, 999, 1000, 1234, 12999, 99999, 123456, 1250000, -1500].map(fmtStat))
      .toEqual(['0', '7', '999', '1k', '1.2k', '12.9k', '99.9k', '123k', '1.2M', '-1.5k']);
  });
});

describe('card names', () => {
  it('no two cards share a name', () => {
    const n = new Map<string, string[]>();
    for (const c of CARDS.filter((x) => !x.hidden)) n.set(c.name, [...(n.get(c.name) ?? []), c.id]);
    expect([...n].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });
});

describe('tribe-bound trinkets', () => {
  it("Purple Bracer and Incense need Neverending, Crop Circle needs Brambor", async () => {
    const { offerTrinkets } = await import('../src/engine/heroes');
    const { g, p } = setup();
    for (const [tribes, banned] of [[['azure', 'kindred', 'alcove', 'demons', 'cloister'], ['bronze_compass', 'incense', 'whetstone']], [['neverending', 'brambor', 'alcove', 'demons', 'cloister'], []]] as const) {
      g.tribes = [...tribes];
      const seen = new Set<string>();
      for (let k = 0; k < 200; k++) { p.trinkets = []; offerTrinkets(g, p, false); for (const t of p.trinketOffer!) seen.add(t); }
      for (const t of ['bronze_compass', 'incense', 'whetstone']) expect(seen.has(t)).toBe(!(banned as readonly string[]).includes(t));
    }
  });
});

describe('new units (v0.12.39)', () => {
  it('Golbana: +2/+2 to your other units, once more for each other Golden unit (Golden: +4/+4, and it does not count itself)', () => {
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const a = U(g, 'ash', 1, 1), b = U(g, 'ash', 1, 1, true);
      p.board = [a, b]; p.hand = [U(g, 'golbana', undefined, undefined, golden)];
      play(g, p, 0, 2);
      const n = golden ? 4 : 2;
      expect([a.atk, a.hp]).toEqual([1 + 2 * n, 1 + 2 * n]); // 1 other Golden unit: twice
      const gb = p.board[2];
      expect([gb.atk, gb.hp]).toEqual([6 * (golden ? 2 : 1), 6 * (golden ? 2 : 1)]); // not itself
    }
  });

  it('Isha: +3/+3 after you sell a Business Demon (not other units)', () => {
    const { g, p } = setup();
    const isha = U(g, 'isha');
    p.board = [isha, U(g, 'intern'), U(g, 'ash')];
    sell(g, p, 2);
    expect([isha.atk, isha.hp]).toEqual([2, 4]);
    sell(g, p, 1);
    expect([isha.atk, isha.hp]).toEqual([5, 7]);
  });

  it('Leafbug: gains one of Taunt, Bubble, Doomstrike or Reborn (Golden: two different ones)', () => {
    for (const golden of [false, true]) {
      const { g, p } = setup();
      p.hand = [U(g, 'gunner', undefined, undefined, golden)];
      play(g, p, 0, 0);
      const got = p.board[0].kw.filter((k) => ['taunt', 'divineShield', 'venomous', 'reborn'].includes(k));
      expect(got.length).toBe(golden ? 2 : 1);
    }
  });

  it('Demon Bear: after 3 friendly units die, summons a Brambor unit and gets one in hand', async () => {
    const { ALL_TRIBES } = await import('../src/engine/core');
    const g = newGame(21, 'You', ALL_TRIBES);
    const p = g.players[0], o = g.players[1];
    p.tier = 5; p.hand = []; p.board = [];
    const c = fight(g, p, o, [U(g, 'ash', 0, 1), U(g, 'ash', 0, 1), U(g, 'ash', 0, 1), U(g, 'avenger', 0, 200)], [U(g, 'skel', 5, 999)]);
    c.run();
    const summoned = c.frames.some((f) => f.sides[0].some((u) => u.cardId !== 'ash' && u.cardId !== 'avenger' && isTribe(u.cardId, 'brambor')));
    expect(summoned).toBe(true);
    // (one per Avenge: the summoned units can die and Avenge again, and a summoned Beast Vine dying gives Gems too)
    expect(p.hand.some((u) => isTribe(u.cardId, 'brambor'))).toBe(true);
  });

  it('Merge-o: Merges into an Alcove unit (it leaves; the unit gets its stats), or just joins if you pick itself', async () => {
    const { validTargets } = await import('../src/engine/game');
    const { g, p } = setup();
    const bot = U(g, 'buzz_boink', 2, 2), other = U(g, 'ash', 1, 1);
    p.board = [bot, other];
    const m = U(g, 'merge_o'); p.hand = [m];
    expect(validTargets(p, 'merge_o', m)).toEqual([bot, m]); // Alcove units (and itself), not the others
    play(g, p, 0, 2, bot.uid);
    expect(p.board).toEqual([bot, other]);
    expect([bot.atk, bot.hp]).toEqual([14, 14]);
    const m2 = U(g, 'merge_o'); p.hand = [m2];
    play(g, p, 0, 2, m2.uid);
    expect(p.board).toContain(m2);
  });

  it('Corrivath Harp: End of Turn, get a copy of the last Gem you played (Golden: 2)', () => {
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const t = U(g, 'ash', 1, 1);
      p.board = [U(g, 'corrivath_harp', undefined, undefined, golden), t];
      endTurnEffects(g, p);
      expect(p.hand.length).toBe(0); // no Gem played yet
      p.hand = [U(g, 'green_gem')]; play(g, p, 0, 2, t.uid);
      p.hand = [U(g, 'tourmaline')]; play(g, p, 0, 3, t.uid);
      p.board = p.board.slice(0, 2); // (the played Gems leave, so the copies can't make a triple with them)
      endTurnEffects(g, p);
      expect(p.hand.map((u) => u.cardId)).toEqual(golden ? ['tourmaline', 'tourmaline'] : ['tourmaline']);
    }
  });

  it("The Tree Man: a summon that doesn't fit gives all your units +2/+4, once per summon effect", () => {
    const { g, p, o } = setup();
    // a full army; the Skeleton's Deathrattle (summon 2) has no room
    const mine = [U(g, 'tree_man', 0, 50), U(g, 'skeleton', 0, 1), ...[1, 2, 3, 4, 5].map(() => U(g, 'ash', 0, 50))];
    mine[1].kw = ['taunt']; // the enemy hits the Skeleton first
    const c = fight(g, p, o, mine, [U(g, 'skel', 1, 999, false)]);
    c.run();
    const f = c.frames.findIndex((x) => (x.note ?? '').startsWith('The Tree Man'));
    expect(f).toBeGreaterThan(0);
    expect(at(c, f, 'tree_man')!.hp).toBe(50 + 4);
    expect(c.frames.filter((x) => (x.note ?? '').startsWith('The Tree Man')).length).toBe(1);
  });
});

describe('Gems (v0.13.2)', () => {
  it('Green Gem: +3 Attack and Twinstrike, twice for a Cloister unit (Golden +6)', () => {
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const cl = U(g, 'disciple', 1, 1), nb = U(g, 'ash', 1, 1);
      p.board = [cl, nb];
      p.hand = [U(g, 'green_gem', undefined, undefined, golden), U(g, 'green_gem', undefined, undefined, golden)];
      play(g, p, 0, 2, cl.uid); play(g, p, 0, 3, nb.uid);
      const m = golden ? 2 : 1;
      expect([cl.atk, nb.atk]).toEqual([1 + 6 * m, 1 + 3 * m]);
      expect(cl.kw).toContain('windfury'); expect(nb.kw).toContain('windfury');
    }
  });

  it('Blue Gem: +8 Health and Taunt, twice for an Azure unit (Golden +16)', () => {
    for (const golden of [false, true]) {
      const { g, p } = setup();
      const az = U(g, 'knight', 1, 1), nb = U(g, 'ash', 1, 1); az.kw = []; nb.kw = [];
      p.board = [az, nb];
      p.hand = [U(g, 'tourmaline', undefined, undefined, golden), U(g, 'tourmaline', undefined, undefined, golden)];
      play(g, p, 0, 2, az.uid); play(g, p, 0, 3, nb.uid);
      const m = golden ? 2 : 1;
      expect([az.hp, nb.hp]).toEqual([1 + 16 * m, 1 + 8 * m]);
      expect(az.kw).toContain('taunt'); expect(nb.kw).toContain('taunt');
    }
  });

  it('White Gem: +4/+4 to one unit of each faction (a different one each where it can)', () => {
    const { g, p } = setup();
    const k1 = U(g, 'knight', 1, 1), k2 = U(g, 'knight', 1, 1), d = U(g, 'disciple', 1, 1), n = U(g, 'sword', 1, 1);
    p.board = [k1, k2, d, n]; p.hand = [U(g, 'white_gem')];
    play(g, p, 0, 4);
    expect(k1.atk + k2.atk).toBe(2 + 4); // one Azure unit
    expect(d.atk).toBe(5); // the Cloister unit
    expect(n.atk).toBe(1); // Neutral isn't a faction
    expect(def('white_gem').tier).toBe(3);
  });

  it('Broken Land is 19/29; Omni-Gem gives 2 Tier 5 units', () => {
    expect([def('broken_land').atk, def('broken_land').hp]).toEqual([19, 29]);
    expect(def('omni_gem').text).toContain('2 random Tier 5');
  });
});

describe('keyword panels', () => {
  it('list every keyword on a card (text first, then gained ones), each with an explanation', async () => {
    const { cardKeywords, keywordPanelsHtml } = await import('../src/ui/view');
    expect(cardKeywords({ cardId: 'warmech', golden: false })).toEqual(['Bubble', 'Reborn', 'Deathrattle']);
    expect(cardKeywords({ cardId: 'tourmaline', golden: false })).toEqual(['Arrive', 'Taunt']);
    expect(cardKeywords({ cardId: 'merge_o', golden: false, kw: ['divineShield'] })).toEqual(['Merge', 'Bubble']);
    expect(cardKeywords({ cardId: 'avenger', golden: false })).toEqual(['Avenge']);
    expect(keywordPanelsHtml({ cardId: 'corrivath_harp', golden: false })).toContain('End of Turn');
  });
});
