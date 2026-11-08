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
import { EFFECTS } from './effects';
import { buy, play, reroll, sell, upgrade, chooseDiscover, validTargets, move, toggleFreeze, handLocked } from './game';
import { buyCost, canUseHeroPower, pickTrinket, powerCost, powersOf, trinketDef, useHeroPower } from './heroes';
import type { BotProfile, Discover, GameState, Player, Unit, Tribe } from './types';
import cardValues from '../data/cardValues.json';

/** measured battle worth of each card's ability, in +1/+1s [normal, golden] (tests/cardvalues.test.ts) */
const ABILITY = cardValues as unknown as Record<string, [number, number]>;

/** every feature switch the bot knows */
export const FEATURES = ['level', 'triples', 'tribe', 'discover', 'hero', 'freeze', 'value', 'econ', 'arrange', 'reroll', 'simbuy', 'spend', 'powerFirst'] as const;
export type Feature = (typeof FEATURES)[number];

export const BASELINE: BotProfile = { noise: 0, blunder: 0, f: Object.fromEntries(FEATURES.map((k) => [k, false])) };
/** features the Expert uses (the others were measured and didn't help: see DESIGN_NOTES "Bots") */
const EXPERT_OFF: Feature[] = ['level', 'simbuy', 'powerFirst'];
export const EXPERT: BotProfile = { noise: 0, blunder: 0, f: Object.fromEntries(FEATURES.map((k) => [k, !EXPERT_OFF.includes(k)])) };

/** Hero Powers ranked by how well Expert bots did with them (800-game balance run), best first; for Abragail's picks */
const POWER_RANK = ['may_danaris', 'trevor_l', 'clover', 'andromeda_robin', 'venice_gorn', 'gelf_lanz', 'eve_williams', 'bill_milton', 'derby_pocket', 'bunny_wizard', 'omar_evans', 'mazrael_bettencourt', 'croh_vosh', 'locas_clare'];

const prof = (p: Player): BotProfile => p.bot ?? EXPERT;
const on = (p: Player, k: Feature) => prof(p).f?.[k] ?? EXPERT.f![k] ?? false;
/** tuning numbers, with the Expert's values as defaults */
export const KNOBS: Record<string, number> = { valueK: 2.4, tierW: 3.5, atkW: 0.9, hpW: 0.7, lvl3: 5, lvl4: 8, lvl5: 10, cheap: 1, lowHp: 0, spare: 0, econK: 1.6, simOpps: 3, simN: 3, simShuffles: 2, rerollGold: 1, rerollBar: 1.3, simBuyK: 40, simBuyTop: 3, trip2: 60, trip1: 10, tribeW: 3, tribeTierW: 1, lazy: 0, keep: 0 };
const knob = (p: Player, k: string) => prof(p).x?.[k] ?? EXPERT.x?.[k] ?? KNOBS[k];
/** evaluation noise for this bot (uniform, symmetric) */
const jitter = (g: GameState, p: Player, scale = 10) => ((prof(p).noise ?? 0) ? (rand(g) * 2 - 1) * (prof(p).noise ?? 0) * scale : 0);

/**
 * Economy worth (gold and extra cards) that battles can't measure, in unit-score points. Set by hand;
 * a card in hand is worth roughly one unit's score. `scale` = how many times it pays off.
 */
const ECON: Record<string, number> = {
  memory: 4, storyteller: 4, command: 5, remember: 10, librarian: 10, restore: 12, farmer: 3, honeysuckle_brambor: 5,
  owl: 8, computer: 8, robot_boy: 10, shopkeep: 4, intern: 3, purveyor: 10, miner: 6, pickaxe: 6, scout: 4, grief: 6,
};

