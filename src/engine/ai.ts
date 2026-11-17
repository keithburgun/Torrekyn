/**
 * Bots. One brain with a profile (types.ts BotProfile):
 *  - feature switches (`f`), so every improvement can be measured against the old behaviour in the arena
 *    (tests/arena.test.ts) and lower skill levels can switch them off;
 *  - `noise`: random error on every evaluation;
 *  - `blunder`: chance each turn of an outright mistake.
 * The Expert bot has every switch on and no noise.
 */
import { CONFIG, def, effStats, isTribe, rand, shuffle, tribeOf } from './core';
import { Combat } from './combat';
import { EFFECTS, GEMS, scoutTier } from './effects';
import { buy, play, reroll, sell, upgrade, chooseDiscover, validTargets, move, toggleFreeze, handLocked, maxGoldFor, startTurn, endTurnEffects } from './game';
import { getFxPhase, setFxPhase } from './fx';
import { buyCost, canUseHeroPower, pickTrinket, powerCost, powersOf, trinketDef, useHeroPower } from './heroes';
import type { BotProfile, Discover, GameState, Player, Unit, Tribe } from './types';
import cardValues from '../data/cardValues.json';

/** measured battle worth of each card's ability, in +1/+1s [normal, golden] (tests/cardvalues.test.ts) */
const ABILITY = cardValues as unknown as Record<string, [number, number]>;

/** every feature switch the bot knows */
export const FEATURES = ['level', 'triples', 'tribe', 'discover', 'hero', 'freeze', 'value', 'econ', 'arrange', 'reroll', 'simbuy', 'spend', 'powerFirst', 'growth', 'hold', 'smartsell', 'place', 'hand', 'engine'] as const;
export type Feature = (typeof FEATURES)[number];

export const BASELINE: BotProfile = { noise: 0, blunder: 0, f: Object.fromEntries(FEATURES.map((k) => [k, false])) };
/** features the Expert uses (the others were measured and didn't help: see DESIGN_NOTES "Bots") */
const EXPERT_OFF: Feature[] = ['simbuy', 'powerFirst', 'engine'];
export const EXPERT: BotProfile = { noise: 0, blunder: 0, f: Object.fromEntries(FEATURES.map((k) => [k, !EXPERT_OFF.includes(k)])) };

/** Hero Powers ranked by how well Expert bots did with them (800-game balance run), best first; for Abragail's picks */
const POWER_RANK = ['may_danaris', 'trevor_l', 'clover', 'andromeda_robin', 'venice_gorn', 'gelf_lanz', 'eve_williams', 'bill_milton', 'derby_pocket', 'bunny_wizard', 'omar_evans', 'mazrael_bettencourt', 'croh_vosh', 'locas_clare'];

const prof = (p: Player): BotProfile => p.bot ?? EXPERT;
const on = (p: Player, k: Feature) => prof(p).f?.[k] ?? EXPERT.f![k] ?? false;
/** tuning numbers, with the Expert's values as defaults */
export const KNOBS: Record<string, number> = { valueK: 2.4, tierW: 3.5, atkW: 0.9, hpW: 0.7, lvl3: 4, lvl4: 6, lvl5: 8, cheap: 1, lowHp: 0, spare: 0, econK: 1.6, simOpps: 3, simN: 3, simShuffles: 2, rerollGold: 1, rerollBar: 1.15, simBuyK: 40, simBuyTop: 3, trip2: 60, trip1: 10, tribeW: 3, tribeTierW: 1, lazy: 0, keep: 0, growthK: 0.6, growthTurns: 5, engK: 0.5, engTurns: 5, engSeeds: 2, engTop: 4 };
const knob = (p: Player, k: string) => prof(p).x?.[k] ?? EXPERT.x?.[k] ?? KNOBS[k];
/** evaluation noise for this bot (uniform, symmetric) */
const jitter = (g: GameState, p: Player, scale = 10) => ((prof(p).noise ?? 0) ? (rand(g) * 2 - 1) * (prof(p).noise ?? 0) * scale : 0);

/**
 * Economy worth (gold and extra cards) that battles can't measure, in unit-score points. Set by hand;
 * a card in hand is worth roughly one unit's score. `scale` = how many times it pays off.
 */
const ECON: Record<string, number> = {
  memory: 4, storyteller: 4, command: 5, remember: 10, librarian: 10, restore: 12, farmer: 3, honeysuckle_brambor: 5,
  computer: 8, robot_boy: 10, shopkeep: 4, intern: 3, purveyor: 10, miner: 6, pickaxe: 6, scout: 4, grief: 8,
  omni_gem: 30, exploit: 8, golden_light: 12, potato_lord: 10, jeweler: 3, distant_land: 8, larva: 12, adder: 6, invisible_hand: 0, builder: 5,
  life: 14, beast_vine: 16, hug: 6,
};

/**
 * Units that grow every turn (or every battle): roughly how many stats [Attack, Health] they add per turn, for the
 * whole army. Battles can't see this (cardValues measures one turn), so it's set by hand. Golden doubles it.
 */
const GROWTH: Record<string, [number, number]> = {
  architect: [0, 2], chaos: [4, 4], aerial_drone: [3, 6], andromeda_robin: [0, 6],
  patchwork: [1, 4], shadow_place: [4, 4], warlock: [0, 4], funeral: [0, 2], vampire: [0, 2], locas: [2, 1], commitment: [3, 3],
  ocean_sky: [2, 2], intern: [0, 0], builder: [0, 4], peebnup_bubber: [0, 3], elemental: [2, 2],
};

