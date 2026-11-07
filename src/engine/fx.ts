/**
 * Effect events for the human player, so the UI can show each effect happening (src/ui/fxPlayer.ts):
 * which card (or your hero) did it, what it buffed, which cards it gave you, gold, and counters that
 * ticked up. Effects are wrapped with `withFx`; it compares your units before and after and queues an
 * event on `p.fx`. Bots and simulations skip all of this.
 */
import { def, effStats } from './core';
import type { GameState, Player, Unit } from './types';

export type FxPhase = 'shop' | 'end' | 'combat' | 'start';

export interface FxEvent {
  phase: FxPhase;
  /** unit that did it (by uid), or the hero */
  src?: number;
  hero?: boolean;
  /** name to show, e.g. "Shopkeep" or "Coffee Run" */
  name: string;
  /** what kind of trigger, e.g. "Battlecry", "End of turn" */
  label: string;
  buffs: { uid: number; atk: number; hp: number; kw: string[] }[];
  /** new cards in your hand / new units in your army */
  gains: number[];
  summons: number[];
  gold: number;
  goldNext: number;
  /** counters that changed: key "hero", "quest" or "u<uid>", with the new text */
  counters: { key: string; text: string }[];
}

/** Progress shown on a card ("2/4"), if it has one. */
export function unitCounter(u: Unit): string | null {
  if (u.cardId === 'shopkeep') return `${(u.mem.buys ?? 0) % 4}/4`;
  if (u.cardId === 'larva') return `${u.mem.turns ?? 0}/${u.golden ? 2 : 3}`;
  if (u.cardId === 'scout') return `T${Math.min(5, 1 + (u.mem.age ?? 0))}`;
  if (u.cardId === 'andromeda_robin') return `${3 + (u.mem.imp ?? 0)} dmg`;
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

export const tracking = (g: GameState, p: Player) => p.human && !g.simulateAll;

interface Snap {
  units: Map<number, { atk: number; hp: number; kw: string[]; zone: 'board' | 'hand' }>;
  gold: number;
  goldNext: number;
  counters: Map<string, string>;
}

function snap(g: GameState, p: Player): Snap {
  const units = new Map<number, { atk: number; hp: number; kw: string[]; zone: 'board' | 'hand' }>();
  const counters = new Map<string, string>();
  p.board.forEach((u, i) => {
    const s = effStats(p, u, 'board', i);
    units.set(u.uid, { atk: s.atk, hp: s.hp, kw: [...s.kw], zone: 'board' });
  });
  p.hand.forEach((u) => units.set(u.uid, { atk: u.atk, hp: u.hp, kw: [...u.kw], zone: 'hand' }));
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
  if (depth > 0 || !tracking(g, p)) {
    depth++;
    try { return fn(); } finally { depth--; }
  }
  const before = snap(g, p);
  depth++;
  try {
    return fn();
  } finally {
    depth--;
    const after = snap(g, p);
    const ev: FxEvent = {
      phase, src: who.unit?.uid, hero: who.hero, name: who.name ?? (who.unit ? def(who.unit.cardId).name : ''), label,
      buffs: [], gains: [], summons: [], gold: after.gold - before.gold, goldNext: after.goldNext - before.goldNext, counters: [],
    };
    for (const [uid, a] of after.units) {
      const b = before.units.get(uid);
      if (!b) { (a.zone === 'hand' ? ev.gains : ev.summons).push(uid); continue; }
      if (b.zone !== a.zone) continue; // just moved (played)
      const kw = a.kw.filter((k) => !b.kw.includes(k));
      if (a.atk !== b.atk || a.hp !== b.hp || kw.length) ev.buffs.push({ uid, atk: a.atk - b.atk, hp: a.hp - b.hp, kw });
    }
    for (const [k, t] of after.counters) if (before.counters.get(k) !== t && t) ev.counters.push({ key: k, text: t });
    if (ev.buffs.length || ev.gains.length || ev.summons.length || ev.gold || ev.goldNext || ev.counters.length) (p.fx ??= []).push(ev);
  }
}