/** Rough value of a unit for a bot. */
export function unitScore(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop' = 'hand'): number {
  const st = effStats(p, u, zone);
  const d = def(u.cardId);
  let s = st.atk * knob(p, 'atkW') + st.hp * knob(p, 'hpW') + d.tier * knob(p, 'tierW');
  if (u.golden) s += 10;
  if (on(p, 'value')) s += knob(p, 'valueK') * (ABILITY[u.cardId]?.[u.golden ? 1 : 0] ?? 0);
  if (on(p, 'econ')) {
    let e = (ECON[u.cardId] ?? 0) * knob(p, 'econK') * (u.golden ? 1.8 : 1);
    if (u.cardId === 'grief' && p.tier >= CONFIG.maxTier) e = 0;
    // Battlecries and Discovers pay off when played; once on the board only recurring effects still matter
    if (zone === 'board' && ['command', 'remember', 'librarian', 'owl', 'grief'].includes(u.cardId)) e = 0;
    s += e;
  }
  const fav = p.favoriteTribe;
  if (fav && (d.tribe === fav || (on(p, 'tribe') && isTribe(u, fav)))) s += on(p, 'tribe') ? knob(p, 'tribeW') + knob(p, 'tribeTierW') * d.tier : 6 + 2 * d.tier;
  for (const k of st.kw) s += k === 'divineShield' ? st.atk * 0.4 + 4 : k === 'reborn' ? 4 : k === 'venomous' ? 8 : 2;
  if (u.cardId === 'virus' && !u.golden) s = -50;
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
  if (u.cardId === 'exploit') {
    const worst = cands.reduce((a, b) => (unitScore(p, a) < unitScore(p, b) ? a : b));
    return unitScore(p, worst) < 25 ? worst.uid : undefined;
  }
  if (u.cardId === 'therapist') {
    const noTaunt = cands.filter((b) => !b.kw.includes('taunt'));
    const pool = noTaunt.length ? noTaunt : cands;
    return pool.reduce((a, b) => (effStats(p, a, 'board').hp > effStats(p, b, 'board').hp ? a : b)).uid;
  }
  return cands.reduce((a, b) => (effStats(p, a, 'board').hp > effStats(p, b, 'board').hp ? a : b)).uid;
}

function playHand(g: GameState, p: Player) {
  for (let guard = 0; guard < 20; guard++) {
    // viruses are never played unless golden
    const idx = p.hand.findIndex((u) => !(u.cardId === 'virus' && !u.golden) && !handLocked(p, u));
    if (idx < 0) return;
    if (p.board.length >= CONFIG.boardSize) {
      const worst = worstBoardIndex(p);
      if (worst < 0 || unitScore(p, p.board[worst], 'board') >= unitScore(p, p.hand[idx])) return;
      sell(g, p, worst);
    }
    const u = p.hand[idx];
    const pos = u.cardId === 'mod' ? 0 : p.board.length;
    const r = play(g, p, idx, pos, EFFECTS[u.cardId]?.target ? bestTarget(g, p, u) : undefined);
    if (!r.ok) return;
    while (p.discovers.length) chooseDiscover(g, p, aiChooseDiscover(g, p, p.discovers[0]));
  }
}

function worstBoardIndex(p: Player): number {
  let w = -1;
  let ws = Infinity;
  p.board.forEach((u, i) => {
    if (u.mem.locked) return;
    let s = unitScore(p, u, 'board');
    // don't sell half of a triple
    if (on(p, 'triples') && !u.golden && [...p.board, ...p.hand].filter((x) => x.cardId === u.cardId && !x.golden).length >= 2) s += 15;
    if (s < ws) { ws = s; w = i; }
  });
  return w;
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
      const c = new Combat(g, { p: me, board: order, slots: me.slots, tier: p.tier, persistent: false }, { p: o.owner, board: o.board, slots: o.owner.slots, tier: o.tier, persistent: false });
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
  for (const u of [...p.hand]) {
    if (u.cardId === 'virus' && !u.golden) {
      // bots discard viruses (they can't be played safely)
      p.hand.splice(p.hand.indexOf(u), 1);
    }
  }
  while (p.discovers.length) chooseDiscover(g, p, aiChooseDiscover(g, p, p.discovers[0]));
  if (p.trinketOffer) {
    const affordable = p.trinketOffer.filter((t) => trinketDef(t).cost <= p.gold);
    const best = affordable.sort((a, b) => trinketDef(b).cost - trinketDef(a).cost)[0];
    pickTrinket(g, p, best ?? null);
  }
  const blunder = rand(g) < (prof(p).blunder ?? 0);
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
      if (scored.length) { bi = scored[0].i; bs = scored[0].raw; }
      const full = p.board.length >= CONFIG.boardSize;
      const worst = worstBoardIndex(p);
      const worstScore = worst >= 0 ? unitScore(p, p.board[worst], 'board') : -Infinity;
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
    if (p.gold >= CONFIG.rerollCost + (p.gold >= 4 ? 0 : 99)) {
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
