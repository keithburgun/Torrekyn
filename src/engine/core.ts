import cardData from '../data/cards.json';
import type { Body, CardDef, GameState, Keyword, Player, Tribe, Unit } from './types';

export const CONFIG = {
  players: 6,
  startHealth: 24,
  /** the Tavern's top Tier; Tier 6 units exist but only come from special effects (like Tier 7 in Battlegrounds) */
  maxTier: 5,
  boardSize: 7,
  handSize: 10,
  buyCost: 3,
  sellValue: 1,
  rerollCost: 1,
  /** cost to upgrade TO tier n (index n) */
  upgradeCost: [0, 0, 5, 8, 10, 13], // to reach Tier 2, 3, 4, 5 (each drops 1 gold per turn until bought)
  shopSize: [0, 3, 4, 4, 4, 4],
  copiesPerTier: [0, 15, 13, 11, 9, 7, 5], // Tier 6: never in the Tavern
  /** 7 tribes exist; 3 are banned each match, so 4 are in play (plus Neutral) */
  tribesPerGame: 4,
  maxGold: 10,
  /** ceiling for maximum Gold including Investor / Horn of Horn bonuses (they used to grow without limit) */
  maxGoldCap: 20,
  heroChoices: 4,
};

export const TRIBE_NAMES: Record<Tribe, string> = cardData.tribes as Record<Tribe, string>;
export const ALL_TRIBES: Tribe[] = ['neverending', 'azure', 'kindred', 'brambor', 'cloister', 'alcove', 'demons'];

/** tokens that come from hero powers rather than the card list */
const HERO_TOKENS: CardDef[] = [
  { id: 'pumpkin', name: 'Pumpkin', tribe: 'neutral', tier: 1, atk: 1, hp: 1, keywords: [], token: true, allTribes: true,
    text: 'Has every tribe. Whenever another unit dies in combat, this gains its Deathrattle.',
    goldenText: 'Has every tribe. Whenever another unit dies in combat, this gains its Deathrattle.' },
  { id: 'dragon', name: 'Dragon', tribe: 'neutral', tier: 1, atk: 1, hp: 1, keywords: [], token: true, text: '', goldenText: '' },
];

export const CARDS: CardDef[] = [...(cardData.cards as CardDef[]), ...HERO_TOKENS];
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

/** Spells: in the Tavern (one slot each Refresh), never in the unit pool */
export const SPELLS: CardDef[] = CARDS.filter((c) => c.spell);
export function isSpell(b: { cardId: string } | string): boolean {
  return !!BY_ID.get(typeof b === 'string' ? b : b.cardId)?.spell;
}
/**
 * "Units in the Tavern have +X/+Y for the rest of the game" (Potato Gem: all units; Sapling: Brambor). Kept on the
 * player by tribe ('all' for every unit); new Tavern units get it as they appear, and the ones there now get it too.
 */
export function addShopBuff(p: Player, key: Tribe | 'all', atk: number, hp: number, src: string) {
  if (!Array.isArray(p.shopBuff)) p.shopBuff = [];
  const e = p.shopBuff.find((x) => x.key === key && x.src === src);
  if (e) { e.a += atk; e.h += hp; } else p.shopBuff.push({ key, src, a: atk, h: hp });
  for (const u of p.shop) if (!isSpell(u) && (key === 'all' || isTribe(u, key))) { u.atk += atk; u.hp += hp; addEnch(u, src, atk, hp); }
}
export function applyShopBuffs(p: Player, u: Unit) {
  if (!Array.isArray(p.shopBuff)) return;
  for (const e of p.shopBuff) if (e.key === 'all' || isTribe(u, e.key as Tribe)) { u.atk += e.a; u.hp += e.h; addEnch(u, e.src, e.a, e.h); }
}