/** stats a growing unit adds over the turns it will still play, in unit-score points */
function growthScore(g: GameState, p: Player, u: Unit): number {
  let gr = GROWTH[u.cardId];
  if (u.cardId === 'bill_milton') gr = [maxGoldFor(g, p), maxGoldFor(g, p)];
  if (!gr) return 0;
  const m = u.golden ? 2 : 1;
  const turns = Math.max(1, Math.min(knob(p, 'growthTurns'), 15 - g.round));
  return (gr[0] * knob(p, 'atkW') + gr[1] * knob(p, 'hpW')) * m * turns * knob(p, 'growthK');
}

/** the game the bot is currently thinking about (so unit scores can look at the round) */
let G: GameState | undefined;

/** Rough value of a unit for a bot. */
export function unitScore(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop' = 'hand', g?: GameState): number {
  const st = effStats(p, u, zone);
  const d = def(u.cardId);
  let s = st.atk * knob(p, 'atkW') + st.hp * knob(p, 'hpW') + d.tier * knob(p, 'tierW');
  if (u.golden) s += 10;
  if (on(p, 'value')) s += knob(p, 'valueK') * (ABILITY[u.cardId]?.[u.golden ? 1 : 0] ?? 0);
  if (on(p, 'econ')) {
    let e = (u.mem.done ? 0 : ECON[u.cardId] ?? 0) * knob(p, 'econK') * (u.golden ? 1.8 : 1);
    if (u.cardId === 'grief' && p.tier >= CONFIG.maxTier) e = 0;
    // Battlecries and Discovers pay off when played; once on the board only recurring effects still matter
    if (zone === 'board' && ['command', 'remember', 'librarian'].includes(u.cardId)) e = 0;
    s += e;
  }
  const gg = g ?? G;
  if (gg && on(p, 'growth')) s += growthScore(gg, p, u);
  // Abandon eats the unit on its left every turn: worth less than its stats suggest
  if (on(p, 'growth') && u.cardId === 'abandon') s -= 10;
  const fav = p.favoriteTribe;
  if (fav && (d.tribe === fav || (on(p, 'tribe') && isTribe(u, fav)))) s += on(p, 'tribe') ? knob(p, 'tribeW') + knob(p, 'tribeTierW') * d.tier : 6 + 2 * d.tier;
  for (const k of st.kw) s += k === 'divineShield' ? st.atk * 0.4 + 4 : k === 'reborn' ? 4 : k === 'venomous' ? 8 : 2;
  return s;
}

function chooseFavorite(g: GameState, p: Player) {
  const pref = prof(p).tribe;
  if (pref && g.tribes.includes(pref)) { p.favoriteTribe = pref; return; }
  if (on(p, 'tribe')) {
    // re-evaluated every turn until mid-game: the tribe with the most value on board/hand, weighted by tier
    if (p.favoriteTribe && g.round >= 7) return;
    const w = new Map<Tribe, number>();
    for (const u of [...p.board, ...p.hand]) {
      const t = tribeOf(u);
      if (t !== 'neutral') w.set(t, (w.get(t) ?? 0) + def(u.cardId).tier + (u.golden ? 3 : 0));
    }
    let best: Tribe | undefined;
    let n = 0;
    for (const [t, c] of w) if (c > n) { best = t; n = c; }
    if (best && n >= 3) p.favoriteTribe = best;
    return;
  }
  if (p.favoriteTribe) return;
  const counts = new Map<Tribe, number>();
  for (const u of [...p.board, ...p.hand]) {
    const t = tribeOf(u);
    if (t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: Tribe | undefined;
  let n = 0;
  for (const [t, c] of counts) if (c > n) { best = t; n = c; }
  if (best && n >= 2) p.favoriteTribe = best;
}

function targetTier(round: number) {
  if (round >= 10) return 5;
  if (round >= 8) return 4;
  if (round >= 5) return 3;
  if (round >= 2) return 2;
  return 1;
}

/** Level up the Tavern this turn? */
function wantsLevel(g: GameState, p: Player): boolean {
  if (p.tier >= CONFIG.maxTier || p.gold < p.upgradeCost) return false;
  if (!on(p, 'level')) return p.tier < targetTier(g.round) || p.upgradeCost <= 1;
  // a curve (round to reach each tier), level when it's cheap, and hold off when low on Health with a thin army
  const curve = [0, 1, 2, knob(p, 'lvl3'), knob(p, 'lvl4'), knob(p, 'lvl5')];
  const behind = g.round >= curve[p.tier + 1];
  const cheap = p.upgradeCost <= knob(p, 'cheap');
  // leave gold for at least this many buys after leveling when ahead of the curve
  if (!behind && !cheap) return false;
  if (knob(p, 'lowHp') && p.health <= knob(p, 'lowHp') && p.board.length < 6 && !cheap) return false;
  if (!cheap && p.gold - p.upgradeCost < knob(p, 'spare') * CONFIG.buyCost && g.round > 3) return false;
  return true;
}

function bestTarget(g: GameState, p: Player, u: Unit): number | undefined {
  const cands = validTargets(p, u.cardId).filter((b) => b !== u);
  if (!cands.length) return undefined;
  const best = (xs: Unit[], f: (b: Unit) => number) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));
  if (u.cardId === 'exploit') {
    const worst = cands.reduce((a, b) => (unitScore(p, a) < unitScore(p, b) ? a : b));
    return unitScore(p, worst) < 25 ? worst.uid : undefined;
  }
  if (u.cardId === 'therapist' || u.cardId === 'shield_neutral') {
    const noTaunt = cands.filter((b) => !b.kw.includes('taunt'));
    const pool = noTaunt.length ? noTaunt : cands;
    return pool.reduce((a, b) => (effStats(p, a, 'board').hp > effStats(p, b, 'board').hp ? a : b)).uid;
  }
  if (on(p, 'place')) {
    const kw = (b: Unit) => effStats(p, b, 'board').kw;
    // Green Gem: Windfury is worth most on the hardest hitter that doesn't have it yet
    if (u.cardId === 'green_gem') {
      const pool = cands.filter((b) => !kw(b).includes('windfury'));
      return best(pool.length ? pool : cands, (b) => effStats(p, b, 'board').atk).uid;
    }
    // Purple Gem: Reborn on the best unit without it
    if (u.cardId === 'purple_gem') {
      const pool = cands.filter((b) => !kw(b).includes('reborn'));
      return best(pool.length ? pool : cands, (b) => unitScore(p, b, 'board')).uid;
    }
  }
  return cands.reduce((a, b) => (effStats(p, a, 'board').hp > effStats(p, b, 'board').hp ? a : b)).uid;
}

