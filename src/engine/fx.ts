/**
 * Effect events for the human player, so the UI can show each effect happening (src/ui/fxPlayer.ts):
 * which card (or your hero) did it, what it buffed, which cards it gave you, gold, and counters that
 * ticked up. Effects are wrapped with `withFx`; it compares your units before and after and queues an
 * event on `p.fx`. Bots and simulations skip all of this.
 */
import { addEnch, def, enchTotal } from './core';
import type { GameState, Player, Unit } from './types';

export type FxPhase = 'shop' | 'end' | 'combat' | 'start';

export interface FxEvent {
  phase: FxPhase;
  /** unit that did it (by uid), or the hero */
  src?: number;
  hero?: boolean;
  /** name to show, e.g. "Shopkeep" or "Coffee Run" */
  name: string;
  /** what kind of trigger, e.g. "Arrive", "End of turn" */
  label: string;
  buffs: { uid: number; atk: number; hp: number; kw: string[] }[];
  /** new cards in your hand / new units in your army */
  gains: number[];
  summons: number[];
  gold: number;
  goldNext: number;
  /** counters that changed: key "hero", "quest" or "u<uid>", with the new text */
  counters: { key: string; text: string }[];
  /** part of a run of repeated Arrive effects: played at double speed */
  fast?: boolean;
}

/** a hero power that kicks in without changing anything by itself (e.g. Derby Pocket's extra Arrive): just show it */
export function heroPing(g: GameState, p: Player, name: string, label: string) {
  if (!tracking(g, p)) return;
  (p.fx ??= []).push({ phase, hero: true, name, label, buffs: [], gains: [], summons: [], gold: 0, goldNext: 0, counters: [] });
}

/** Progress shown on a card ("2/4"), if it has one. */
export function unitCounter(u: Unit): string | null {
  if (u.cardId === 'lake') return u.mem.done ? 'Done!' : `${u.mem.buys ?? 0}/3`;
  if (u.cardId === 'corn_snail') return u.mem.done ? null : `${u.mem.spells ?? 0}/3`;
  if (u.cardId === 'shopkeep') return `${(u.mem.buys ?? 0) % 4}/4`;
  if (u.cardId === 'larva') { if (u.mem.done) return 'Done!'; const left = (u.golden ? 2 : 3) - (u.mem.turns ?? 0); return `${left} turn${left === 1 ? '' : 's'} left`; }
  if (u.cardId === 'scout') return `T${Math.min(5, 1 + (u.mem.age ?? 0))}`;
  if (u.cardId === 'commitment') { const n = (1 + (u.mem.imp ?? 0)) * (u.golden ? 2 : 1); return `+${n}/+${n}`; }
  if (u.cardId === 'green_gem') { const n = (1 + (u.mem.imp ?? 0)) * (u.golden ? 2 : 1); return `+${n}/+${n}`; }
  if (u.cardId === 'pumpkin') {
    const n = Object.keys(u.mem).filter((k) => k.startsWith('dr_')).length;
    return n ? `${n} DR` : null;
  }
  return null;
}

/** set by heroes.ts: hero progress text (e.g. "Coffee Run 2/5"), so this module doesn't import heroes */
export const fxHooks: { heroProgress: (g: GameState, p: Player) => string } = { heroProgress: () => '' };

let phase: FxPhase = 'shop';
export const setFxPhase = (ph: FxPhase) => { phase = ph; };
export const getFxPhase = () => phase;

export const tracking = (g: GameState, p: Player) => p.human && !g.simulateAll;

interface Snap {
  units: Map<number, { atk: number; hp: number; kw: string[]; zone: 'board' | 'hand' | 'shop' }>;
  gold: number;
  goldNext: number;
  counters: Map<string, string>;
}

/**
 * Where a unit's gains came from (the zoomed card's Enchantments panel): what an effect gave each of your units, less what
 * it already noted itself (addEnch). Runs for everyone, also bots and simulations, so a unit's list is the same either way.
 */
function enchSnap(p: Player) {
  const m = new Map<number, { u: Unit; id: string; atk: number; hp: number; kw: string[]; e: [number, number] }>();
  for (const u of [...p.board, ...p.hand, ...p.shop]) if (!m.has(u.uid)) m.set(u.uid, { u, id: u.cardId, atk: u.atk, hp: u.hp, kw: [...u.kw], e: enchTotal(u) });
  return m;
}
function noteEnch(p: Player, before: Map<number, { u: Unit; id: string; atk: number; hp: number; kw: string[]; e: [number, number] }>, src: string) {
  for (const u of [...p.board, ...p.hand, ...p.shop]) {
    const b = before.get(u.uid);
    if (!b || b.u !== u || b.id !== u.cardId) continue; // (a transformed unit starts over)
    const e = enchTotal(u);
    const a = u.atk - b.atk - (e[0] - b.e[0]), h = u.hp - b.hp - (e[1] - b.e[1]);
    const kw = u.kw.filter((k) => !b.kw.includes(k) && !(u.ench ?? []).some((x) => x.k?.includes(k)));
    addEnch(u, src, Math.max(0, a), Math.max(0, h), kw);
  }
}