/** the units in a player's hand (Spells left out): what "units in your hand" effects touch */
export function handUnits(p: Player): Unit[] {
  return p.hand.filter((u) => !isSpell(u));
}

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
export function addKw(b: { kw: Keyword[]; mem?: Record<string, number | undefined> }, k: Keyword) {
  if (!b.kw.includes(k)) b.kw.push(k);
  // a keyword given for good makes a temporary one (Pink Gem's Shield, Purple Gem's Reborn) permanent
  else if (b.mem && k === 'divineShield' && b.mem.tmpShield) delete b.mem.tmpShield;
  else if (b.mem && k === 'reborn' && b.mem.tmpReborn) delete b.mem.tmpReborn;
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
  return { ...u, kw: [...u.kw], mem: { ...u.mem }, ...(u.ench ? { ench: u.ench.map((e) => ({ ...e, ...(e.k ? { k: [...e.k] } : {}) })) } : {}) };
}

/** note where a unit's gain came from (merged per source) */
export function addEnch(u: Unit, s: string, a: number, h: number, k: string[] = []) {
  if (!a && !h && !k.length) return;
  const list = (u.ench ??= []);
  const e = list.find((x) => x.s === s);
  if (e) { e.a += a; e.h += h; if (k.length) e.k = [...new Set([...(e.k ?? []), ...k])]; }
  else list.push({ s, a, h, ...(k.length ? { k: [...k] } : {}) });
}
export function enchTotal(u: Unit): [number, number] {
  return (u.ench ?? []).reduce<[number, number]>((t, e) => [t[0] + e.a, t[1] + e.h], [0, 0]);
}

/** remember who gave a "your X units have +N" bonus (shown on the cards it applies to) */
export function noteHave(p: Player, key: string, src: string, a: number, h: number) {
  const m = ((p.haveSrc ??= {})[key] ??= {});
  const v = (m[src] ??= [0, 0]);
  v[0] += a; v[1] += h;
}

/** a unit's "have" bonuses, piece by piece, for the Enchantments panel */
export function ownerBonusParts(p: Player, b: Body): { s: string; a: number; h: number; everywhere: boolean }[] {
  const out: { s: string; a: number; h: number; everywhere: boolean }[] = [];
  const fromSources = (key: string, a: number, h: number, fallback: string) => {
    let ra = a, rh = h;
    for (const [s, [sa, sh]] of Object.entries(p.haveSrc?.[key] ?? {})) {
      const ta = Math.min(sa, ra), th = Math.min(sh, rh);
      if (ta || th) out.push({ s, a: ta, h: th, everywhere: true });
      ra -= ta; rh -= th;
    }
    if (ra > 0 || rh > 0) out.push({ s: fallback, a: Math.max(0, ra), h: Math.max(0, rh), everywhere: true });
  };
  const d = def(b.cardId);
  if (!d.spell) for (const t of ALL_TRIBES) {
    if (!(d.allTribes || d.tribe === t)) continue;
    fromSources(`tribe:${t}`, p.tribeAtk?.[t] ?? 0, p.tribeHp?.[t] ?? 0, `${TRIBE_NAMES[t]} bonuses`);
  }
  if (p.trinkets?.includes('bronze_compass') && isTribe(b, 'neverending')) out.push({ s: 'Purple Bracer', a: 12, h: 0, everywhere: true });
  if (isTribe(b, 'alcove') && p.alcoveAtkThisTier) fromSources('alcove', p.alcoveAtkThisTier, 0, 'Scientist');
  if ((b.cardId === 'left_twinbot' || b.cardId === 'right_twinbot') && p.twinBonus) fromSources('twin', p.twinBonus, 0, 'Twinbot');
  if (b.cardId === 'owl' && p.owlsSummoned) out.push({ s: `${p.owlsSummoned} Owl${p.owlsSummoned === 1 ? '' : 's'} summoned`, a: mult(b) * p.owlsSummoned, h: 2 * mult(b) * p.owlsSummoned, everywhere: false });
  if (b.cardId === 'warmech' && p.deathrattlesGame) out.push({ s: `${p.deathrattlesGame} Deathrattle${p.deathrattlesGame === 1 ? '' : 's'} triggered`, a: 3 * mult(b) * p.deathrattlesGame, h: mult(b) * p.deathrattlesGame, everywhere: false });
  if (b.cardId === 'medic') {
    const miss = Math.max(0, (p.maxHealth ?? CONFIG.startHealth) - p.health);
    if (miss) out.push({ s: `${miss} Health missing`, a: 0, h: 2 * mult(b) * miss, everywhere: false });
  }
  return out;
}