const SELL_NOW = ['omni_gem', 'exploit'];

/** cards the bot keeps in hand for now: Larva hatches there, Green Ninja joins from there, Scout grows before it's sold */
function holdInHand(p: Player, u: Unit): boolean {
  if (!on(p, 'hold') || p.hand.length >= CONFIG.handSize - 1) return false;
  if ((u.cardId === 'larva' && !u.mem.done) || u.cardId === 'orange_ninja') return true;
  if (u.cardId === 'scout') return scoutTier(u) < Math.min(CONFIG.maxTier, p.tier + 1);
  return false;
}

/** sell this card the moment it's on the board? */
function sellNow(p: Player, u: Unit): boolean {
  if (SELL_NOW.includes(u.cardId)) return true;
  if (on(p, 'hold') && u.cardId === 'scout') return true;
  return false;
}

/** cards that are all Battlecry: once it has happened, the body is worth a Gold more than a slot (late on) */
const isSpell = (id: string) => GEMS.includes(id) || id === 'sword' || id === 'pickaxe'; // (a function: GEMS isn't loaded yet when this module starts)

/** play one card from hand and deal with what follows (Discovers, cards sold on arrival, spent Gem bodies) */
function playOne(g: GameState, p: Player, idx: number) {
  const u = p.hand[idx];
  let pos = u.cardId === 'mod' ? 0 : p.board.length;
  // Banners: between two units, so both get the bonus
  if (on(p, 'place') && (u.cardId === 'silver_banner' || u.cardId === 'gold_banner') && p.board.length >= 2) pos = 1;
  const r = play(g, p, idx, pos, EFFECTS[u.cardId]?.target ? bestTarget(g, p, u) : undefined);
  if (!r.ok) return false;
  while (p.discovers.length) chooseDiscover(g, p, aiChooseDiscover(g, p, p.discovers[0]));
  // cards that pay off when sold (Omni-Gem, Exploit, a grown Scout, Message) are sold right away; so are spent
  // Gem bodies once the army is big enough that the slot matters more
  const spent = on(p, 'hand') && isSpell(u.cardId) && p.board.length >= 5 && !u.golden;
  const sold = p.board.findIndex((b) => b.uid === u.uid && (sellNow(p, b) || spent));
  if (sold >= 0) {
    sell(g, p, sold);
    while (p.discovers.length) chooseDiscover(g, p, aiChooseDiscover(g, p, p.discovers[0]));
  }
  return true;
}

function playHand(g: GameState, p: Player) {
  for (let guard = 0; guard < 25; guard++) {
    const ok = p.hand.map((u, i) => [u, i] as const).filter(([u]) => !handLocked(p, u) && !holdInHand(p, u));
    if (!ok.length) return;
    if (!on(p, 'hand')) {
      // the old way: only ever looks at the first playable card
      const idx = ok[0][1];
      if (p.board.length >= CONFIG.boardSize) {
        const worst = worstBoardIndex(p);
        if (worst < 0 || (unitScore(p, p.board[worst], 'board') >= unitScore(p, p.hand[idx]) && !sellNow(p, p.hand[idx]))) return;
        sell(g, p, worst);
      }
      if (!playOne(g, p, idx)) return;
      continue;
    }
    // best card first (sell-on-arrival cards count as a sure gain)
    const val = (u: Unit) => unitScore(p, u) + (sellNow(p, u) ? 1000 : 0);
    const [bu, bi] = ok.reduce((a, b) => (val(b[0]) > val(a[0]) ? b : a));
    if (p.board.length >= CONFIG.boardSize) {
      const worst = worstBoardIndex(p);
      const extra = on(p, 'engine') && worst >= 0 && !sellNow(p, bu) ? engineValue(g, p, bu) : 0;
      if (worst < 0 || val(bu) + extra <= boardScore(p, p.board[worst])) {
        // nothing in hand beats the army; but a Gem played into a freed slot and sold again costs nothing extra,
        // so only when a swap was going to happen anyway (handled below)
        return;
      }
      sell(g, p, worst);
      // the slot is free for a moment: run every spare Gem through it first, then the new unit takes it
      for (let k = 0; k < 10; k++) {
        const gi = p.hand.findIndex((u) => isSpell(u.cardId) && !u.golden && !handLocked(p, u) && u !== bu);
        if (gi < 0 || p.board.length >= CONFIG.boardSize) break;
        const before = p.board.length;
        if (!playOne(g, p, gi)) break;
        if (p.board.length > before) break; // it stayed (small army): the slot is used
      }
      if (p.board.length >= CONFIG.boardSize) continue;
      const ni = p.hand.indexOf(bu);
      if (ni < 0 || !playOne(g, p, ni)) return;
      continue;
    }
    if (!playOne(g, p, bi)) return;
  }
}

