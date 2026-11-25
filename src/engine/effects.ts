/**
 * Card abilities. Each card id maps to a set of hooks.
 *  - Shop hooks receive a Ctx whose `board` is the player's persistent board.
 *  - Arrive effects may also be triggered during combat (Returner, Spoonful); then `combat` is set and
 *    `board` holds combat units, so effects there are temporary unless they touch hand/player.
 *  - Combat hooks receive a CCtx.
 * m = 1 for normal, 2 for golden.
 */
import type { Body, Keyword, Player, Tribe, Unit, GameState } from './types';
import { addKw, CARDS, def, effStats, has, isTribe, log, makeUnit, pick, rand, removeKw, sample, tribeOf, CONFIG } from './core';
import type { CUnit, Combat, Side } from './combat';
import {
  destroyUnit, discoverOptions, gainNew, inPlay, maxGoldFor, queueDiscover, randomCardOfTier, sellUnit, drawFromPool,
} from './game';

export interface Ctx {
  g: GameState;
  p: Player;
  self: Body;
  m: number;
  board: Body[];
  target?: Body;
  combat?: Combat;
  side?: Side;
}

export interface CCtx {
  g: GameState;
  c: Combat;
  side: Side;
  self: CUnit;
  m: number;
  p: Player;
  pos: number;
}

export interface Effect {
  /** a targeted play: any friendly unit, an unlocked one, or (Merge-o) an Alcove unit to Merge with */
  target?: 'friendly' | 'unlocked' | 'alcove';
  battlecry?(c: Ctx): void;
  onPlay?(c: Ctx): void;
  onSell?(c: Ctx): void;
  onSellOther?(c: Ctx, sold: Unit): void;
  onBuy?(c: Ctx, u: Unit): void;
  onGain?(c: Ctx, u: Unit, how: 'buy' | 'gain'): void;
  onPlayOther?(c: Ctx, u: Unit): void;
  onBattlecry?(c: Ctx): void;
  endTurn?(c: Ctx): void;
  onRefresh?(c: Ctx): void;
  startTurn?(c: Ctx): void;
  soc?(c: CCtx): void;
  rally?(c: CCtx, target: CUnit): void;
  /** the Rally only damages the units next to the target: it lands together with the attack (one impact) */
  splash?: boolean;
  deathrattle?(c: CCtx): void;
  avenge?: [number, number]; // [normal, golden]
  avengeFn?(c: CCtx): void;
  onDeathAny?(c: CCtx, dead: CUnit): void;
  onRebornAny?(c: CCtx, u: CUnit): void;
  onDamaged?(c: CCtx): void;
  onShieldLost?(c: CCtx, u: CUnit): void;
  onRallyFriendly?(c: CCtx, u: CUnit): void;
  /** this attacked and killed `dead` (its Attack and max Health just before the hit) */
  onAttackKill?(c: CCtx, dead: CUnit, atk: number, maxHp: number): void;
  /** this unit killed a unit (any way) */
  onKill?(c: CCtx, dead: CUnit): void;
  /** another friendly unit was summoned during battle */
  onSummonFriendly?(c: CCtx, u: CUnit): void;
}

// ---------------- helpers ----------------
/** the Gems: improvable, and what "a random Gem" picks from (Omni-Gem isn't one of them) */
export const GEMS = ['purple_gem', 'tourmaline', 'pink_gem', 'green_gem', 'red_gem', 'ancient_name_brambor'];

/** how many times this player has improved a Gem (Red Gem keeps its old counter) */
export function gemLevel(p: Player, id: string): number {
  return (p.gemBonus?.[id] ?? 0) + (id === 'red_gem' ? p.redGemBonus : 0);
}
export function improveGem(p: Player, id: string, n: number) {
  if (id === 'red_gem') { p.redGemBonus += n; return; }
  (p.gemBonus ??= {})[id] = (p.gemBonus[id] ?? 0) + n;
}

/** a targeted Arrive's target: the chosen unit (it can be the card itself), or a random friendly unit */
function gemTarget(c: Ctx): Body | undefined {
  return c.target ?? pick(c.g, c.board);
}

/** "Play a Gem on a unit": its Arrive, aimed at that unit, without the Gem itself */
function playGemOn(c: Ctx, gemId: string, target: Body | undefined) {
  if (!target) return;
  // Gem Wizard: Red Gems trigger twice (three times if Golden), however they're played
  let times = 1;
  if (gemId === 'red_gem') for (const b of c.board) if (b.cardId === 'gem_wizard') times = Math.max(times, b.golden ? 3 : 2);
  // the Gem itself isn't on the board, so it can't be "this" (Red Gem skips "itself" when picking its 3 units)
  const gem: Body = { cardId: gemId, golden: false, atk: 0, hp: 0, kw: [], mem: {} } as unknown as Body;
  const source = c.combat ? (c.self as CUnit) : undefined;
  for (let i = 0; i < times; i++) {
    const before = c.combat ? new Map(c.board.map((u) => [u, `${u.atk}/${u.hp}/${u.kw.join()}`])) : null;
    EFFECTS[gemId]?.battlecry?.({ ...c, self: gem, m: 1, target });
    // in battle, show each Gem landing: a gem flies from the unit that played it to every unit it changed
    if (c.combat && before) {
      const changed = c.board.filter((u) => before.get(u) !== `${u.atk}/${u.hp}/${u.kw.join()}`) as CUnit[];
      c.combat.gemFx(changed.map((u) => u.id), source?.id, c.side!);
      c.combat.snap('trigger', { source: source?.id, note: `${source ? def(source.cardId).name + ': ' : ''}${def(gemId).name}` });
    }
  }
}