export function mult(b: Body): number {
  return b.golden ? 2 : 1;
}

export function tribeOf(b: Body): Tribe {
  return def(b.cardId).tribe;
}

/** Is this unit of the tribe? (The Pumpkin counts as every tribe.) */
export function isTribe(b: Body | string, t: Tribe): boolean {
  const d = def(typeof b === 'string' ? b : b.cardId);
  return d.tribe === t || (!!d.allTribes && t !== 'neutral');
}

/** Permanent "+Attack for this tribe" bonuses that apply to a card (all of them for the Pumpkin). */
export function tribeHpFor(p: Player, cardId: string): number {
  const d = def(cardId);
  if (d.spell) return 0;
  if (!d.allTribes) return p.tribeHp?.[d.tribe] ?? 0;
  return Object.values(p.tribeHp ?? {}).reduce((s, v) => s + (v ?? 0), 0);
}

export function tribeAtkFor(p: Player, cardId: string): number {
  const d = def(cardId);
  if (!d.allTribes) return p.tribeAtk[d.tribe] ?? 0;
  return Object.values(p.tribeAtk).reduce((s, v) => s + (v ?? 0), 0);
}

export function displayName(b: Body): string {
  return (b.golden ? 'Golden ' : '') + def(b.cardId).name;
}

/**
 * Bonuses a player gives to all their units of a kind, wherever the unit is (hand, army, or summoned during a
 * battle): tribe Attack buffs, Purple Bracer (bronze_compass), Scientist, War Mech's growth. Not baked into the unit's stats.
 */
export function ownerBonus(p: Player, b: Body): { atk: number; hp: number } {
  let atk = tribeAtkFor(p, b.cardId);
  let hp = tribeHpFor(p, b.cardId);
  if (p.trinkets?.includes('bronze_compass') && isTribe(b, 'neverending')) atk += 12; // Purple Bracer
  if (isTribe(b, 'alcove')) atk += p.alcoveAtkThisTier ?? 0; // Scientist
  if (b.cardId === 'left_twinbot' || b.cardId === 'right_twinbot') { atk += p.twinBonus ?? 0; }
  if (b.cardId === 'owl') {
    // +1/+2 per Owl summoned this game (Golden: double)
    atk += mult(b) * (p.owlsSummoned ?? 0);
    hp += 2 * mult(b) * (p.owlsSummoned ?? 0);
  }
  if (b.cardId === 'warmech') {
    // +3/+1 per Deathrattle triggered this game (Golden: double)
    atk += 3 * mult(b) * (p.deathrattlesGame ?? 0);
    hp += 1 * mult(b) * (p.deathrattlesGame ?? 0);
  }
  if (b.cardId === 'medic') {
    // +2 Health (Golden +4) per Health your hero is missing
    hp += 2 * mult(b) * Math.max(0, (p.maxHealth ?? CONFIG.startHealth) - p.health);
  }
  return { atk, hp };
}

/** Stats a unit shows / brings into combat, including auras that are not baked in. */
export function effStats(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop', index = -1) {
  const bonus = ownerBonus(p, u);
  let atk = u.atk + bonus.atk;
  let hp = u.hp + bonus.hp;
  const kw = [...u.kw];
  void zone; void index; // (slots used to add their bonuses here; slots no longer have bonuses)
  return { atk: Math.max(0, atk), hp: Math.max(1, hp), kw };
}

export function log(p: Player, msg: string) {
  p.log.push(msg);
  if (p.log.length > 60) p.log.shift();
}