function worstBoardIndex(p: Player): number {
  let w = -1;
  let ws = Infinity;
  p.board.forEach((u, i) => {
    if (u.mem.locked) return;
    let s = boardScore(p, u);
    // don't sell half of a triple
    if (on(p, 'triples') && !u.golden && [...p.board, ...p.hand].filter((x) => x.cardId === u.cardId && !x.golden).length >= 2) s += 15;
    if (s < ws) { ws = s; w = i; }
  });
  return w;
}

/** a unit's worth in the army: its score plus (lookahead bots, full army) what it keeps generating */
const keepCache = new Map<string, number>();
function boardScore(p: Player, u: Unit): number {
  let s = unitScore(p, u, 'board');
  const g = G;
  if (g && on(p, 'engine') && p.board.length >= CONFIG.boardSize - 1) {
    const key = `${p.id}:${g.round}:${u.uid}:${p.board.map((b) => `${b.uid}.${b.atk}.${b.hp}`).join(',')}`;
    let v = keepCache.get(key);
    if (v === undefined) {
      if (keepCache.size > 2000) keepCache.clear();
      v = keepValue(g, p, u);
      keepCache.set(key, v);
    }
    s += v;
  }
  return s;
}

// ---------------- battle simulation (Expert positioning) ----------------
/** a throwaway copy of a player for simulated battles (battle effects can change hands, slots and gold) */
const simOwner = (p: Player): Player => JSON.parse(JSON.stringify({ ...p, log: [], ghost: undefined, lastOpponentBoard: [], lastFightBoard: [] }));

/** Armies the bot expects to face: its next opponent's (as last seen) first, then others. */
function field(g: GameState, p: Player): { owner: Player; board: Unit[]; tier: number }[] {
  const out: { owner: Player; board: Unit[]; tier: number }[] = [];
  const next = p.nextOpponent !== null && p.nextOpponent >= 0 ? g.players[p.nextOpponent] : undefined;
  const others = g.players.filter((q) => q !== p && q !== next && q.alive && q.lastFightBoard?.length);
  for (const q of [next, ...others].filter((q): q is Player => !!q && !!q.lastFightBoard?.length).slice(0, knob(p, 'simOpps'))) {
    out.push({ owner: simOwner(q), board: q.lastFightBoard!, tier: q.tier });
  }
  return out;
}

/** Share of simulated battles this army order wins (ties count half). Leaves the game untouched. */
function simScore(g: GameState, p: Player, order: Unit[], opps: ReturnType<typeof field>, n: number): number {
  const pool = { ...g.pool };
  const me = simOwner(p);
  let s = 0;
  let k = 0;
  for (const o of opps) {
    for (let i = 0; i < n; i++) {
      const c = new Combat(g, { p: me, board: order, tier: p.tier, persistent: false }, { p: o.owner, board: o.board, tier: o.tier, persistent: false });
      const w = c.run();
      s += w === 0 ? 1 : w === -1 ? 0.5 : 0;
      k++;
    }
  }
  for (const id of Object.keys(g.pool)) g.pool[id] = pool[id];
  return k ? s / k : 0;
}

/** Try several orders of the army in simulated battles and keep the best. */
function arrangeBySim(g: GameState, p: Player): boolean {
  if (p.board.length < 2 || p.board.some((u) => u.mem.locked)) return false;
  const opps = field(g, p);
  if (!opps.length) return false;
  arrange(p); // the rule-of-thumb order is the first candidate
  const base = [...p.board];
  const atk = (u: Unit) => effStats(p, u, 'hand').atk;
  const cands: Unit[][] = [
    base,
    [...base].sort((a, b) => atk(b) - atk(a)),
    [...base].sort((a, b) => atk(a) - atk(b)),
    [...base].reverse(),
  ];
  for (let i = 0; i < knob(p, 'simShuffles'); i++) cands.push(shuffle(g, base));
  let best = base;
  let bs = -1;
  for (const order of cands) {
    const sc = simScore(g, p, order, opps, knob(p, 'simN')) + (order === base ? 0.02 : 0);
    if (sc > bs) { bs = sc; best = order; }
  }
  for (let i = 0; i < best.length; i++) {
    const from = p.board.indexOf(best[i]);
    if (from !== i) move(p, from, i);
  }
  return true;
}

