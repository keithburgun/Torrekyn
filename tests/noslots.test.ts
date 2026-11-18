/** v0.10: slots no longer have bonuses; the cards and trinkets that used them were rewritten. Each one, checked. */
import { describe, it, expect } from 'vitest';
import { newGame, play, endTurnEffects, buy, sell } from '../src/engine/game';
import { makeUnit, def } from '../src/engine/core';
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

describe('Buzz-Boink', () => {
  it('a Tier 1 Alcove 1/1 with Divine Shield; Deathrattle summons a 1/1 Robo (Golden: 2)', () => {
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
  it('Pink Gem: +6/+6 and Divine Shield until next turn, twice over for a Kindred unit (Golden doubles)', async () => {
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
      expect([k.atk, k.hp, n.atk, n.hp]).toEqual([2 + 12 * m, 2 + 12 * m, 2 + 6 * m, 2 + 6 * m]);
      expect(k.kw).toContain('divineShield'); expect(n.kw).toContain('divineShield');
      startTurn(g, p);
      expect([k.atk, k.hp, n.atk, n.hp]).toEqual([2, 2, 2, 2]);
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

  it('Peebnup Bubber: gains the Health other friendly units gain, in the shop and in battle (Golden: double)', () => {
    for (const golden of [false, true]) {
      const { g, p, o } = setup();
      const pb = U(g, 'peebnup_bubber', 8, 8, golden);
      expect([def('peebnup_bubber').tier, def('peebnup_bubber').tribe]).toEqual([5, 'kindred']);
      const k = U(g, 'therapist', 2, 2); k.kw = [];
      p.board = [pb, k]; p.hand = [U(g, 'pink_gem')];
      peebSync(g, p); // (in a real game, units on the board have always been seen)
      play(g, p, 0, 2, k.uid); // Therapist (Kindred) gets +12 Health
      expect(pb.hp).toBe(8 + 12 * (golden ? 2 : 1));
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
      // each of the 2 others gained 3 Health (Bannerlord's), so Peebnup gains 6 (Golden 12) on top of its own 3
      expect(at(c, f, 'peebnup_bubber')!.hp).toBe(8 + 3 + 6 * (golden ? 2 : 1));
    }
  });
});

describe('v0.12.4 cards', () => {
  it('Amalgam is a Tier 2 Neutral 3/2 of every faction; Beast Vine (Tier 5 Brambor 50/50) too', async () => {
    const { isTribe } = await import('../src/engine/core');
    const { g } = setup();
    expect([def('amalgam').tier, def('amalgam').tribe, def('amalgam').atk, def('amalgam').hp]).toEqual([2, 'neutral', 3, 2]);
    for (const t of ['kindred', 'brambor', 'cloister', 'alcove', 'demons', 'azure', 'neverending'] as const) {
      expect(isTribe(U(g, 'amalgam'), t)).toBe(true);
      expect(isTribe(U(g, 'beast_vine'), t)).toBe(true);
    }
    expect(def('larva').name).toBe('Slime');
  });

  it('Beast Vine: Battlecry and Deathrattle gain 2 random Gems (Golden: 4)', async () => {
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
  it('bots get +X/+X at End of Turn by your rating (+4 at 1000, +8 at 1250, +12 at 1500+); none unrated or for you', async () => {
    const { botBonusFor, newGame, endTurnEffects } = await import('../src/engine/game');
    expect([700, 875, 1000, 1125, 1250, 1500, 1800].map(botBonusFor)).toEqual([0, 2, 4, 6, 8, 12, 12]);
    for (const rating of [undefined, 1250]) {
      const g = newGame(5, 'You', undefined, rating === undefined ? {} : { rating });
      const bot = g.players[1], me = g.players[0];
      const mk = (id: string) => ({ uid: g.nextUid++, cardId: id, golden: false, atk: 2, hp: 2, kw: [], mem: {} });
      bot.board = [mk('ash')]; bot.hand = [mk('ash')]; me.board = [mk('ash')];
      g.round = 10;
      endTurnEffects(g, bot); endTurnEffects(g, me);
      const n = rating ? 8 : 0;
      expect([bot.board[0].atk, bot.hand[0].hp, me.board[0].atk]).toEqual([2 + n, 2 + n, 2]);
    }
    // the ramp at rating 1500 (+12 in full): turn 1 nothing, turn 4 a third, turn 10 and later all of it
    const g = newGame(6, 'You', undefined, { rating: 1500 });
    const bot = g.players[1];
    const got = [1, 2, 4, 7, 10, 14].map((r) => { g.round = r; bot.board = [{ uid: g.nextUid++, cardId: 'ash', golden: false, atk: 0, hp: 0, kw: [], mem: {} }]; bot.hand = []; endTurnEffects(g, bot); return bot.board[0].atk; });
    expect(got).toEqual([0, 1, 4, 8, 12, 12]);
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

  it('Robot Boy: starts with a 1/1 Venomous Robot Boy of every tribe', async () => {
    const { gainPower } = await import('../src/engine/heroes');
    const { isTribe } = await import('../src/engine/core');
    const { g, p } = setup();
    gainPower(g, p, 'robot_boy_hero');
    const rb = [...p.hand, ...p.board].find((u) => u.cardId === 'robot_boy_buddy')!;
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

  it('Marn Torf: remove 3 friendly units, then Discover a unit from their tribes', async () => {
    const { gainPower, useHeroPower } = await import('../src/engine/heroes');
    const { g, p } = setup();
    gainPower(g, p, 'marn_torf');
    p.board = [U(g, 'owl'), U(g, 'therapist'), U(g, 'owl'), U(g, 'ash')];
    for (let i = 0; i < 3; i++) { p.usedPowers = []; useHeroPower(g, p, p.board[0], 'marn_torf'); }
    expect(p.board.map((u) => u.cardId)).toEqual(['ash']);
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
