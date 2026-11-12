/**
 * Card abilities. Each card id maps to a set of hooks.
 *  - Shop hooks receive a Ctx whose `board` is the player's persistent board.
 *  - Battlecries may also be triggered during combat (Returner, Spoonful); then `combat` is set and
 *    `board` holds combat units, so effects there are temporary unless they touch slots/hand/player.
 *  - Combat hooks receive a CCtx.
 * m = 1 for normal, 2 for golden.
 */
import type { Body, Keyword, Player, Slot, Unit, GameState } from './types';
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
  target?: 'friendly' | 'unlocked';
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

/** a Gem's target: the chosen unit, or a random other friendly unit */
function gemTarget(c: Ctx): Body | undefined {
  return c.target ?? pick(c.g, others(c.board, c.self));
}

/** "Play a Gem on a unit": its Battlecry, aimed at that unit, without the Gem itself */
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

/** a shop-style context for a combat hook (so Gem Battlecries can run in battle) */
function cctx(c: CCtx): Ctx {
  return { g: c.g, p: c.p, self: c.self, m: c.m, board: c.side.units.filter((u) => u.hp > 0), combat: c.c, side: c.side };
}

const buff = (b: Body | undefined, a: number, h: number) => {
  if (!b) return;
  b.atk += a;
  b.hp += h;
};

const gain = (c: { g: GameState; p: Player }, id: string | undefined, golden = false) => gainNew(c.g, c.p, id, golden);

function slotIndex(c: Ctx): number {
  if (c.combat) return (c.self as CUnit).slot;
  return c.board.indexOf(c.self);
}