/** Abandon eats the unit on its left at End of Turn: feed it the weakest unit when the army is full, otherwise nothing */
function placeAbandon(p: Player) {
  const ai = p.board.findIndex((u) => u.cardId === 'abandon' && !u.mem.locked);
  if (ai < 0 || p.board.some((u) => u.mem.locked)) return;
  const ab = p.board[ai];
  let to = 0;
  if (p.board.length >= CONFIG.boardSize) {
    const rest = p.board.filter((u) => u !== ab);
    const worst = rest.reduce((a, b) => (unitScore(p, b, 'board') < unitScore(p, a, 'board') ? b : a));
    to = rest.indexOf(worst) + 1;
  }
  move(p, ai, to);
}

function arrange(p: Player) {
  // Taunts and Divine Shields toward the left, damage dealers that like to attack early, big stats in the middle
  const order = [...p.board].filter((u) => !u.mem.locked);
  const rank = (u: Unit) => {
    const kw = effStats(p, u, 'hand').kw;
    let r = 0;
    if (kw.includes('taunt')) r -= 3;
    if (kw.includes('divineShield')) r -= 2;
    if (EFFECTS[u.cardId]?.deathrattle) r += 2;
    if (u.cardId === 'mod' || u.cardId === 'abandon') r += 5;
    return r;
  };
  order.sort((a, b) => rank(a) - rank(b));
  // Mod gives its stats to the unit on its right: put it just left of the hardest hitter (not at the far right)
  const mod = order.findIndex((u) => u.cardId === 'mod');
  if (on(p, 'place') && mod >= 0 && order.length > 1) {
    const [m] = order.splice(mod, 1);
    const big = order.reduce((bi, u, i) => (effStats(p, u, 'hand').atk > effStats(p, order[bi], 'hand').atk ? i : bi), 0);
    order.splice(big, 0, m);
  }
  for (let i = 0; i < order.length; i++) {
    const from = p.board.indexOf(order[i]);
    if (from !== i && !p.board[i]?.mem.locked) move(p, from, i);
  }
}

/** How much the bot wants this shop unit right now. */
function shopScore(g: GameState, p: Player, u: Unit): number {
  const copies = [...p.board, ...p.hand].filter((x) => x.cardId === u.cardId && !x.golden).length;
  let s = unitScore(p, u, 'shop') + jitter(g, p);
  if (on(p, 'triples')) s += copies === 2 ? knob(p, 'trip2') : copies === 1 ? knob(p, 'trip1') : 0;
  else s += copies * 12;
  return s;
}

export function aiTakeTurn(g: GameState, p: Player) {
  G = g;
  while (p.discovers.length) chooseDiscover(g, p, aiChooseDiscover(g, p, p.discovers[0]));
  if (p.trinketOffer) {
    const affordable = p.trinketOffer.filter((t) => trinketDef(t).cost <= p.gold);
    const best = affordable.sort((a, b) => trinketDef(b).cost - trinketDef(a).cost)[0];
    pickTrinket(g, p, best ?? null);
  }
  const blunder = rand(g) < (prof(p).blunder ?? 0);
  // Treasure sells for 5 after a lost battle
  if (on(p, 'smartsell') && p.lostLast) {
    for (let i = p.board.length - 1; i >= 0; i--) if (p.board[i].cardId === 'treasure' && !p.board[i].mem.locked) sell(g, p, i);
  }
  if (wantsLevel(g, p) && !(blunder && rand(g) < 0.5)) upgrade(g, p);
  // Hero Powers that pay off over time go first, as long as a buy is still affordable afterwards
  if (on(p, 'powerFirst') && !blunder) {
    for (const h of powersOf(p)) {
      if (h.passive || h.target || h.targetShop || h.id === 'locas_clare' || !canUseHeroPower(g, p, h.id)) continue;
      if (p.gold - powerCost(g, p, h) < CONFIG.buyCost && g.round > 2) continue;
      useHeroPower(g, p, undefined, h.id);
      while (p.discovers.length) chooseDiscover(g, p, aiChooseDiscover(g, p, p.discovers[0]));
    }
  }

  for (let guard = 0; guard < 30; guard++) {
    chooseFavorite(g, p);
    playHand(g, p);
    // beginners sometimes just stop shopping
    if (guard > 0 && rand(g) < knob(p, 'lazy')) break;
    if (p.shop.some((u) => p.gold >= buyCost(p, u.cardId))) {
      let bi = -1;
      let bs = -Infinity;
      const scored = p.shop.map((u, i) => {
        const raw = p.gold < buyCost(p, u.cardId) ? -Infinity : blunder ? rand(g) * 100 : shopScore(g, p, u);
        return { i, s: raw, raw };
      }).filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s);
      // Expert: test the best few in simulated battles (bought units join the army's right end, or replace the weakest)
      if (on(p, 'simbuy') && !blunder && scored.length > 1 && p.board.length >= 3) {
        const opps = field(g, p);
        if (opps.length) {
          const full = p.board.length >= CONFIG.boardSize;
          const worst = full ? worstBoardIndex(p) : -1;
          for (const c of scored.slice(0, knob(p, 'simBuyTop'))) {
            const army = p.board.filter((_, j) => j !== worst);
            army.push(p.shop[c.i]);
            c.s += knob(p, 'simBuyK') * simScore(g, p, army, opps, 2);
          }
          scored.sort((a, b) => b.s - a.s);
        }
      }
      // lookahead: the best few are played out over the next turns (engines that grow the army get their due)
      if (on(p, 'engine') && !blunder && scored.length) {
        for (const c of scored.slice(0, knob(p, 'engTop'))) {
          const e = engineValue(g, p, p.shop[c.i]);
          c.s += e;
          c.raw += e;
        }
        scored.sort((a, b) => b.s - a.s);
      }
      if (scored.length) { bi = scored[0].i; bs = scored[0].raw; }
      const full = p.board.length >= CONFIG.boardSize;
      const worst = worstBoardIndex(p);
      const worstScore = worst >= 0 ? boardScore(p, p.board[worst]) : -Infinity;
      // picky: with gold to spare, skip a shop unit that's clearly worse than the army's average and reroll instead
      let picky = false;
      if (on(p, 'reroll') && !blunder && bi >= 0 && p.board.length >= 4 && p.gold >= CONFIG.buyCost + CONFIG.rerollCost * knob(p, 'rerollGold')) {
        const avg = p.board.reduce((t, u) => t + unitScore(p, u, 'board'), 0) / p.board.length;
        picky = bs < avg * knob(p, 'rerollBar');
      }
      if (bi >= 0 && !picky && (!full || bs > worstScore + 4 + knob(p, 'keep')) && p.hand.length < CONFIG.handSize) {
        buy(g, p, bi);
        continue;
      }
    }
    if (p.freeRerolls || p.gold >= CONFIG.rerollCost + (p.gold >= 4 ? 0 : 99)) {
      reroll(g, p);
      continue;
    }
    break;
  }
  useHeroPowers(g, p);
  // leftover gold that can't buy anything: look for a triple piece or a strong unit to freeze for next turn
  if (on(p, 'spend') && !blunder) {
    const worthFreezing = () => p.shop.some((u) => {
      const copies = [...p.board, ...p.hand].filter((x) => x.cardId === u.cardId && !x.golden).length;
      return copies >= 2 || (copies === 1 && def(u.cardId).tier >= 3) || def(u.cardId).tier > p.tier;
    });
    for (let guard = 0; guard < 5 && p.gold >= CONFIG.rerollCost && p.gold < CONFIG.buyCost && !worthFreezing(); guard++) {
      if (!reroll(g, p).ok) break;
    }
  }
  playHand(g, p);
  if (!blunder && !(on(p, 'arrange') && arrangeBySim(g, p))) arrange(p);
  if (on(p, 'place')) placeAbandon(p);
  // keep a shop worth coming back to
  if (on(p, 'freeze') && !p.frozen && p.shop.some((u) => {
    const copies = [...p.board, ...p.hand].filter((x) => x.cardId === u.cardId && !x.golden).length;
    return copies >= 2 || (copies === 1 && def(u.cardId).tier >= 3);
  })) toggleFreeze(p);
}

