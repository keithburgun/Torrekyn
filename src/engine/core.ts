import cardData from '../data/cards.json';
import type { Body, CardDef, GameState, Keyword, Player, Tribe, Unit } from './types';

export const CONFIG = {
  players: 6,
  startHealth: 45,
  damageCap: 15,
  maxTier: 5,
  boardSize: 7,
  handSize: 10,
  buyCost: 3,
  sellValue: 1,
  rerollCost: 1,
  /** cost to upgrade TO tier n (index n) */
  upgradeCost: [0, 0, 5, 7, 8, 9],
  shopSize: [0, 3, 4, 4, 5, 5],
  copiesPerTier: [0, 15, 13, 11, 9, 7],
  /** 7 tribes exist; 3 are banned each match, so 4 are in play (plus Neutral) */
  tribesPerGame: 4,
  maxGold: 10,
  heroChoices: 4,
};

export const TRIBE_NAMES: Record<Tribe, string> = cardData.tribes as Record<Tribe, string>;
export const ALL_TRIBES: Tribe[] = ['neverending', 'azure', 'kindred', 'brambor', 'cloister', 'alcove', 'demons'];

export const CARDS: CardDef[] = cardData.cards as CardDef[];
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function def(id: string): CardDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error('Unknown card ' + id);
  return d;
}

// ---------- RNG (mulberry32, state stored in the game so saves are deterministic) ----------
export function rand(g: GameState): number {
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function randInt(g: GameState, n: number): number {
  return Math.floor(rand(g) * n);
}
export function pick<T>(g: GameState, arr: T[]): T | undefined {
  return arr.length ? arr[randInt(g, arr.length)] : undefined;
}
export function shuffle<T>(g: GameState, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(g, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function sample<T>(g: GameState, arr: T[], n: number): T[] {
  return shuffle(g, arr).slice(0, n);
}

// ---------- keywords ----------
export function has(b: { kw: Keyword[] }, k: Keyword): boolean {
  return b.kw.includes(k);
}
export function addKw(b: { kw: Keyword[] }, k: Keyword) {
  if (!b.kw.includes(k)) b.kw.push(k);
}
export function removeKw(b: { kw: Keyword[] }, k: Keyword) {
  const i = b.kw.indexOf(k);
  if (i >= 0) b.kw.splice(i, 1);
}

// ---------- units ----------
export function makeUnit(g: GameState, cardId: string, golden = false): Unit {
  const d = def(cardId);
  const m = golden ? 2 : 1;
  return { uid: g.nextUid++, cardId, golden, atk: d.atk * m, hp: d.hp * m, kw: [...d.keywords], mem: {} };
}

export function cloneUnit(u: Unit): Unit {
  return { ...u, kw: [...u.kw], mem: { ...u.mem } };
}

export function mult(b: Body): number {
  return b.golden ? 2 : 1;
}

export function tribeOf(b: Body): Tribe {
  return def(b.cardId).tribe;
}

export function displayName(b: Body): string {
  return (b.golden ? 'Golden ' : '') + def(b.cardId).name;
}

/** Stats a unit shows / brings into combat, including auras that are not baked in. */
export function effStats(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop', index = -1) {
  let atk = u.atk;
  let hp = u.hp;
  const kw = [...u.kw];
  const tribe = tribeOf(u);
  atk += p.tribeAtk[tribe] ?? 0;
  if (tribe === 'alcove') atk += p.alcoveAtkThisTier;
  if (zone === 'shop' && tribe === 'alcove') {
    atk += p.tinkerThisTier;
    hp += p.tinkerThisTier;
  }
  if (u.cardId === 'warmech') {
    atk += 4 * mult(u) * p.battlecriesGame;
    hp += 2 * mult(u) * p.battlecriesGame;
  }
  if (zone === 'board' && index >= 0 && p.slots[index]) {
    const s = p.slots[index];
    atk += s.atk;
    hp += s.hp;
    for (const k of s.kw) if (!kw.includes(k)) kw.push(k);
  }
  return { atk: Math.max(0, atk), hp: Math.max(1, hp), kw };
}

export function log(p: Player, msg: string) {
  p.log.push(msg);
  if (p.log.length > 60) p.log.shift();
}