/** Change a slot permanently (if this player is real), and the unit currently using it. */
function slotBuff(c: Ctx, idx: number, a: number, h: number, kws: Keyword[] = []) {
  if (idx < 0 || idx >= CONFIG.boardSize) return;
  const persistent = !c.combat || c.side!.persistent;
  if (persistent) {
    const s = c.p.slots[idx];
    s.atk += a;
    s.hp += h;
    for (const k of kws) addKw(s, k);
  }
  if (c.combat) {
    const u = c.side!.units.find((x) => x.slot === idx);
    if (u) {
      buff(u, a, h);
      for (const k of kws) addKw(u, k);
    }
  }
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

function others(board: Body[], self: Body) {
  return board.filter((b) => b !== self);
}

function hpOf(p: Player, u: Unit) {
  return effStats(p, u, 'hand').hp;
}
function atkOf(p: Player, u: Unit) {
  return effStats(p, u, 'hand').atk;
}

const randomTier = (c: { g: GameState }, tier: number) => randomCardOfTier(c.g, tier);
const randomTribeUpTo = (c: { g: GameState; p: Player }, tribe: string) =>
  drawFromPool(c.g, (id) => def(id).tribe === tribe && def(id).tier <= c.p.tier);

// ---------------- the cards ----------------
export const EFFECTS: Record<string, Effect> = {
  // ===== Neverending Party =====
  skeleton: {
    deathrattle: (c) => c.c.spawnMany(c.side, 'skel', false, c.m === 2 ? 4 : 2, c.pos),
  },
  memory: {
    onSell: (c) => { for (let i = 0; i < c.m; i++) gain(c, randomTier(c, 1)); },
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
    rally: (c, t) => { for (const u of c.c.adjacent(t)) c.c.damage(u, 4, c.self); }, // Golden: same 4 (just bigger stats)
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
    avenge: [3, 3],
    avengeFn: (c) => {
      c.p.tribeAtk.neverending = (c.p.tribeAtk.neverending ?? 0) + c.m;
      for (const u of c.side.units) if (isTribe(u, 'neverending')) u.atk += c.m;
    },
  },
  ancient_name_neverending: {
    battlecry: (c) => {
      for (const u of others(c.board, c.self)) buff(u, 3 * c.m, 3 * c.m);
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
    endTurn: (c) => buff(pick(c.g, c.p.hand), 0, c.m),
  },
  purple_gem: {
    // Reborn and +1/+1 (+1/+1 per improvement) until your next turn
    target: 'friendly',
    battlecry: (c) => {
      const t = gemTarget(c);
      if (!t) return;
      const n = 1 + gemLevel(c.p, 'purple_gem');
      buff(t, n, n);
      const hadReborn = has(t, 'reborn');
      addKw(t, 'reborn');
      if (!c.combat) {
        const u = t as Unit;
        u.mem.tmpAtk = (u.mem.tmpAtk ?? 0) + n;
        u.mem.tmpHp = (u.mem.tmpHp ?? 0) + n;
        if (!hadReborn) u.mem.tmpReborn = 1;
      }
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
    onSell: (c) => { for (const s of c.p.slots) { s.atk += c.m; s.hp += 2 * c.m; } },
  },
  front_and_center: {
    battlecry: (c) => { for (let i = 0; i < c.m; i++) slotBuff(c, i, 0, 0, ['divineShield']); },
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
    soc: (c) => {
      for (let i = 0; i < c.m; i++) {
        const live = c.c.enemy(c.side).units.filter((u) => u.hp > 0);
        if (!live.length) return;
        const low = live.reduce((a, b) => (b.hp < a.hp ? b : a));
        c.c.damage(low, 25, c.self);
      }
    },
  },
  remember: {
    battlecry: (c) => discoverFrom(c, c.p.lastOpponentBoard.map((u) => u.cardId), 'Discover a card from your last opponent', c.m),
  },
  gelf_lanz: {
    rally: (c, t) => {
      const dmg = c.m === 2 ? c.self.atk : Math.floor(c.self.atk / 2);
      for (const u of c.c.adjacent(t)) c.c.damage(u, dmg, c.self);
    },
  },
  ocean_sky: {
    onShieldLost: (c, u) => {
      if (u === c.self || u.side !== c.self.side) return;
      c.c.perm(u, (x) => buff(x, 3 * c.m, 3 * c.m), 3 * c.m, 3 * c.m);
    },
  },
  commitment: {
    battlecry: (c) => {
      const t = others(c.board, c.self)[0];
      if (!t) return;
      buff(t, t.atk * c.m, t.hp * c.m);
      if (!c.combat) (t as Unit).mem.locked = 1;
    },
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
    endTurn: (c) => slotBuff(c, c.board.indexOf(c.self), 2 * c.m, 2 * c.m),
  },
  patchwork: {
    onGain: (c, u) => {
      if (!isTribe(u, 'kindred')) return;
      const i = c.board.indexOf(c.self);
      if (i >= 0) slotBuff(c, i, c.m, 2 * c.m);
    },
  },
  hug: {
    battlecry: (c) => buff(pick(c.g, c.p.hand.filter((u) => isTribe(u, 'kindred'))), 6 * c.m, 6 * c.m),
  },
  pink_gem: {
    // Divine Shield to random friendly units (1, +1 per improvement; Golden doubles); played on a unit, that one first
    battlecry: (c) => {
      const n = (1 + gemLevel(c.p, 'pink_gem')) * c.m;
      const pool = others(c.board, c.self).filter((u) => !has(u, 'divineShield') && u !== c.target);
      const picks = [...(c.target ? [c.target] : []), ...sample(c.g, pool, n)].slice(0, n);
      for (const u of picks) addKw(u, 'divineShield');
    },
  },
  therapist: {
    target: 'friendly',
    battlecry: (c) => {
      const t = c.target ?? (c.combat ? pick(c.g, others(c.board, c.self)) : undefined);
      if (!t) return;
      if (has(t, 'taunt')) removeKw(t, 'taunt');
      else addKw(t, 'taunt');
      if (c.m === 2) buff(t, 4, 4);
    },
  },
  vulnerability: {}, // passive, see combat
  builder: {
    avenge: [5, 5],
    avengeFn: (c) => {
      if (c.side.persistent && c.p.slots[c.self.slot]) c.p.slots[c.self.slot].hp += 10 * c.m;
      c.self.hp += 10 * c.m;
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
    // spawn two Pink Gems; their Battlecry happens as they arrive
    soc: (c) => {
      for (let i = 0; i < 2; i++) {
        const cu = c.c.spawn(c.side, 'pink_gem', c.m === 2, c.side.units.indexOf(c.self) + 1 + i);
        if (!cu) break;
        c.c.snap('trigger', i === 0 ? { note: 'Summon Pink Gem' } : {});
        c.c.triggerBattlecry(c.side, cu);
      }
    },
  },
  restore: {
    avenge: [3, 3],
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
    target: 'friendly',
    battlecry: (c) => {
      const t = c.target ?? (c.combat ? pick(c.g, others(c.board, c.self)) : undefined);
      if (!t) return;
      addKw(t, 'taunt');
      if (c.m === 2) buff(t, 4, 4);
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
    soc: (c) => {
      const s = c.side.slots[c.self.slot];
      if (!s) return;
      for (const u of c.side.units) if (u !== c.self) buff(u, s.atk * c.m, s.hp * c.m);
    },
  },
  cursed_vines: {
    rally: (c) => {
      if (c.side.persistent && c.p.slots[c.self.slot]) { c.p.slots[c.self.slot].atk += 2 * c.m; c.p.slots[c.self.slot].hp += 2 * c.m; }
      buff(c.self, 2 * c.m, 2 * c.m);
    },
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
    // Potato Gem: +Health to a slot (the chosen unit's)
    target: 'friendly',
    battlecry: (c) => {
      const t = gemTarget(c);
      if (!t) return;
      slotBuff(c, c.combat ? (t as CUnit).slot : c.board.indexOf(t), 0, (8 + gemLevel(c.p, 'ancient_name_brambor')) * c.m);
    },
  },
  chosen_name: {
    soc: (c) => buff(c.self, c.self.atk * c.m, c.self.hp * c.m),
  },
  andromeda_robin: {
    // plays a Potato Gem on its own slot, then improves Potato Gems
    endTurn: (c) => {
      playGemOn(c, 'ancient_name_brambor', c.self);
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
    onSell: (c) => { for (let i = 0; i < c.m; i++) gain(c, randomTier(c, 1)); },
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
  owl: {
    endTurn: (c) => slotBuff(c, c.board.indexOf(c.self), 2 * c.m, 0),
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
    // Avenge (3): Venomous again (Golden: and Divine Shield), then it attacks at once
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
    // while in play: each Refresh gives a random shop unit Venomous, Divine Shield or Reborn (game.ts reroll)
    onRefresh: (c) => {
      for (const u of sample(c.g, c.p.shop, c.m)) {
        const opts = (['venomous', 'divineShield', 'reborn'] as Keyword[]).filter((k) => !has(u, k));
        const k = pick(c.g, opts);
        if (k) addKw(u, k);
      }
    },
  },
  sniper: {
    // 3 damage to a random enemy, once more for each other Alcove unit you have (Golden: all of it twice)
    soc: (c) => {
      const shots = 1 + c.side.units.filter((u) => u.hp > 0 && u !== c.self && isTribe(u, 'alcove')).length;
      for (let i = 0; i < shots * c.m; i++) c.c.damage(c.c.randomEnemy(c.side), 3, c.self);
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
    // once, plus once more for every Battlecry triggered this turn
    endTurn: (c) => {
      const times = 1 + c.p.battlecriesThisTurn;
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
  scientist: {
    // Deathrattle: Alcove units have +2 Attack (Golden +4) for the rest of the game, starting with this battle
    deathrattle: (c) => {
      c.p.alcoveAtkThisTier += 2 * c.m;
      for (const u of c.side.units) if (u.hp > 0 && isTribe(u, 'alcove')) u.atk += 2 * c.m;
    },
  },
  paradox: {
    battlecry: (c) => {
      const src = c.p.slots[0];
      const plain = c.p.slots.map((s, i) => [s, i] as [Slot, number]).filter(([s, i]) => i > 0 && !s.atk && !s.hp && !s.kw.length);
      for (const [, i] of sample(c.g, plain, c.m)) slotBuff(c, i, src.atk, src.hp, src.kw);
    },
  },
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
    deathrattle: (c) => gain(c, randomTier(c, 6)),
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
      // (not counting the Gem itself)
      for (const u of others(c.board, c.self).slice(0, 3)) {
        if (rand(c.g) < 0.5) buff(u, amt, 0);
        else buff(u, 0, amt);
      }
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
    endTurn: (c) => buff(c.self, maxGoldFor(c.g, c.p) * c.m, 0),
  },
  gem_wizard: {}, // see battlecryTimes
  exploit: {
    onSell: (c) => { c.p.quests.push({ kind: 'bill', have: 0, need: 8, reward: 12 }); },
  },

  // ===== Neutral =====
  sword: {
    battlecry: (c) => {
      const t = others(c.board, c.self)[0];
      if (t) t.atk += 4 * c.m;
    },
  },
  shield_neutral: {
    battlecry: (c) => {
      const o = others(c.board, c.self);
      const t = o[o.length - 1];
      if (t) { buff(t, c.m, 2 * c.m); addKw(t, 'taunt'); }
    },
  },
  pickaxe: {
    // Gambler (id kept as 'pickaxe' so saves still load): Battlecry: 1 free Refresh (Golden 2)
    battlecry: (c) => { c.p.freeRerolls = (c.p.freeRerolls ?? 0) + c.m; },
  },
  scout: {
    onSell: (c) => {
      const tier = Math.min(CONFIG.maxTier, 1 + ((c.self.mem.age ?? 1) - 1));
      discover(c, (id) => def(id).tier === Math.max(1, tier), `Scout: Discover a Tier ${Math.max(1, tier)} unit`, c.m);
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
    deathrattle: (c) => {
      for (let i = 0; i < c.m; i++) {
        const t = pick(c.g, c.side.units.filter((u) => u.hp > 0 && hasBattlecry(u.cardId)));
        if (t) c.c.triggerBattlecry(c.side, t);
      }
    },
  },
  grief: {
    // Deathrattle: upgrading costs 3 less (Golden 6), never below 0
    deathrattle: (c) => {
      if (!c.side.persistent) return;
      c.c.after(c.side, () => { c.p.upgradeCost = Math.max(0, c.p.upgradeCost - 3 * c.m); });
    },
  },
  sarinee: {}, // see endTurnEffects
  broken_land: {
    battlecry: (c) => { for (const id of GEMS) improveGem(c.p, id, c.m); },
  },
  tom_judith: {}, // see combat deathrattle multiplier
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
    endTurn: (c) => slotBuff(c, c.board.indexOf(c.self), 0, 20 * c.m, ['reborn']),
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
    // Avenge (3): Divine Shield to a random friendly unit without one (Golden: 2)
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
