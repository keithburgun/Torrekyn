/**
 * Card abilities. Each card id maps to a set of hooks.
 *  - Shop hooks receive a Ctx whose `board` is the player's persistent board.
 *  - Battlecries may also be triggered during combat (Returner, Spoonful); then `combat` is set and
 *    `board` holds combat units, so effects there are temporary unless they touch slots/hand/player.
 *  - Combat hooks receive a CCtx.
 * m = 1 for normal, 2 for golden.
 */
import { BONUS_KEYWORDS } from './types';
import type { Body, Keyword, Player, Slot, Unit, GameState } from './types';
import { addKw, def, effStats, has, isTribe, log, makeUnit, pick, rand, removeKw, sample, tribeOf, CONFIG } from './core';
import type { CUnit, Combat, Side } from './combat';
import {
  destroyUnit, discoverOptions, gainNew, queueDiscover, randomCardOfTier, sellUnit, drawFromPool,
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
}

// ---------------- helpers ----------------
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
    endTurn: (c) => buff(c.board[0], 0, c.m),
  },
  sickle: {
    rally: (c, t) => { for (const u of c.c.adjacent(t)) c.c.damage(u, c.m, c.self); },
  },
  horseman: {}, // handled at end of combat
  funeral: {
    onRebornAny: (c) => c.c.perm(c.self, (u) => { u.hp += 2 * c.m; }, 0, 2 * c.m),
  },
  lich: {
    soc: (c) => { for (let i = 0; i < c.m; i++) c.c.damage(c.c.randomEnemy(c.side), 8, c.self); },
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
  tourmaline: {
    battlecry: (c) => slotBuff(c, 0, 0, 10 * c.m),
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
    avenge: [3, 3],
    avengeFn: (c) => { for (let i = 0; i < c.m; i++) c.c.damage(c.c.randomEnemy(c.side), c.self.atk, c.self); },
  },
  time_cannot_destroy: {
    avenge: [4, 2],
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
      c.c.perm(u, (x) => buff(x, c.m, 2 * c.m), c.m, 2 * c.m);
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
    rally: (c) => {
      for (let i = 0; i < c.m; i++) {
        const d = pick(c.g, c.side.died.filter((x) => def(x.cardId).tier === 1));
        if (d) c.c.spawnCopy(c.side, d, c.side.units.indexOf(c.self) + 1);
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
    battlecry: (c) => {
      const seen = new Set<string>();
      const picks: Unit[] = [];
      for (const u of sample(c.g, c.p.hand, c.p.hand.length)) {
        if (seen.has(u.cardId)) continue;
        seen.add(u.cardId);
        picks.push(u);
        if (picks.length >= 4) break;
      }
      for (const u of picks) buff(u, 5 * c.m, 5 * c.m);
    },
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
    deathrattle: (c) => {
      for (let i = 0; i < c.m; i++) {
        const d = pick(c.g, c.side.died.filter((x) => x.id !== c.self.id && x.cardId !== 'pink_gem'));
        if (d) c.c.spawnCopy(c.side, d, c.pos);
      }
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
    soc: (c) => c.c.spawnMany(c.side, 'pink_gem', c.m === 2, 2, c.side.units.indexOf(c.self) + 1),
  },
  restore: {
    endTurn: (c) => { for (let i = 0; i < c.m; i++) gain(c, 'hug'); },
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
      c.self.atk = 7 * c.m;
      c.self.hp = 7 * c.m;
      c.self.kw = [];
    },
  },
  farmer: {
    avenge: [3, 3],
    avengeFn: (c) => { for (let i = 0; i < c.m; i++) gain(c, 'sapling'); },
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
      if (c.side.persistent && c.p.slots[c.self.slot]) { c.p.slots[c.self.slot].atk += c.m; c.p.slots[c.self.slot].hp += 2 * c.m; }
      buff(c.self, c.m, 2 * c.m);
    },
  },
  witch: {
    rally: (c) => { for (let i = 0; i < c.m; i++) c.c.damage(c.c.randomEnemy(c.side), c.self.atk, c.self); },
  },
  warlock: {
    onRallyFriendly: (c) => c.c.perm(c.self, (u) => { u.hp += 3 * c.m; }, 0, 3 * c.m),
  },
  distant_land: {
    soc: (c) => buff(c.self, c.self.atk * c.m, c.self.hp * c.m),
  },
  ancient_name_brambor: {
    battlecry: (c) => slotBuff(c, slotIndex(c), c.m === 2 ? 10 : 0, c.m === 2 ? 10 : 0, ['divineShield']),
  },
  chosen_name: {
    battlecry: (c) => slotBuff(c, slotIndex(c), 11 * c.m, 11 * c.m),
  },
  andromeda_robin: {
    soc: (c) => {
      const dmg = (3 + (c.self.mem.imp ?? 0)) * c.m;
      const targets = sample(c.g, c.c.enemy(c.side).units.filter((u) => u.hp > 0), 4);
      for (const t of targets) c.c.damage(t, dmg, c.self);
      c.self.mem.imp = (c.self.mem.imp ?? 0) + c.m;
      c.c.perm(c.self, (u) => { u.mem.imp = (u.mem.imp ?? 0) + c.m; });
    },
  },

  // ===== Cloister =====
  green_gem: {
    deathrattle: (c) => {
      const n = 3 * c.m;
      for (const u of c.side.units) if (u !== c.self) buff(u, n, n);
      if (c.side.persistent) {
        for (const u of c.p.board) if (u.uid !== c.self.src) buff(u, n, n);
        for (const u of c.p.hand) buff(u, n, n);
        const src = c.self.src;
        c.c.after(c.side, () => {
          const u = c.p.board.find((x) => x.uid === src);
          if (u) destroyUnit(c.g, c.p, u);
        });
      }
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
    battlecry: (c) => {
      const rivals = c.g.players.filter((p) => p.alive && p !== c.p && p.board.length);
      for (let i = 0; i < c.m; i++) {
        const r = pick(c.g, rivals);
        if (r) discoverFrom(c, r.board.map((u) => u.cardId), `Discover a unit from ${r.name}'s army`, 1);
      }
    },
  },
  secret: {
    soc: (c) => { c.side.secrets.push(c.m === 2); },
  },
  songstress: {
    avenge: [3, 3],
    avengeFn: (c) => buff(pick(c.g, c.p.hand), 5 * c.m, 5 * c.m),
  },
  red_sea_snake: {
    rally: (c) => {
      const cands = c.side.units.filter((u) => u !== c.self && isTribe(u, 'cloister') && !has(u, 'venomous'));
      for (const u of sample(c.g, cands, c.m)) addKw(u, 'venomous');
    },
  },
  larva: {}, // handled at start of turn
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
    avenge: [3, 2],
    avengeFn: (c) => {
      addKw(c.self, 'divineShield');
      c.c.attackNow(c.self);
    },
  },
  shine_like_a_knife: {
    deathrattle: (c) => {
      for (const u of sample(c.g, c.side.units.filter((x) => x.hp > 0), 2 * c.m)) u.atk += c.self.atk;
    },
  },

  // ===== Alcove Prefex =====
  left_twinbot: {
    rally: (c) => {
      const r = c.side.units[c.side.units.indexOf(c.self) + 1];
      if (r) { buff(r, 2 * c.m, 2 * c.m); addKw(r, 'reborn'); }
    },
  },
  right_twinbot: {
    soc: (c) => {
      const l = c.side.units[c.side.units.indexOf(c.self) - 1];
      if (l) { addKw(l, 'reborn'); if (c.m === 2) buff(l, 4, 4); }
    },
  },
  tinker: {
    onPlay: (c) => { c.p.tinkerThisTier += c.m; },
  },
  sniper: {
    soc: (c) => {
      for (let i = 0; i < c.m; i++) {
        const live = c.c.enemy(c.side).units.filter((u) => u.hp > 0);
        const t = live[live.length - 1];
        if (t) c.c.damage(t, 50, c.self);
      }
    },
  },
  mod: {
    battlecry: (c) => {
      const r = c.board[c.board.indexOf(c.self) + 1];
      buff(r, c.self.atk, c.self.hp);
    },
  },
  chaos: {
    startTurn: (c) => {
      const times = 1 + c.p.battlecriesLastTurn;
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
    battlecry: (c) => {
      if (c.combat) return;
      if (c.m === 1) { c.p.slots[0].atk -= 5; c.p.slots[0].hp -= 5; }
      for (const r of c.g.players) {
        if (!r.alive || r === c.p) continue;
        if (c.m === 2) { r.slots[0].atk -= 5; r.slots[0].hp -= 5; }
        gainNew(c.g, r, 'virus');
      }
    },
  },
  robot_boy: {
    endTurn: (c) => {
      for (let i = 0; i < c.m; i++) gain(c, drawFromPool(c.g, (id) => def(id).tribe === 'neutral'));
    },
  },
  scientist: {
    battlecry: (c) => {
      c.p.alcoveAtkThisTier += 3 * c.m;
      if (c.combat) for (const u of c.board) if (isTribe(u, 'alcove')) u.atk += 3 * c.m;
    },
  },
  paradox: {
    battlecry: (c) => {
      const src = c.p.slots[0];
      const plain = c.p.slots.map((s, i) => [s, i] as [Slot, number]).filter(([s, i]) => i > 0 && !s.atk && !s.hp && !s.kw.length);
      for (const [, i] of sample(c.g, plain, c.m)) slotBuff(c, i, src.atk, src.hp, src.kw);
    },
  },
  warmech: {}, // stats computed from battlecry count
  may_danaris: {
    deathrattle: (c) => c.c.spawnMany(c.side, 'phoenix', c.m === 2, 1, c.pos),
  },
  golden_light: {
    deathrattle: (c) => {
      if (c.side.persistent) c.c.after(c.side, () => { c.p.health -= 1; });
    },
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
    onSellOther: (c, sold) => {
      if (def(sold.cardId).tier === 3) for (let i = 0; i < c.m; i++) gain(c, randomTier(c, 2));
    },
  },
  pyro: {}, // see Combat.damage
  jeweler: {
    battlecry: (c) => { c.p.redGemBonus += c.m; },
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
      const amt = (4 + c.p.redGemBonus) * c.m;
      for (const u of c.board.slice(0, 3)) {
        if (rand(c.g) < 0.5) buff(u, amt, 0);
        else buff(u, 0, amt);
      }
    },
  },
  purveyor: {
    endTurn: (c) => { for (let i = 0; i < c.m; i++) gain(c, 'red_gem'); },
  },
  gargoil: {
    deathrattle: (c) => {
      const dmg = 10 * c.m;
      const mine = sample(c.g, c.side.units.filter((u) => u.hp > 0), 3);
      const theirs = sample(c.g, c.c.enemy(c.side).units.filter((u) => u.hp > 0), 3);
      for (const u of [...mine, ...theirs]) c.c.damage(u, dmg, c.self);
    },
  },
  miner: {
    rally: (c) => { for (let i = 0; i < c.m; i++) gain(c, 'red_gem'); },
  },
  bill_milton: {
    battlecry: (c) => { if (!c.combat) c.p.quests.push({ kind: 'bill', have: 0, need: 8, reward: 12 * c.m }); },
  },
  gem_wizard: {}, // see battlecryTimes
  exploit: {
    target: 'unlocked',
    battlecry: (c) => {
      if (c.combat) { c.p.goldNextTurn += 5 * c.m; return; }
      const t = c.target as Unit | undefined;
      if (!t || t === c.self || t.mem.locked) return;
      destroyUnit(c.g, c.p, t);
      c.p.gold += 5 * c.m;
    },
  },

  // ===== Neutral =====
  sword: {
    battlecry: (c) => {
      const t = others(c.board, c.self)[0];
      if (t) t.atk += 4 * c.m;
      if (!c.combat) destroyUnit(c.g, c.p, c.self as Unit);
    },
  },
  shield_neutral: {
    battlecry: (c) => {
      const o = others(c.board, c.self);
      const t = o[o.length - 1];
      if (t) { buff(t, c.m, 2 * c.m); addKw(t, 'taunt'); }
      if (!c.combat) destroyUnit(c.g, c.p, c.self as Unit);
    },
  },
  pickaxe: {
    endTurn: (c) => { c.p.goldNextTurn += c.m; },
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
    battlecry: (c) => { c.p.upgradeCost = Math.max(0, c.p.upgradeCost - 3 * c.m); },
  },
  sarinee: {}, // see endTurnEffects
  broken_land: {
    battlecry: (c) => {
      const left = others(c.board, c.self).find((u) => !(u as Unit).mem?.locked);
      if (!left) return;
      const a = left.atk * c.m;
      const h = left.hp * c.m;
      if (c.combat) left.hp = 0;
      else sellUnit(c.g, c.p, left as Unit);
      const right = c.board[c.board.length - 1];
      buff(right, a, h);
    },
  },
  tom_judith: {}, // see combat deathrattle multiplier
  omni_gem: {
    battlecry: (c) => {
      const l = c.board[c.board.indexOf(c.self) - 1];
      if (!l) return;
      for (const k of sample(c.g, BONUS_KEYWORDS.filter((k) => !has(l, k)), 2 * c.m)) addKw(l, k);
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