function useHeroPowers(g: GameState, p: Player) {
  for (const h of powersOf(p)) {
    if (h.passive || !canUseHeroPower(g, p, h.id)) continue;
    if (on(p, 'hero')) {
      // Locas: only when it's a real steal
      if (h.id === 'locas_clare' && (p.shop.length * CONFIG.buyCost < powerCost(g, p, h) + 3 || CONFIG.handSize - p.hand.length < p.shop.length)) continue;
    } else if (h.id === 'locas_clare' && (p.shop.length < 3 || CONFIG.handSize - p.hand.length < 2)) continue;
    const weakest = [...p.board].filter((u) => !u.mem.locked).sort((a, b) => unitScore(p, a, 'board') - unitScore(p, b, 'board'))[0];
    // Doom Bauble: load the hardest-hitting unit in the Tavern
    const shopPick = h.targetShop ? [...p.shop].sort((a, b) => effStats(p, b, 'shop').atk - effStats(p, a, 'shop').atk)[0] : undefined;
    const target = h.targetShop ? shopPick : h.target ? weakest : undefined;
    if (!(h.target || h.targetShop) || target) useHeroPower(g, p, target, h.id);
    while (p.discovers.length) chooseDiscover(g, p, aiChooseDiscover(g, p, p.discovers[0]));
  }
}