function snap(g: GameState, p: Player): Snap {
  const units = new Map<number, { atk: number; hp: number; kw: string[]; zone: 'board' | 'hand' | 'shop' }>();
  const counters = new Map<string, string>();
  // (a unit's own stats, without "your X units have +N" bonuses: those just become true, with no animation —
  // Ashlie, Romance, Castleabra, Medic, War Mech; only what's given to a unit animates)
  p.board.forEach((u) => units.set(u.uid, { atk: u.atk, hp: u.hp, kw: [...u.kw], zone: 'board' }));
  p.hand.forEach((u) => units.set(u.uid, { atk: u.atk, hp: u.hp, kw: [...u.kw], zone: 'hand' }));
  // the shop too, so a shop unit that gets something (Tinker) shows it; new shop units are just a Refresh
  p.shop.forEach((u) => { if (!units.has(u.uid)) units.set(u.uid, { atk: u.atk, hp: u.hp, kw: [...u.kw], zone: 'shop' }); });
  for (const u of [...p.board, ...p.hand]) {
    const c = unitCounter(u);
    if (c) counters.set(`u${u.uid}`, c);
  }
  counters.set('hero', fxHooks.heroProgress(g, p));
  counters.set('quest', p.quests.map((q) => `${q.have}/${q.need}`).join(','));
  return { units, gold: p.gold, goldNext: p.goldNextTurn, counters };
}

let depth = 0;

/**
 * Run an effect and, for the human, queue an event describing what it changed. Effects triggered from
 * inside another effect count toward the outer one.
 */
export function withFx<T>(g: GameState, p: Player, who: { unit?: Unit; hero?: boolean; name?: string }, label: string, fn: () => T): T {
  const srcName = who.name ?? (who.unit ? def(who.unit.cardId).name : '');
  if (depth > 0) {
    depth++;
    try { return fn(); } finally { depth--; }
  }
  const eb = enchSnap(p);
  if (!tracking(g, p)) {
    depth++;
    try { return fn(); } finally { depth--; noteEnch(p, eb, srcName); peebSync(g, p); }
  }
  const before = snap(g, p);
  depth++;
  try {
    return fn();
  } finally {
    depth--;
    noteEnch(p, eb, srcName);
    const after = snap(g, p);
    const ev: FxEvent = {
      phase, src: who.unit?.uid, hero: who.hero, name: who.name ?? (who.unit ? def(who.unit.cardId).name : ''), label,
      buffs: [], gains: [], summons: [], gold: after.gold - before.gold, goldNext: after.goldNext - before.goldNext, counters: [],
    };
    for (const [uid, a] of after.units) {
      const b = before.units.get(uid);
      if (!b) { if (a.zone !== 'shop') (a.zone === 'hand' ? ev.gains : ev.summons).push(uid); continue; }
      if (b.zone !== a.zone) continue; // just moved (played)
      const kw = a.kw.filter((k) => !b.kw.includes(k));
      if (a.atk !== b.atk || a.hp !== b.hp || kw.length) ev.buffs.push({ uid, atk: a.atk - b.atk, hp: a.hp - b.hp, kw });
    }
    for (const [k, t] of after.counters) if (before.counters.get(k) !== t && t) ev.counters.push({ key: k, text: t });
    if (ev.buffs.length || ev.gains.length || ev.summons.length || ev.gold || ev.goldNext || ev.counters.length) (p.fx ??= []).push(ev);
    peebSync(g, p);
  }
}

/**
 * Turtlepult: whenever a friendly unit (itself too) gains stats (Attack and/or Health), it gains +2 Health (Golden: +4), once per
 * unit that gained. Each army unit remembers the stats it was last seen with (mem.pa, mem.pv); any rise since is a gain. Runs after every
 * shop effect and action, so nothing has to report its Health gains. A unit just played starts fresh (see play).
 * A Turtlepult's own gain counts for the other Turtlepults, but only gains from the event itself: what they get
 * from this doesn't count again (once per event, no loops).
 */
let peebBusy = false;
export function peebSync(g: GameState, p: Player) {
  if (peebBusy) return;
  const delta = new Map<Unit, number>();
  let total = 0;
  for (const u of p.board) {
    const up = (u.mem.pv !== undefined && u.hp > u.mem.pv) || (u.mem.pa !== undefined && u.atk > u.mem.pa);
    if (up) { delta.set(u, 1); total++; }
    u.mem.pv = u.hp;
    u.mem.pa = u.atk;
  }
  if (total <= 0) return;
  peebBusy = true;
  try {
    for (const pb of p.board.filter((u) => u.cardId === 'peebnup_bubber')) {
      const others = delta.size; // (itself included: "a friendly unit"; what it gets from this doesn't count again)
      if (others > 0) withFx(g, p, { unit: pb }, 'Ability', () => { pb.hp += 2 * others * (pb.golden ? 2 : 1); });
      pb.mem.pv = pb.hp;
      pb.mem.pa = pb.atk;
    }
  } finally { peebBusy = false; }
}