/** a shop-style context for a combat hook (so Gem Arrive effects can run in battle) */
function cctx(c: CCtx): Ctx {
  return { g: c.g, p: c.p, self: c.self, m: c.m, board: c.side.units.filter((u) => u.hp > 0), combat: c.c, side: c.side };
}

const buff = (b: Body | undefined, a: number, h: number) => {
  if (!b) return;
  b.atk += a;
  b.hp += h;
};

const gain = (c: { g: GameState; p: Player }, id: string | undefined, golden = false) => gainNew(c.g, c.p, id, golden);

/** a Potato Gem's Health right now (2, +1 per improvement) */
export function potatoHp(p: Player): number {
  return 2 + gemLevel(p, 'ancient_name_brambor');
}

function discover(c: Ctx, filter: (id: string) => boolean, reason: string, times: number) {
  for (let i = 0; i < times; i++) {
    const opts = discoverOptions(c.g, filter);
    if (c.combat) gain(c, pick(c.g, opts));
    else queueDiscover(c.g, c.p, opts, reason);
  }
}

function discoverFrom(c: Ctx, ids: string[], reason: string, times: number) {
  for (let i = 0; i < times; i++) {
    const opts = sample(c.g, [...new Set(ids)], 3);
    if (!opts.length) return;
    if (c.combat) gain(c, pick(c.g, opts));
    else queueDiscover(c.g, c.p, opts, reason);
  }
}

function hpOf(p: Player, u: Unit) {
  return effStats(p, u, 'hand').hp;
}
function atkOf(p: Player, u: Unit) {
  return effStats(p, u, 'hand').atk;
}

const randomTier = (c: { g: GameState }, tier: number) => randomCardOfTier(c.g, tier);
const randomTribeUpTo = (c: { g: GameState; p: Player }, tribe: string) =>
  drawFromPool(c.g, (id) => isTribe(id, tribe as Tribe) && def(id).tier <= c.p.tier); // units of every faction count