export function aiChooseDiscover(g: GameState, p: Player, d: Discover): number {
  G = g;
  if (d.powers) {
    if (!on(p, 'hero')) return 0;
    const r = (id: string) => { const i = POWER_RANK.indexOf(id); return i < 0 ? 99 : i; };
    return d.options.reduce((b, id, i) => (r(id) < r(d.options[b]) ? i : b), 0);
  }
  let best = 0;
  let bs = -Infinity;
  d.options.forEach((id, i) => {
    const dd = def(id);
    let s: number;
    if (on(p, 'discover')) {
      // judge it like a shop unit, including triples
      const u = { uid: -1, cardId: id, golden: !!d.golden, atk: dd.atk * (d.golden ? 2 : 1), hp: dd.hp * (d.golden ? 2 : 1), kw: [...dd.keywords], mem: {} };
      s = shopScore(g, p, u);
    } else s = dd.tier * 10 + dd.atk * 0.3 + dd.hp * 0.3 + (p.favoriteTribe === dd.tribe ? 15 : 0);
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}

// ---------------- lookahead: what a card does for the army over the next turns ----------------
/**
 * Battle values and stats only see the army as it is now. Good players build engines: units whose abilities keep
 * growing the army turn after turn (and combos that multiply each other), whatever their printed stats. To see that,
 * the bot plays the next turns out in a private copy of the game, with and without a card, and measures the stats
 * the army GENERATES (beyond the printed stats of the cards in it): shop effects, End of Turn, battles (permanent
 * gains), and the next turn's shopping with a simple, synergy-minded policy.
 */
interface Ledger { base: Map<number, number> }

/** a private copy of the game for one player: their own state deep-copied, everything else shared but untouched */
function sandbox(g: GameState, p: Player, seed: number): { g: GameState; p: Player } {
  const pc = structuredClone({ ...p, log: [], history: [], lastOpponentBoard: [], lastFightBoard: [], ghost: undefined, fx: [] }) as Player;
  pc.human = false;
  pc.bot = { ...prof(p), f: { ...prof(p).f, engine: false, simbuy: false, arrange: false } };
  const players = g.players.map((q) => (q === p ? pc : q));
  const gc = { ...g, pool: { ...g.pool }, players, rng: seed, simulateAll: true, lastCombats: [] } as GameState;
  return { g: gc, p: pc };
}

/** a unit's stats, minus what wears off next turn (Pink Gem and the like) */
const statsOf = (p: Player, u: Unit, zone: 'board' | 'hand') => { const s = effStats(p, u, zone); return s.atk + s.hp - (u.mem.tmpAtk ?? 0) - (u.mem.tmpHp ?? 0); };
const printed = (u: Unit) => (def(u.cardId).atk + def(u.cardId).hp) * (u.golden ? 2 : 1);

function openLedger(p: Player): Ledger {
  const base = new Map<number, number>();
  for (const u of p.board) base.set(u.uid, statsOf(p, u, 'board'));
  for (const u of p.hand) base.set(u.uid, statsOf(p, u, 'hand'));
  return { base };
}
/** stats generated since the ledger opened: units still with you count what they've grown (new units: beyond their printed stats) */
function generated(p: Player, L: Ledger): number {
  let t = 0;
  for (const u of p.board) t += statsOf(p, u, 'board') - (L.base.get(u.uid) ?? printed(u));
  return t;
}

/** the tribe this army is built around (most units), for the sandbox's shopping */
function mainTribe(p: Player): Tribe | undefined {
  const n = new Map<Tribe, number>();
  for (const u of p.board) { const t = tribeOf(u); if (t !== 'neutral') n.set(t, (n.get(t) ?? 0) + 1); }
  let best: Tribe | undefined; let k = 0;
  for (const [t, c] of n) if (c > k) { best = t; k = c; }
  return p.favoriteTribe ?? best;
}

/** sandbox shopping: buy what fits the army (its tribe, triples, higher tiers), play it, swap out the smallest unit when full */
function sandboxShop(g: GameState, p: Player, keep: Set<number>) {
  const tribe = mainTribe(p);
  for (let k = 0; k < 4; k++) {
    if (!p.shop.length || p.gold < CONFIG.buyCost) break;
    const want = (u: Unit) => def(u.cardId).tier * 3 + (tribe && isTribe(u, tribe) ? 8 : 0)
      + ([...p.board, ...p.hand].some((x) => x.cardId === u.cardId && !x.golden) ? 6 : 0) + (u.atk + u.hp) * 0.05;
    const i = p.shop.reduce((b, u, j) => (want(u) > want(p.shop[b]) ? j : b), 0);
    if (p.gold < buyCost(p, p.shop[i].cardId) || !buy(g, p, i).ok) break;
    while (p.discovers.length) chooseDiscover(g, p, 0);
    for (let h = p.hand.length - 1; h >= 0; h--) {
      if (handLocked(p, p.hand[h])) continue;
      if (p.board.length >= CONFIG.boardSize) {
        let w = -1; let ws = Infinity;
        p.board.forEach((u, j) => { if (keep.has(u.uid) || u.mem.locked) return; const s = statsOf(p, u, 'board'); if (s < ws) { ws = s; w = j; } });
        if (w < 0) break;
        sell(g, p, w);
        while (p.discovers.length) chooseDiscover(g, p, 0);
      }
      const hu = p.hand[h];
      if (!hu) continue;
      play(g, p, h, p.board.length, EFFECTS[hu.cardId]?.target ? bestTarget(g, p, hu) : undefined);
      while (p.discovers.length) chooseDiscover(g, p, 0);
    }
  }
}

/** a battle in the sandbox against an army the bot has seen; permanent results (Remember, Deathrattle growth...) stay */
function sandboxBattle(g: GameState, p: Player, opp: { owner: Player; board: Unit[]; tier: number } | undefined) {
  if (!opp) return;
  const c = new Combat(g, { p, board: p.board, tier: p.tier, persistent: true }, { p: opp.owner, board: opp.board, tier: opp.tier, persistent: false });
  c.run();
  for (const fn of c.sides[0].afterFns) fn();
}

/**
 * Stats the army generates over this turn's end and the next turn, with `add` (bought now, played first) and/or
 * without `remove`. Returns [generated by the end of this turn, generated over the next turn].
 */
function playOut(g: GameState, p: Player, seed: number, add?: Unit, remove?: number, standIn = false): [number, number] {
  const phase = getFxPhase();
  const pool = { ...g.pool };
  const sb = sandbox(g, p, seed);
  const sg = sb.g; const sp = sb.p;
  const keep = new Set<number>();
  try {
    if (remove !== undefined) {
      const i = sp.board.findIndex((u) => u.uid === remove);
      if (i >= 0) {
        if (standIn) { const pl = plainCopy(sp.board[i], sp); sp.board[i] = pl; keep.add(pl.uid); } else sp.board.splice(i, 1);
      }
    }
    const L = openLedger(sp);
    if (add) {
      // the card is in the copy's shop or hand already: take it from there
      sp.shop = sp.shop.filter((x) => x.uid !== add.uid);
      sp.hand = sp.hand.filter((x) => x.uid !== add.uid);
      const u = structuredClone(add);
      keep.add(u.uid);
      L.base.set(u.uid, u.atk + u.hp); // what it grows from here counts (a plain stand-in grows nothing)
      if (sp.board.length >= CONFIG.boardSize) {
        let w = -1; let ws = Infinity;
        sp.board.forEach((b, j) => { const s = statsOf(sp, b, 'board'); if (s < ws) { ws = s; w = j; } });
        if (w >= 0) sp.board.splice(w, 1);
      }
      sp.hand.push(u);
      const pr = play(sg, sp, sp.hand.length - 1, sp.board.length, EFFECTS[u.cardId]?.target ? bestTarget(sg, sp, u) : undefined);
      if ((globalThis as { ENGINE_DEBUG?: boolean }).ENGINE_DEBUG) console.log('play', u.cardId, pr, sp.discovers.length, sp.board.length, sp.hand.length);
      while (sp.discovers.length) chooseDiscover(sg, sp, 0);
    }
    const opps = field(g, p);
    // the same luck in every play-out (with or without the card) at every step, so the difference is the card's doing
    const luck = (k: number) => { sg.rng = (seed + k * 0x51ed27) | 0; };
    luck(1); endTurnEffects(sg, sp);
    luck(2); sandboxBattle(sg, sp, opps[0]);
    const g1 = generated(sp, L);
    luck(3); startTurn(sg, sp);
    luck(4); sandboxShop(sg, sp, keep);
    luck(5); endTurnEffects(sg, sp);
    luck(6); sandboxBattle(sg, sp, opps[1] ?? opps[0]);
    return [g1, generated(sp, L) - g1];
  } catch (e) {
    if ((globalThis as { ENGINE_DEBUG?: boolean }).ENGINE_DEBUG) console.log('playOut failed', e);
    return [0, 0];
  } finally {
    for (const id of Object.keys(g.pool)) g.pool[id] = pool[id];
    setFxPhase(phase);
  }
}

/**
 * A stand-in with the same stats and keywords but no ability and no tribe: comparing a card with its stand-in leaves
 * the army the same size and shape (so the rest of the play-out goes the same way) and measures just the ability.
 */
function plainCopy(u: Unit, p?: Player): Unit {
  const st = p ? effStats(p, u, 'board') : { atk: u.atk, hp: u.hp, kw: u.kw };
  return { uid: u.uid, cardId: 'plain', golden: false, atk: st.atk, hp: st.hp, kw: [...st.kw], mem: {} };
}

/** engine value (in unit-score points) of buying `u` now, compared with a plain unit of the same stats */
function engineValue(g: GameState, p: Player, u: Unit): number {
  const seeds = knob(p, 'engSeeds');
  const left = Math.max(1, Math.min(knob(p, 'engTurns'), 15 - g.round));
  let d = 0;
  for (let k = 0; k < seeds; k++) {
    const seed = (g.rng ^ (k * 0x9e3779b1)) | 0;
    const [a1, a2] = playOut(g, p, seed, u);
    const [b1, b2] = playOut(g, p, seed, plainCopy(u));
    if ((globalThis as { ENGINE_DEBUG?: boolean }).ENGINE_DEBUG) console.log('eng', u.cardId, a1, a2, b1, b2, left);
    d += (a1 - b1) + (a2 - b2) * left;
  }
  return knob(p, 'engK') * 0.8 * (d / seeds);
}

/** the army's own play-out (no change), cached per board state */
const baseCache = new Map<string, [number, number]>();
function baseOut(g: GameState, p: Player, seed: number): [number, number] {
  const key = `${p.id}:${g.round}:${seed}:${p.board.map((u) => `${u.uid}.${u.atk}.${u.hp}`).join(',')}`;
  let v = baseCache.get(key);
  if (!v) {
    if (baseCache.size > 500) baseCache.clear();
    v = playOut(g, p, seed);
    baseCache.set(key, v);
  }
  return v;
}

/** engine value of a unit already in the army: what the army would lose without it */
function keepValue(g: GameState, p: Player, u: Unit): number {
  const seeds = knob(p, 'engSeeds');
  const left = Math.max(1, Math.min(knob(p, 'engTurns'), 15 - g.round));
  let d = 0;
  for (let k = 0; k < seeds; k++) {
    const seed = (g.rng ^ (k * 0x9e3779b1)) | 0;
    const [a1, a2] = baseOut(g, p, seed);
    const [b1, b2] = playOut(g, p, seed, undefined, u.uid, true);
    d += (a1 - b1) + (a2 - b2) * left;
  }
  return knob(p, 'engK') * 0.8 * (d / seeds);
}

/** for tests and tools: a card's lookahead value for this player right now */
export function engineValueForTest(g: GameState, p: Player, u: Unit): number { G = g; return engineValue(g, p, u); }
