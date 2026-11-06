import { CONFIG, def, effStats, tribeOf } from './core';
import { EFFECTS } from './effects';
import { buy, play, reroll, sell, upgrade, chooseDiscover, validTargets, move } from './game';
import { buyCost, canUseHeroPower, heroDef, pickTrinket, trinketDef, useHeroPower } from './heroes';
import type { Discover, GameState, Player, Unit, Tribe } from './types';

/** Rough value of a unit for a bot. */
export function unitScore(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop' = 'hand'): number {
  const st = effStats(p, u, zone);
  const d = def(u.cardId);
  let s = st.atk * 0.9 + st.hp * 0.7 + d.tier * 5;
  if (u.golden) s += 10;
  const fav = p.favoriteTribe;
  if (fav && d.tribe === fav) s += 6 + 2 * d.tier;
  for (const k of st.kw) s += k === 'divineShield' ? st.atk * 0.4 + 4 : k === 'reborn' ? 4 : k === 'venomous' ? 8 : 2;
  if (u.cardId === 'virus' && !u.golden) s = -50;
  if (u.cardId === 'treasure') s = 4;
  return s;
}

function chooseFavorite(g: GameState, p: Player) {
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
    // sell any viruses on the board first? (viruses are never played unless golden)
    const idx = p.hand.findIndex((u) => !(u.cardId === 'virus' && !u.golden));
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
    while (p.discovers.length) chooseDiscover(g, p, 0);
  }
}

function worstBoardIndex(p: Player): number {
  let w = -1;
  let ws = Infinity;
  p.board.forEach((u, i) => {
    if (u.mem.locked) return;
    const s = unitScore(p, u, 'board');
    if (s < ws) { ws = s; w = i; }
  });
  return w;
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

export function aiTakeTurn(g: GameState, p: Player) {
  for (const u of [...p.hand]) {
    if (u.cardId === 'virus' && !u.golden) {
      // bots discard viruses (they can't be played safely)
      p.hand.splice(p.hand.indexOf(u), 1);
    }
  }
  if (p.trinketOffer) {
    const affordable = p.trinketOffer.filter((t) => trinketDef(t).cost <= p.gold);
    const best = affordable.sort((a, b) => trinketDef(b).cost - trinketDef(a).cost)[0];
    pickTrinket(g, p, best ?? null);
  }
  if (p.tier < targetTier(g.round) && p.gold >= p.upgradeCost) upgrade(g, p);
  else if (p.tier < CONFIG.maxTier && p.upgradeCost <= 1 && p.gold >= p.upgradeCost) upgrade(g, p);

  for (let guard = 0; guard < 30; guard++) {
    chooseFavorite(g, p);
    playHand(g, p);
    if (p.gold >= buyCost(p) && p.shop.length) {
      let bi = -1;
      let bs = -Infinity;
      p.shop.forEach((u, i) => {
        // triples are very valuable
        const copies = [...p.board, ...p.hand].filter((x) => x.cardId === u.cardId && !x.golden).length;
        const s = unitScore(p, u, 'shop') + copies * 12;
        if (s > bs) { bs = s; bi = i; }
      });
      const full = p.board.length >= CONFIG.boardSize;
      const worst = worstBoardIndex(p);
      const worstScore = worst >= 0 ? unitScore(p, p.board[worst], 'board') : -Infinity;
      if (bi >= 0 && (!full || bs > worstScore + 4) && p.hand.length < CONFIG.handSize) {
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
  // hero power with leftover gold
  const h = heroDef(p.hero);
  if (h && canUseHeroPower(g, p)) {
    const weakest = [...p.board].filter((u) => !u.mem.locked).sort((a, b) => unitScore(p, a, 'board') - unitScore(p, b, 'board'))[0];
    const target = h.target ? (h.id === 'eve_williams' ? weakest : p.board[0]) : undefined;
    if (!h.target || target) useHeroPower(g, p, target);
    while (p.discovers.length) chooseDiscover(g, p, 0);
  }
  playHand(g, p);
  arrange(p);
}

export function aiChooseDiscover(g: GameState, p: Player, d: Discover): number {
  let best = 0;
  let bs = -Infinity;
  d.options.forEach((id, i) => {
    const s = def(id).tier * 10 + def(id).atk * 0.3 + def(id).hp * 0.3 + (p.favoriteTribe === def(id).tribe ? 15 : 0);
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}
