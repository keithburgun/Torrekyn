/** v0.10: slots no longer have bonuses; the cards and trinkets that used them were rewritten. Each one, checked. */
import { describe, it, expect } from 'vitest';
import { newGame, play, endTurnEffects, buy, sell } from '../src/engine/game';
import { makeUnit, def } from '../src/engine/core';
import { Combat } from '../src/engine/combat';
import { gemLevel } from '../src/engine/effects';
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
  it('Message: Battlecry gives units with Taunt or Divine Shield +2/+2', () => {
    const { g, p } = setup();
    const t = U(g, 'ash', 2, 2); t.kw = ['taunt'];
    const d = U(g, 'doctor', 2, 2); d.kw = ['divineShield'];
    const n = U(g, 'doctor', 2, 2); n.kw = [];
    p.board = [t, d, n]; p.hand = [U(g, 'message')];
    play(g, p, 0, 3);
    expect([t.atk, t.hp, d.atk, d.hp, n.atk, n.hp]).toEqual([4, 4, 4, 4, 2, 2]);
  });

  it('Front and Center: Start of Combat gives two Azure units Divine Shield', () => {
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
      // War Drum (+2 Attack) and Aegis Charm (Divine Shield on the 2 left-most) give them something to keep
      p.trinkets = ['war_drum', 'aegis_charm'];
      p.board = [left, U(g, 'remember', 1, 40, golden), right, far];
      fight(g, p, o, p.board, [U(g, 'skel', 1, 3)]).run();
      const m = golden ? 2 : 1;
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

  it('Commitment: Start of Combat +1/+1 to your units, improving with each Battlecry unit played', () => {
    const { g, p, o } = setup();
    const com = U(g, 'commitment', 8, 20);
    p.board = [com, U(g, 'skel', 1, 30)];
    p.hand = [U(g, 'red_gem'), U(g, 'hug')];
    play(g, p, 0, 2); // a Battlecry unit
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

  it('Architect +2 Health and Owl gains a Tier 1 unit, each End of Turn', () => {
    const { g, p } = setup();
    const ar = U(g, 'architect', 1, 1);
    p.board = [ar, U(g, 'owl')];
    endTurnEffects(g, p);
    expect(ar.hp).toBe(3);
    expect(p.hand.length).toBe(1);
    expect(def(p.hand[0].cardId).tier).toBe(1);
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

  it('Paradox: Start of Combat gains the Health of your highest-Health other unit', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [U(g, 'paradox', 1, 10), U(g, 'skel', 1, 40)], [U(g, 'skel', 1, 999)]);
    c.run();
    expect(at(c, afterSoc(c), 'paradox')!.hp).toBe(50);
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
  it('Shield: has Taunt, and its Battlecry gives the chosen unit Taunt (Golden: one more)', () => {
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
      expect(def(p.hand[0].cardId).tribe).toBe('cloister');
      expect(def(p.hand[0].cardId).tier).toBeLessThanOrEqual(2);
    }
  });

  it('every hero starts with 4 more Health than in v0.10.1', async () => {
    const { HEROES, heroHealth } = await import('../src/engine/heroes');
    expect(heroHealth('derby_pocket')).toBe(26);
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
  it('Organizer: Deathrattle summons a Potato Gem, whose Battlecry happens', () => {
    const { g, p, o } = setup();
    const c = fight(g, p, o, [U(g, 'organizer', 1, 1), U(g, 'skel', 1, 50)], [U(g, 'skel', 5, 999)]);
    c.run();
    const i = c.frames.findIndex((f) => f.sides[0].some((u) => u.cardId === 'ancient_name_brambor'));
    expect(i).toBeGreaterThan(0);
    // the Potato Gem's Battlecry gave the Skel +2 Health (on top of whatever damage it had taken by then)
    expect(c.frames.some((f, k) => k > 0 && (f.sides[0].find((u) => u.cardId === 'skel')?.hp ?? 0) > (c.frames[k - 1].sides[0].find((u) => u.cardId === 'skel')?.hp ?? 99))).toBe(true);
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

  it('stats: Omar Evans has no Venomous; Green Ninja is 5/2; every Gem is 1/1', () => {
    expect(def('omar_evans').keywords).not.toContain('venomous');
    expect([def('orange_ninja').atk, def('orange_ninja').hp]).toEqual([5, 2]);
    for (const id of ['tourmaline', 'red_gem', 'ancient_name_brambor', 'purple_gem', 'pink_gem', 'green_gem']) expect([def(id).atk, def(id).hp]).toEqual([1, 1]);
  });
});

it('Iron Bracer: 2 random friendly units get Divine Shield at Start of Combat', () => {
  const { g, p, o } = setup();
  p.trinkets = ['iron_bracer'];
  const mine = [U(g, 'doctor', 1, 50), U(g, 'doctor', 1, 50), U(g, 'doctor', 1, 50), U(g, 'doctor', 1, 50)];
  mine.forEach((u) => (u.kw = []));
  const c = fight(g, p, o, mine, [U(g, 'skel', 1, 999)]);
  c.run();
  expect(c.frames[afterSoc(c)].sides[0].filter((u) => u.kw.includes('divineShield')).length).toBe(2);
});

it('Therapist: Battlecry gives a unit Taunt and +12 Health (Golden: +24)', () => {
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
    expect([def('funeral').atk, def('funeral').hp]).toEqual([5, 1]);
    expect([def('omni_gem').atk, def('omni_gem').hp]).toEqual([10, 10]);
    expect(EFFECTS.restore.avenge).toEqual([2, 2]);
    expect(def('restore').text).toContain('Avenge (2)');
  });
});