// ---------------- the cards ----------------
export const EFFECTS: Record<string, Effect> = {
  // ===== Neverending Party =====
  skeleton: {
    deathrattle: (c) => c.c.spawnMany(c.side, 'skel', false, c.m === 2 ? 4 : 2, c.pos),
  },
  buzz_boink: {
    deathrattle: (c) => c.c.spawnMany(c.side, 'robo', false, c.m, c.pos),
  },
  ashlie: {
    battlecry: (c) => {
      c.p.tribeAtk.neverending = (c.p.tribeAtk.neverending ?? 0) + c.m;
      if (c.combat) for (const u of c.board) if (isTribe(u, 'neverending')) u.atk += c.m;
    },
  },
  bramble: {
    onDeathAny: (c, dead) => { if (isTribe(dead, 'neverending')) c.self.atk += c.m; },
  },
  thicket: {
    // Deathrattle: Reborn to a random friendly unit (Golden: 2)
    deathrattle: (c) => {
      for (const u of sample(c.g, c.side.units.filter((x) => x.hp > 0 && !has(x, 'reborn')), c.m)) addKw(u, 'reborn');
    },
  },
  sickle: {
    splash: true,
    rally: (c, t) => { for (const u of c.c.adjacent(t)) c.c.damage(u, 4 * c.m, c.self); }, // Golden: 8
  },
  funeral: {
    onRebornAny: (c) => c.c.perm(c.self, (u) => { u.hp += 2 * c.m; }, 0, 2 * c.m),
  },
  lich: {
    deathrattle: (c) => { for (let i = 0; i < c.m; i++) playGemOn(cctx(c), 'purple_gem', pick(c.g, c.side.units.filter((u) => u.hp > 0 && u !== c.self))); },
  },
  necromancer: {
    deathrattle: (c) => c.c.spawnMany(c.side, 'skeleton', c.m === 2, 2, c.pos),
  },
  romance: {
    avenge: [2, 2],
    avengeFn: (c) => {
      c.p.tribeAtk.neverending = (c.p.tribeAtk.neverending ?? 0) + c.m;
      for (const u of c.side.units) if (isTribe(u, 'neverending')) u.atk += c.m;
    },
  },
  ancient_name_neverending: {
    battlecry: (c) => {
      for (const u of c.board) buff(u, 3 * c.m, 3 * c.m);
      for (const u of c.p.hand) buff(u, 3 * c.m, 3 * c.m);
    },
  },
  returner: {
    deathrattle: (c) => {
      const adj = [c.side.units[c.pos - 1], c.side.units[c.pos]].filter((u) => u && hasBattlecry(u.cardId));
      const t = pick(c.g, adj as CUnit[]);
      if (t) for (let i = 0; i < c.m; i++) c.c.triggerBattlecry(c.side, t);
    },
  },
  abandon: {
    endTurn: (c) => {
      const i = c.board.indexOf(c.self);
      const left = c.board[i - 1] as Unit | undefined;
      if (!left || left.mem.locked) return;
      buff(c.self, left.atk * c.m, left.hp * c.m);
      destroyUnit(c.g, c.p, left);
      log(c.p, `Abandon consumed ${def(left.cardId).name}.`);
    },
  },

  // ===== Azure Order =====
  lake: {
    // once only (not written on the card): after 3 Azure units are bought, its stats double (Golden: triple)
    onBuy: (c, u) => {
      const me = c.self as Unit;
      if (me.mem.done || !isTribe(u, 'azure')) return;
      me.mem.buys = (me.mem.buys ?? 0) + 1;
      if (me.mem.buys >= 3) {
        me.mem.done = 1;
        buff(me, me.atk * c.m, me.hp * c.m);
      }
    },
  },
  purple_gem: {
    // +1/+1 for good (+1/+1 per improvement; Golden doubles), and Reborn until your next turn
    target: 'friendly',
    battlecry: (c) => {
      const t = gemTarget(c);
      if (!t) return;
      const n = (1 + gemLevel(c.p, 'purple_gem')) * c.m;
      buff(t, n, n);
      const hadReborn = has(t, 'reborn');
      addKw(t, 'reborn');
      if (!c.combat && !hadReborn) (t as Unit).mem.tmpReborn = 1;
    },
  },
  tourmaline: {
    // Blue Gem
    target: 'friendly',
    battlecry: (c) => { const t = gemTarget(c); if (t) buff(t, 0, (10 + gemLevel(c.p, 'tourmaline') * 2) * c.m); },
  },
  command: {
    battlecry: (c) => discover(c, (id) => def(id).tier === 1, 'Discover a Tier 1 unit', c.m),
  },
  royal_guard: {
    soc: (c) => {
      const i = c.side.units.indexOf(c.self);
      const targets = c.m === 2 ? [c.side.units[i - 1], c.side.units[i + 1]] : [c.side.units[i + 1]];
      for (const u of targets) if (u) addKw(u, 'divineShield');
    },
  },
  message: {
    // +2/+2 (Golden +4/+4) to your units with Taunt or Bubble
    battlecry: (c) => { for (const u of c.board) if (has(u, 'taunt') || has(u, 'divineShield')) buff(u, 2 * c.m, 2 * c.m); },
  },
  front_and_center: {
    // Bubble to two Azure units (ones without it; this one counts)
    soc: (c) => {
      const pool = c.side.units.filter((u) => u.hp > 0 && isTribe(u, 'azure') && !has(u, 'divineShield'));
      for (const u of sample(c.g, pool, 2)) addKw(u, 'divineShield');
    },
  },
  knight: {
    rally: (c) => { for (const u of c.side.units) if (isTribe(u, 'azure')) u.atk += 4 * c.m; },
  },
  longbow: {
    // Golden: one hit for double its Attack
    avenge: [3, 3],
    avengeFn: (c) => c.c.damage(c.c.randomEnemy(c.side), c.self.atk * c.m, c.self),
  },
  time_cannot_destroy: {
    avenge: [5, 5],
    avengeFn: (c) => { addKw(c.self, 'divineShield'); addKw(c.self, 'taunt'); },
  },
  catapult: {
    // 25 damage (Golden: 50) to the right-most enemy unit
    soc: (c) => {
      const live = c.c.enemy(c.side).units.filter((u) => u.hp > 0);
      if (live.length) c.c.damage(live[live.length - 1], 25 * c.m, c.self);
    },
  },
  remember: {
    // passive: the Azure units next to it at the start of a battle keep what they gain in it (see Combat.keepGains)
  },
  gelf_lanz: {
    // gains the Attack of the unit it attacks (Golden: double), for this battle
    rally: (c, t) => { c.self.atk += Math.max(0, t.atk) * c.m; },
  },
  ocean_sky: {
    onShieldLost: (c, u) => {
      if (u === c.self || u.side !== c.self.side) return;
      c.c.perm(u, (x) => buff(x, 3 * c.m, 3 * c.m), 3 * c.m, 3 * c.m);
    },
  },
  commitment: {
    // +1/+1 to your units at Start of Combat, +1/+1 more for every Arrive unit you've played since (Golden doubles)
    soc: (c) => {
      const n = (1 + (c.self.mem.imp ?? 0)) * c.m;
      for (const u of c.side.units) if (u.hp > 0) buff(u, n, n);
    },
    onPlayOther: (c, u) => { if (hasBattlecry(u.cardId)) (c.self as Unit).mem.imp = ((c.self as Unit).mem.imp ?? 0) + 1; },
  },
  // ===== Kindred Society =====
  doctor: {
    // Fighter: Rally summons random Tier 1 units
    rally: (c) => {
      const ids = CARDS.filter((d) => !d.token && d.tier === 1 && inPlay(c.g, d.id)).map((d) => d.id);
      for (let i = 0; i < c.m; i++) {
        const id = pick(c.g, ids);
        if (!id || !c.c.spawn(c.side, id, false, c.side.units.indexOf(c.self) + 1 + i)) return;
        c.c.snap('trigger', i === 0 ? { note: `Summon ${def(id).name}` } : {});
      }
    },
  },
  librarian: {
    battlecry: (c) => {
      const tier = Math.min(CONFIG.maxTier, c.p.tier + 1);
      discover(c, (id) => def(id).tier === tier, `Discover a Tier ${tier} unit`, c.m);
    },
  },
  architect: {
    endTurn: (c) => { c.self.hp += 2 * c.m; },
  },
  patchwork: {
    onGain: (c, u) => { if (isTribe(u, 'kindred')) buff(c.self, c.m, 4 * c.m); },
  },
  hug: {
    // Stuffie Magic: Kindred units in the Tavern have +2/+2 from now on (the ones there now, and every one dealt later)
    battlecry: (c) => {
      const n = 2 * c.m;
      c.p.stuffieBonus = (c.p.stuffieBonus ?? 0) + n;
      for (const u of c.p.shop) if (isTribe(u, 'kindred')) buff(u, n, n);
    },
  },
  pink_gem: {
    // +6/+6 for good (+2/+2 more per improvement; Golden doubles; a Kindred unit gets it twice), and Bubble until next turn
    target: 'friendly',
    battlecry: (c) => {
      const t = gemTarget(c);
      if (!t) return;
      const n = (6 + 2 * gemLevel(c.p, 'pink_gem')) * c.m * (isTribe(t, 'kindred') ? 2 : 1);
      buff(t, n, n);
      if (!t.kw.includes('divineShield')) { addKw(t, 'divineShield'); t.mem.tmpShield = 1; }
    },
  },
  // Turtlepult is handled by peebSync (fx.ts) in the shop and Combat.peebSync in battle
  peebnup_bubber: {},
  elemental: {
    onSellOther: (c, sold) => { if (isTribe(sold, 'kindred')) buff(c.self, sold.atk * c.m, sold.hp * c.m); },
  },
  therapist: {
    target: 'friendly',
    battlecry: (c) => {
      // Taunt and +12 Health (Golden +24), for good
      const t = gemTarget(c);
      if (!t) return;
      addKw(t, 'taunt');
      buff(t, 0, 12 * c.m);
    },
  },
  vulnerability: {}, // passive, see combat
  builder: {
    // +10 Health (Golden +20) to a random unit in your hand, for good
    avenge: [3, 3],
    avengeFn: (c) => {
      if (!c.side.persistent) return;
      const u = pick(c.g, c.p.hand);
      if (u) u.hp += 10 * c.m;
    },
  },
  '1000_miles': {
    deathrattle: (c) => {
      const k = c.self.killedBy;
      if (k && !def(k.cardId).token) for (let i = 0; i < c.m; i++) gain(c, k.cardId);
    },
  },
  barton: {
    soc: (c) => buff(c.self, c.self.atk * c.m, c.self.hp * c.m),
  },
  life: {
    // a Pink Gem into your hand at the start of each battle (Golden: two)
    soc: (c) => {
      for (let i = 0; i < c.m; i++) gain(c, 'pink_gem');
      c.c.snap('trigger', { note: `Life: Gain ${c.m === 2 ? '2 Pink Gems' : 'a Pink Gem'}` });
    },
  },
  restore: {
    avenge: [2, 2],
    avengeFn: (c) => gain(c, 'pink_gem'),
  },
  honeysuckle_kindred: {
    deathrattle: (c) => {
      const best = c.p.hand.filter((u) => isTribe(u, 'kindred')).sort((a, b) => hpOf(c.p, b) - hpOf(c.p, a)).slice(0, c.m);
      let pos = c.pos;
      for (const u of best) if (c.c.spawnUnit(c.side, u, pos)) pos++;
    },
  },
  devotion: {
    onPlay: (c) => { c.p.quests.push({ kind: 'devotion', have: 0, need: c.m === 2 ? 4 : 8, reward: 0 }); },
  },

  // ===== Brambor =====
  sapling: {
    avenge: [3, 3],
    avengeFn: (c) => {
      c.self.cardId = 'rootling';
      c.self.atk = 9 * c.m;
      c.self.hp = 9 * c.m;
      c.self.kw = [];
    },
  },
  farmer: {
    avenge: [3, 3],
    avengeFn: (c) => { for (let i = 0; i < c.m; i++) gain(c, 'ancient_name_brambor'); },
  },
  organizer: {
    // Planter: a Potato Gem to your hand (Golden: 2)
    deathrattle: (c) => {
      for (let i = 0; i < c.m; i++) gain(c, 'ancient_name_brambor');
      c.c.snap('trigger', { note: `Planter: Gain ${c.m === 2 ? '2 Potato Gems' : 'a Potato Gem'}` });
    },
  },
  honeysuckle_brambor: {
    avenge: [3, 3],
    avengeFn: (c) => { for (let i = 0; i < c.m; i++) gain(c, randomTribeUpTo(c, 'brambor')); },
  },
  root: {}, // end of combat, see combat
  splashmaster: {
    rally: (c, t) => {
      removeKw(t, 'taunt');
      removeKw(t, 'reborn');
      if (c.m === 2) removeKw(t, 'divineShield');
    },
  },
  elder: {
    // your other Brambor units get its Attack (Golden: double)
    soc: (c) => { for (const u of c.side.units) if (u !== c.self && u.hp > 0 && isTribe(u, 'brambor')) u.atk += c.self.atk * c.m; },
  },
  cursed_vines: {
    // +4/+4 to another friendly unit (Golden: two others), for this battle
    rally: (c) => { for (const u of sample(c.g, c.side.units.filter((x) => x.hp > 0 && x !== c.self), c.m)) buff(u, 4, 4); },
  },
  witch: {
    rally: (c) => { for (let i = 0; i < c.m; i++) c.c.damage(c.c.randomEnemy(c.side), c.self.atk, c.self); },
  },
  warlock: {
    onRallyFriendly: (c) => c.c.perm(c.self, (u) => { u.hp += 3 * c.m; }, 0, 3 * c.m),
  },
  distant_land: {
    deathrattle: (c) => { for (let i = 0; i < 2 * c.m; i++) gain(c, pick(c.g, GEMS)); },
  },
  ancient_name_brambor: {
    // Potato Gem: +2 Health (Golden +4; +1 per improvement) to every unit in your hand and army
    battlecry: (c) => {
      const n = potatoHp(c.p) * c.m;
      for (const u of c.board) u.hp += n;
      if (!c.combat || c.side?.persistent) for (const u of c.p.hand) u.hp += n;
    },
  },
  chosen_name: {
    soc: (c) => buff(c.self, c.self.atk * c.m, c.self.hp * c.m),
  },
  andromeda_robin: {
    // a Potato Gem's Health on two random friendly units, then Potato Gems improve (Golden: twice)
    endTurn: (c) => {
      const n = potatoHp(c.p);
      for (const u of sample(c.g, c.board, 2)) u.hp += n;
      improveGem(c.p, 'ancient_name_brambor', c.m);
    },
  },
  // ===== Cloister =====
  green_gem: {
    target: 'friendly',
    battlecry: (c) => {
      const t = gemTarget(c);
      if (!t) return;
      buff(t, 2 + gemLevel(c.p, 'green_gem'), 0);
      addKw(t, 'windfury');
    },
  },

  storyteller: {
    // a random Cloister unit up to your Tavern Tier (Golden: two)
    onSell: (c) => { for (let i = 0; i < c.m; i++) gain(c, randomTribeUpTo(c, 'cloister')); },
  },
  disciple: {
    deathrattle: (c) => { for (let i = 0; i < c.m; i++) c.c.damage(c.c.randomEnemy(c.side), 1, c.self); },
  },
  hunter: {
    soc: (c) => {
      for (const t of sample(c.g, c.c.enemy(c.side).units, c.m)) {
        addKw(t, 'taunt');
        c.c.damage(t, 1, c.self);
      }
    },
  },
  owl: {}, // +1/+2 per Owl summoned this game: an aura (core.ts ownerBonus), counted in play() and Combat.spawn
  owl_summoner: {
    deathrattle: (c) => c.c.spawnMany(c.side, 'owl', c.m === 2, 1, c.pos),
  },
  beast_vine: {
    battlecry: (c) => { for (let i = 0; i < 2 * c.m; i++) gain(c, pick(c.g, GEMS)); },
    deathrattle: (c) => { for (let i = 0; i < 2 * c.m; i++) gain(c, pick(c.g, GEMS)); c.c.snap('trigger', { note: `Beast Vine: Gain ${2 * c.m} Gems` }); },
  },
  secret: {
    soc: (c) => { c.side.secrets.push(c.m === 2); },
  },
  songstress: {
    avenge: [2, 2],
    avengeFn: (c) => buff(pick(c.g, c.p.hand), 6 * c.m, 6 * c.m),
  },
  red_sea_snake: {
    rally: (c) => {
      const cands = c.side.units.filter((u) => u !== c.self && isTribe(u, 'cloister') && !has(u, 'venomous'));
      for (const u of sample(c.g, cands, c.m)) addKw(u, 'venomous');
    },
  },
  larva: {}, // handled at start of turn
  orange_ninja: {}, // Green Ninja: joins from your hand at Start of Combat (see combat)
  ambush: {
    deathrattle: (c) => {
      const best = c.p.hand.filter((u) => isTribe(u, 'cloister')).sort((a, b) => atkOf(c.p, b) - atkOf(c.p, a)).slice(0, c.m);
      let pos = c.pos;
      const spawned: CUnit[] = [];
      for (const u of best) {
        const s = c.c.spawnUnit(c.side, u, pos);
        if (s) { spawned.push(s); pos++; }
      }
      for (const s of spawned) c.c.attackNow(s);
    },
  },
  shadow_place: {
    onPlayOther: (c, u) => {
      if (!isTribe(u, 'cloister')) return;
      for (const t of sample(c.g, c.board.filter((b) => b !== u), 2)) buff(t, 3 * c.m, 3 * c.m);
    },
  },
  omar_evans: {
    // Avenge (3): Doomstrike again (Golden: and Bubble), then it attacks at once
    avenge: [3, 3],
    avengeFn: (c) => {
      addKw(c.self, 'venomous');
      if (c.m === 2) addKw(c.self, 'divineShield');
      c.c.attackNow(c.self);
    },
  },
  shine_like_a_knife: {
    // its Attack to two friendly units (Golden: double its Attack)
    deathrattle: (c) => {
      for (const u of sample(c.g, c.side.units.filter((x) => x.hp > 0), 2)) u.atk += c.self.atk * c.m;
    },
  },

  // ===== Alcove Prefex =====
  left_twinbot: {
    // all your Twinbots get +1 Attack for the rest of the game (ownerBonus), including the ones in this battle
    rally: (c) => {
      if (c.side.persistent) c.p.twinBonus = (c.p.twinBonus ?? 0) + c.m;
      for (const u of c.side.units) if (u.hp > 0 && (u.cardId === 'left_twinbot' || u.cardId === 'right_twinbot')) buff(u, c.m, 0);
    },
  },
  right_twinbot: {
    soc: (c) => {
      const l = c.side.units[c.side.units.indexOf(c.self) - 1];
      if (l) addKw(l, 'reborn');
    },
  },
  tinker: {
    // while in play: each Refresh gives a random shop unit Doomstrike, Bubble or Reborn (game.ts reroll)
    onRefresh: (c) => {
      for (const u of sample(c.g, c.p.shop, c.m)) {
        const opts = (['venomous', 'divineShield', 'reborn'] as Keyword[]).filter((k) => !has(u, k));
        const k = pick(c.g, opts);
        if (k) addKw(u, k);
      }
    },
  },
  sniper: {
    // 2 damage to a random enemy, once more for each other Alcove unit you have (Golden: all of it twice)
    soc: (c) => {
      const shots = 1 + c.side.units.filter((u) => u.hp > 0 && u !== c.self && isTribe(u, 'alcove')).length;
      for (let i = 0; i < shots * c.m; i++) c.c.damage(c.c.randomEnemy(c.side), 2, c.self);
    },
  },
  mod: {
    // Start of Combat: its stats (Golden: double) go to the unit on its right
    soc: (c) => {
      const r = c.side.units[c.side.units.indexOf(c.self) + 1];
      if (r && r.hp > 0) buff(r, c.self.atk * c.m, c.self.hp * c.m);
    },
  },
  chaos: {
    // once, plus once more for every Arrive unit played this turn
    endTurn: (c) => {
      const times = 1 + (c.p.battlecryUnitsThisTurn ?? 0);
      buff(c.board[0], 3 * c.m * times, 3 * c.m * times);
    },
  },
  aerial_drone: {
    onBattlecry: (c) => buff(c.self, 2 * c.m, 4 * c.m),
  },
  computer: {
    deathrattle: (c) => {
      if (!c.side.persistent) return;
      // upgrading the shop costs less (1, or 2 if Golden); never below 0
      c.c.after(c.side, () => { c.p.upgradeCost = Math.max(0, c.p.upgradeCost - c.m); });
    },
  },
  virus: {
    soc: (c) => {
      for (const t of sample(c.g, c.c.enemy(c.side).units.filter((u) => u.hp > 0), c.m)) t.hp = 1;
    },
  },
  robot_boy: {
    endTurn: (c) => {
      for (let i = 0; i < c.m; i++) gain(c, drawFromPool(c.g, (id) => def(id).tribe === 'neutral')); // any Tier, Tier 6 included
    },
  },
  // the Robot Boy hero's first token (games saved before Orbo Pet replaced it)
  robot_boy_buddy: {
    endTurn: (c) => {
      for (let i = 0; i < c.m; i++) gain(c, drawFromPool(c.g, (id) => def(id).tribe === 'neutral'));
    },
  },
  scientist: {
    // Deathrattle: Alcove units have +2 Attack (Golden +4) for the rest of the game, starting with this battle
    deathrattle: (c) => {
      c.p.alcoveAtkThisTier += 2 * c.m;
      for (const u of c.side.units) if (u.hp > 0 && isTribe(u, 'alcove')) u.atk += 2 * c.m;
    },
  },
  paradox: {
    // gains the Health of your highest-Health other unit (Golden: double), for this battle
    soc: (c) => {
      const best = c.side.units.filter((u) => u !== c.self && u.hp > 0).reduce<CUnit | undefined>((a, b) => (!a || b.hp > a.hp ? b : a), undefined);
      if (best) c.self.hp += best.hp * c.m;
    },
  },
  horseman: {}, // Reborn with full stats: see the reborn code in combat.ts
  warmech: {}, // stats from Deathrattles triggered this game (core ownerBonus; grows during battle in combat.ts)
  may_danaris: {
    // a 20/20 Phoenix, with a random Gem played on it (two if Golden)
    deathrattle: (c) => {
      const ph = c.c.spawn(c.side, 'phoenix', false, c.pos);
      if (!ph) return;
      c.c.snap('trigger', { note: 'Summon Phoenix' });
      for (let i = 0; i < c.m; i++) playGemOn(cctx(c), pick(c.g, GEMS)!, ph);
    },
  },
  golden_light: {
    // any kill: attacking, defending or with an ability
    onKill: (c) => { for (let i = 0; i < c.m; i++) gain(c, randomTier(c, 5)); },
  },

  // ===== Business Demons =====
  drill_sgt: {
    soc: (c) => { if (c.side.tier <= 3) buff(c.self, 5 * c.m, 0); },
  },
  shopkeep: {
    onBuy: (c) => {
      const u = c.self as Unit;
      u.mem.buys = (u.mem.buys ?? 0) + 1;
      if (u.mem.buys % 4 === 0) for (let i = 0; i < c.m; i++) gain(c, randomTier(c, 1));
    },
  },
  intern: {
    // Avenge (5): sells for 1 more gold (2 if Golden), for good
    avenge: [5, 5],
    avengeFn: (c) => {
      c.self.mem.sellBonus = (c.self.mem.sellBonus ?? 0) + c.m;
      c.c.perm(c.self, (u) => { u.mem.sellBonus = (u.mem.sellBonus ?? 0) + c.m; });
    },
  },
  pyro: {}, // see Combat.damage
  jeweler: {
    startTurn: (c) => improveGem(c.p, 'red_gem', c.m),
  },
  treasure: {}, // sell value
  biker: {
    onDamaged: (c) => buff(c.self, 2 * c.m, 3 * c.m),
  },
  investor: {
    endTurn: (c) => { c.p.maxGoldBonus += c.m; },
  },
  red_gem: {
    battlecry: (c) => {
      const amt = (3 + gemLevel(c.p, 'red_gem')) * c.m;
      // the Gem itself counts if it's one of the 3
      for (const u of c.board.slice(0, 3)) buff(u, amt, 0);
    },
  },
  purveyor: {
    battlecry: (c) => { for (let i = 0; i < c.m; i++) gain(c, 'red_gem'); },
    endTurn: (c) => { for (let i = 0; i < c.m; i++) gain(c, 'red_gem'); },
  },
  gargoil: {
    deathrattle: (c) => {
      for (const u of sample(c.g, c.c.enemy(c.side).units.filter((x) => x.hp > 0), 3)) c.c.damage(u, 10 * c.m, c.self);
    },
  },
  miner: {
    // Bulldozer: gain a Red Gem and play one (on its own army)
    rally: (c) => { for (let i = 0; i < c.m; i++) { gain(c, 'red_gem'); playGemOn(cctx(c), 'red_gem', c.self); } },
  },
  bill_milton: {
    // +1/+1 per maximum Gold (Golden: +2/+2)
    endTurn: (c) => { const n = maxGoldFor(c.g, c.p) * c.m; buff(c.self, n, n); },
  },
  gem_wizard: {}, // see battlecryTimes
  exploit: {
    onSell: (c) => { c.p.quests.push({ kind: 'bill', have: 0, need: 8, reward: 12 }); },
  },

  // ===== Neutral =====
  sword: {
    battlecry: (c) => {
      const t = c.board[0]; // itself, if it's the left-most
      if (t) t.atk += 4 * c.m;
    },
  },
  shield_neutral: {
    // Taunt on a friendly unit you choose (Golden: and one more random unit without it)
    target: 'friendly',
    battlecry: (c) => {
      const t = gemTarget(c);
      if (!t) return;
      addKw(t, 'taunt');
      if (c.m > 1) { const more = pick(c.g, c.board.filter((u) => u !== t && !has(u, 'taunt'))); if (more) addKw(more, 'taunt'); }
    },
  },
  pickaxe: {
    // Gambler (id kept as 'pickaxe' so saves still load): Arrive: 1 free Refresh (Golden 2)
    battlecry: (c) => { c.p.freeRerolls = (c.p.freeRerolls ?? 0) + c.m; },
  },
  scout: {
    onSell: (c) => {
      const tier = scoutTier(c.self);
      discover(c, (id) => def(id).tier === tier, `Scout: Discover a Tier ${tier} unit`, c.m);
    },
  },
  silver_banner: {
    battlecry: (c) => {
      const i = c.board.indexOf(c.self);
      for (const u of [c.board[i - 1], c.board[i + 1]]) if (u) u.atk += (3 + c.p.bannerBonus) * c.m;
      c.p.bannerBonus += c.m;
    },
  },
  gold_banner: {
    battlecry: (c) => {
      const i = c.board.indexOf(c.self);
      for (const u of [c.board[i - 1], c.board[i + 1]]) if (u) u.hp += (3 + c.p.bannerBonus) * c.m;
      c.p.bannerBonus += c.m;
    },
  },
  poison: {
    deathrattle: (c) => {
      const k = c.self.killedBy;
      if (k && k.hp > 0) c.c.kill(k, c.self);
      if (c.m === 2) {
        const r = c.c.randomEnemy(c.side);
        if (r) c.c.kill(r, c.self);
      }
    },
  },
  vampire: {
    onDeathAny: (c, dead) => {
      if (dead.side !== c.self.side || dead === c.self || !hasDeathrattle(dead.cardId)) return;
      c.c.perm(c.self, (u) => { u.hp += c.m; }, 0, c.m);
    },
  },
  locas: {
    onDeathAny: (c, dead) => {
      if (!has(dead, 'taunt')) return;
      c.c.perm(c.self, (u) => buff(u, 2 * c.m, c.m), 2 * c.m, c.m);
    },
  },
  spoonful: {
    // Deathrattle: trigger the Arrive of a unit that was next to it (a random one of the two; Golden: twice)
    deathrattle: (c) => {
      const adj = [c.side.units[c.pos - 1], c.side.units[c.pos]].filter((u) => u && u.hp > 0 && hasBattlecry(u.cardId));
      const t = pick(c.g, adj as CUnit[]);
      if (t) for (let i = 0; i < c.m; i++) c.c.triggerBattlecry(c.side, t);
    },
  },
  grief: {
    // Deathrattle: upgrading costs 2 less (Golden 4), never below 0
    deathrattle: (c) => {
      if (!c.side.persistent) return;
      c.c.after(c.side, () => { c.p.upgradeCost = Math.max(0, c.p.upgradeCost - 2 * c.m); });
    },
  },
  sarinee: {}, // see endTurnEffects
  broken_land: {
    // twice (Golden: four times)
    battlecry: (c) => { for (const id of GEMS) improveGem(c.p, id, 2 * c.m); },
  },
  tom_judith: {}, // see combat deathrattle multiplier
  // ===== new units (v0.12.39) =====
  golbana: {
    // +2/+2 to your other units (Golden +4/+4), once, then once more for each other Golden unit in your army
    battlecry: (c) => {
      const times = 1 + c.board.filter((u) => u.golden && u !== c.self).length;
      for (let i = 0; i < times; i++) for (const u of c.board) if (u !== c.self) buff(u, 2 * c.m, 2 * c.m);
    },
  },
  isha: {
    onSellOther: (c, sold) => { if (isTribe(sold, 'demons')) buff(c.self, 3 * c.m, 3 * c.m); },
  },
  gunner: {
    // one of Taunt / Bubble / Doomstrike / Reborn it doesn't have yet (Golden: two)
    battlecry: (c) => {
      for (let i = 0; i < c.m; i++) {
        const k = pick(c.g, (['taunt', 'divineShield', 'venomous', 'reborn'] as Keyword[]).filter((x) => !has(c.self, x)));
        if (k) addKw(c.self, k);
      }
    },
  },
  avenger: {
    avenge: [3, 3],
    // summon a random Brambor unit next to it, and get one in your hand (Golden: 2 of each)
    avengeFn: (c) => {
      const ids = CARDS.filter((d) => !d.token && !d.hidden && d.tier <= c.p.tier && isTribe(d.id, 'brambor')).map((d) => d.id);
      for (let i = 0; i < c.m; i++) {
        const id = pick(c.g, ids);
        if (id) c.c.spawn(c.side, id, false, c.side.units.indexOf(c.self) + 1);
        gain(c, randomTribeUpTo(c, 'brambor'));
      }
      c.c.snap('trigger', { note: 'Demon Bear: Summon and get a Brambor unit' });
    },
  },
  merge_o: {
    // not an Arrive: play() Merges it into the chosen Alcove unit (or it just joins the army if you pick itself)
    target: 'alcove',
  },
  corrivath_harp: {
    endTurn: (c) => { if (c.p.lastGem) for (let i = 0; i < c.m; i++) gain(c, c.p.lastGem); },
  },
  tree_man: {}, // its ability lives in Combat.noRoom (a summon that doesn't fit)

  omni_gem: {
    onSell: (c) => { for (let i = 0; i < 3 * c.m; i++) gain(c, randomTier(c, 5)); },
  },

  // ===== Tier 6 =====
  invisible_hand: {
    // Reborn. Deathrattle: play 2 Red Gems (Golden: 4)
    deathrattle: (c) => {
      const cc = cctx(c);
      for (let i = 0; i < 2 * c.m; i++) playGemOn(cc, 'red_gem', cc.board[0] ?? c.self);
    },
  },
  tank: {
    // Rally: its Attack (Golden: double) to the units next to the target
    splash: true,
    rally: (c, t) => { for (const u of c.c.adjacent(t)) c.c.damage(u, c.self.atk * c.m, c.self); },
  },
  alabaster: {
    // the first 3 (Golden: 6) friendly units summoned in each battle get Reborn
    onSummonFriendly: (c, u) => {
      if ((c.self.mem.alabaster ?? 0) >= 3 * c.m || has(u, 'reborn')) return;
      c.self.mem.alabaster = (c.self.mem.alabaster ?? 0) + 1;
      addKw(u, 'reborn');
    },
  },
  the_mayor: {
    // two random Tier 5 units (Golden: four), if there's room
    soc: (c) => {
      let pos = c.side.units.indexOf(c.self) + 1;
      for (let i = 0; i < 2 * c.m; i++) {
        const id = pick(c.g, CARDS.filter((d) => d.tier === 5 && !d.token).map((d) => d.id));
        if (!id || !c.c.spawn(c.side, id, false, pos)) break;
        c.c.snap('trigger', { note: `The Mayor: Summon ${def(id).name}` });
        pos++;
      }
    },
  },
  archnode: {
    // Rally: one random unit of each tribe in your army (Neutral counts) gets +3/+3 (Golden +6/+6) for good
    rally: (c) => {
      const byTribe = new Map<string, CUnit[]>();
      for (const u of c.side.units) {
        if (u.hp <= 0) continue;
        const t = tribeOf(u);
        byTribe.set(t, [...(byTribe.get(t) ?? []), u]);
      }
      for (const us of byTribe.values()) {
        const u = pick(c.g, us)!;
        c.c.perm(u, (x) => buff(x, 3 * c.m, 3 * c.m), 3 * c.m, 3 * c.m);
      }
    },
  },
  adder: {
    // Poisonous. When it attacks and kills a unit, a random unit in your hand gets that unit's Attack and max Health (Golden: double)
    onAttackKill: (c, _dead, atk, maxHp) => buff(pick(c.g, c.p.hand), atk * c.m, maxHp * c.m),
  },
  potato_lord: {
    rally: (c) => { for (let i = 0; i < c.m; i++) gain(c, randomTier(c, 5)); },
  },
  blue_dragon: {
    // Avenge (3): Bubble to a random friendly unit without one (Golden: 2)
    avenge: [3, 3],
    avengeFn: (c) => {
      for (const u of sample(c.g, c.side.units.filter((x) => x.hp > 0 && !has(x, 'divineShield')), c.m)) addKw(u, 'divineShield');
    },
  },
  // ===== hero tokens =====
  // Andromeda Robin's Pumpkin: runs every Deathrattle it has collected (stored as mem.dr_<cardId> = multiplier)
  pumpkin: {
    deathrattle: (c) => {
      for (const [k, m] of Object.entries(c.self.mem)) {
        if (k.startsWith('dr_')) EFFECTS[k.slice(3)]?.deathrattle?.({ ...c, m });
      }
    },
  },
};

/** Scout: Tier 1 the turn you get it, one Tier higher each turn after (up to the Tavern's top Tier) */
export function scoutTier(u: { mem?: Record<string, number> }): number {
  return Math.min(CONFIG.maxTier, 1 + (u.mem?.age ?? 0));
}

export function hasBattlecry(id: string) {
  return !!EFFECTS[id]?.battlecry;
}

export function hasDeathrattle(id: string) {
  return !!EFFECTS[id]?.deathrattle;
}

/** How many times this unit's battlecry fires (Gem Wizard doubles/triples Red Gems). */
export function battlecryTimes(p: Player, u: Body): number {
  if (u.cardId !== 'red_gem') return 1;
  let t = 1;
  for (const b of p.board) if (b.cardId === 'gem_wizard') t = Math.max(t, b.golden ? 3 : 2);
  return t;
}

export { makeUnit };
