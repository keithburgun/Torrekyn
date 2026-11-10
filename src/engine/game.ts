import {
  ALL_TRIBES, CARDS, CONFIG, cloneUnit, def, displayName, effStats, isTribe, log, makeUnit, mult, pick, rand, randInt, sample, shuffle,
} from './core';
import { EFFECTS, battlecryTimes, hasBattlecry } from './effects';
import { runCombat } from './combat';
import { aiTakeTurn, aiChooseDiscover } from './ai';
import { setFxPhase, withFx } from './fx';
import { PERSONAS, matchPersonas, personaProfile } from './personas';
import { HEROES, heroHealth, buyCost, gainPower, heroDef, heroEndTurn, heroHooks, hasTrinket, offerTrinkets, shopBonus, GREATER_TRINKET_TURN, LESSER_TRINKET_TURN } from './heroes';
import type { Discover, GameState, Player, Slot, Tribe, Unit } from './types';

export const SAVE_VERSION = 5; // 5: Tier 6 and Poisonous (Stealth removed); older games in progress are dropped


function emptySlots(): Slot[] {
  return Array.from({ length: CONFIG.boardSize }, () => ({ atk: 0, hp: 0, kw: [] }));
}

export function newPlayer(id: number, name: string, human: boolean, avatar: number): Player {
  return {
    id, name, human, avatar,
    health: CONFIG.startHealth, alive: true, placement: 0,
    tier: 1, upgradeCost: CONFIG.upgradeCost[2], gold: 0, maxGoldBonus: 0, goldNextTurn: 0,
    board: [], hand: [], shop: [], slots: emptySlots(), frozen: false,
    tribeAtk: {}, alcoveAtkThisTier: 0, tinkerThisTier: 0, bannerBonus: 0, redGemBonus: 0,
    battlecriesThisTurn: 0, battlecriesLastTurn: 0, battlecriesGame: 0,
    quests: [], discovers: [], powers: [], usedPowers: [], heroMem: {}, heroSeeds: [], trinkets: [], trinketOffer: null, lastOpponent: null, lastOpponentBoard: [], nextOpponent: null, log: [],
  };
}

export function newGame(seed: number, humanName = 'You', tribes?: Tribe[], opts: { rating?: number } = {}): GameState {
  const g: GameState = {
    version: SAVE_VERSION, seed, rng: seed | 0, round: 0, phase: 'shop', players: [], pool: {},
    tribes: [], nextUid: 1, lastCombats: [], deadOrder: [],
  };
  g.tribes = tribes ?? sample(g, ALL_TRIBES, CONFIG.tribesPerGame);
  g.players.push(newPlayer(0, humanName, true, 0));
  for (let i = 1; i < CONFIG.players; i++) g.players.push(newPlayer(i, `Rival ${i}`, false, i));
  for (const c of CARDS) {
    if (c.token) continue;
    if (c.tribe !== 'neutral' && !g.tribes.includes(c.tribe)) continue;
    g.pool[c.id] = CONFIG.copiesPerTier[c.tier];
  }
  // heroes: the human is offered a choice, bots take random others
  // heroes tied to a tribe are left out when that tribe is banned (as in Battlegrounds)
  const heroIds = shuffle(g, HEROES.filter((h) => !h.needsTribe || g.tribes.includes(h.needsTribe)).map((h) => h.id));
  g.players[0].heroOffer = heroIds.slice(0, CONFIG.heroChoices);
  const rest = heroIds.slice(CONFIG.heroChoices);
  // rivals: personas near your rating when one is given (matchmaking), otherwise any; each plays a random champion
  const rivals = opts.rating !== undefined ? matchPersonas(opts.rating, g.players.length - 1, () => rand(g)) : sample(g, PERSONAS, g.players.length - 1);
  for (let i = 1; i < g.players.length; i++) {
    const p = g.players[i];
    p.hero = rest.length ? rest.shift()! : pick(g, heroIds)!;
    p.avatar = heroDef(p.hero)!.avatar;
    const per = rivals[i - 1];
    p.persona = per?.id;
    p.bot = per ? personaProfile(per) : undefined;
    p.name = per?.name ?? heroDef(p.hero)!.name;
  }
  g.phase = 'hero';
  return g;
}

export function selectHero(g: GameState, heroId: string) {
  const p = g.players[0];
  if (g.phase !== 'hero') return;
  p.hero = heroId;
  p.avatar = heroDef(heroId)?.avatar ?? 0;
  p.heroOffer = undefined;
  for (const pl of g.players) if (pl.hero) { pl.health = heroHealth(pl.hero); gainPower(g, pl, pl.hero); }
  startRound(g);
}

export const human = (g: GameState) => g.players[0];
export const alivePlayers = (g: GameState) => g.players.filter((p) => p.alive);

// ---------------- pool ----------------
export function inPlay(g: GameState, cardId: string) {
  const d = def(cardId);
  return !d.token && (d.tribe === 'neutral' || g.tribes.includes(d.tribe));
}

function returnToPool(g: GameState, u: Unit) {
  if (def(u.cardId).token || g.pool[u.cardId] === undefined) return;
  g.pool[u.cardId] += u.golden ? 3 : 1;
}

/** Draw a random card id from the pool matching the filter (weighted by copies left). Takes a copy. */
export function drawFromPool(g: GameState, filter: (id: string) => boolean, take = true): string | undefined {
  const ids = Object.keys(g.pool).filter((id) => g.pool[id] > 0 && filter(id));
  if (!ids.length) {
    // pool exhausted for this filter: fall back to any matching card definition
    const any = CARDS.filter((c) => !c.token && inPlay(g, c.id) && filter(c.id)).map((c) => c.id);
    return pick(g, any);
  }
  const total = ids.reduce((s, id) => s + g.pool[id], 0);
  let r = randInt(g, total);
  for (const id of ids) {
    r -= g.pool[id];
    if (r < 0) {
      if (take) g.pool[id]--;
      return id;
    }
  }
  return ids[0];
}

export function randomCardOfTier(g: GameState, tier: number, tribe?: Tribe): string | undefined {
  return drawFromPool(g, (id) => def(id).tier === tier && (!tribe || def(id).tribe === tribe));
}

// ---------------- rounds ----------------
export function startRound(g: GameState) {
  g.round++;
  g.phase = 'shop';
  pairOpponents(g);
  for (const p of alivePlayers(g)) startTurn(g, p);
}

function pairOpponents(g: GameState) {
  const alive = alivePlayers(g);
  let best: Player[] = alive;
  for (let attempt = 0; attempt < 30; attempt++) {
    const order = shuffle(g, alive);
    let ok = true;
    for (let i = 0; i + 1 < order.length; i += 2) {
      if (order[i].lastOpponent === order[i + 1].id && alive.length > 2) ok = false;
    }
    best = order;
    if (ok) break;
  }
  for (let i = 0; i < best.length; i += 2) {
    const a = best[i];
    const b = best[i + 1];
    if (b) {
      a.nextOpponent = b.id;
      b.nextOpponent = a.id;
    } else {
      a.nextOpponent = -1; // ghost
    }
  }
}

/** a player's maximum Gold this turn (round-based, plus bonuses, up to the cap) */
export function maxGoldFor(g: GameState, p: Player): number {
  return Math.min(CONFIG.maxGoldCap, Math.min(CONFIG.maxGold, 2 + g.round) + p.maxGoldBonus);
}

export function startTurn(g: GameState, p: Player) {
  if (g.round > 1) p.upgradeCost = Math.max(0, p.upgradeCost - 1);
  const base = maxGoldFor(g, p);
  p.gold = base + p.goldNextTurn;
  p.goldNextTurn = 0;
  p.battlecriesLastTurn = p.battlecriesThisTurn;
  p.battlecriesThisTurn = 0;
  p.usedPowers = [];
  setFxPhase('start');
  heroHooks.startTurn(g, p);
  if (g.round === LESSER_TRINKET_TURN) offerTrinkets(g, p, false);
  if (g.round === GREATER_TRINKET_TURN) offerTrinkets(g, p, true);
  // start-of-turn effects
  for (const u of [...p.board]) {
    const e = EFFECTS[u.cardId]?.startTurn;
    if (e) withFx(g, p, { unit: u }, 'Start of turn', () => e({ g, p, self: u, m: mult(u), board: p.board }));
  }
  for (const u of [...p.hand, ...p.board]) if (u.cardId === 'scout') withFx(g, p, { unit: u }, 'Growing up', () => { u.mem.age = (u.mem.age ?? 0) + 1; });
  for (const u of [...p.hand]) {
    if (u.cardId === 'larva') withFx(g, p, { unit: u }, 'Growing', () => {
      u.mem.turns = (u.mem.turns ?? 0) + 1;
      if (u.mem.turns >= (u.golden ? 2 : 3)) {
        const i = p.hand.indexOf(u);
        const id = randomCardOfTier(g, 5, 'cloister');
        if (id) {
          returnToPool(g, u);
          const nu = makeUnit(g, id, true);
          p.hand.splice(i, 1, nu);
          log(p, `Larva hatched into ${displayName(nu)}!`);
        }
      }
    });
  }
  setFxPhase('shop');
  if (p.frozen) p.frozen = false;
  else rollShop(g, p);
  drainOverflow(g, p);
  // "until your next turn" buffs wear off (Purple Gem)
  for (const u of [...p.board, ...p.hand]) {
    if (u.mem.tmpAtk || u.mem.tmpHp || u.mem.tmpReborn) {
      u.atk = Math.max(0, u.atk - (u.mem.tmpAtk ?? 0));
      u.hp = Math.max(1, u.hp - (u.mem.tmpHp ?? 0));
      if (u.mem.tmpReborn) u.kw = u.kw.filter((k) => k !== 'reborn');
      delete u.mem.tmpAtk; delete u.mem.tmpHp; delete u.mem.tmpReborn;
    }
  }
  // a skipped turn (Mazrael Bettencourt's first): no shop and no gold
  if (p.heroMem.skipRound === g.round) {
    for (const u of p.shop) returnToPool(g, u);
    p.shop = [];
    p.gold = 0;
  }
}

export function rollShop(g: GameState, p: Player) {
  for (const u of p.shop) returnToPool(g, u);
  p.shop = [];
  const n = CONFIG.shopSize[p.tier] + shopBonus(p);
  for (let i = 0; i < n; i++) {
    // Teched Up: no Tier 1 or 2 (a Tier 1-2 tavern still sees Tier 3)
    const teched = hasTrinket(p, 'healing_draught');
    const id = drawFromPool(g, (cid) => (teched ? def(cid).tier >= 3 && def(cid).tier <= Math.max(3, p.tier) : def(cid).tier <= p.tier));
    if (id) p.shop.push(makeUnit(g, id));
  }
}

// ---------------- gaining cards ----------------
export function gainCard(g: GameState, p: Player, u: Unit, how: 'buy' | 'gain' = 'gain'): boolean {
  if (p.hand.length >= CONFIG.handSize) {
    // hand full: the card waits and arrives when there's room (drainOverflow)
    (p.overflow ??= []).push(u);
    return false;
  }
  p.hand.push(u);
  for (const b of [...p.board]) {
    const e = EFFECTS[b.cardId]?.onGain;
    if (e) withFx(g, p, { unit: b }, 'Ability', () => e({ g, p, self: b, m: mult(b), board: p.board }, u, how));
  }
  if (how === 'buy') {
    for (const q of p.quests) {
      if (q.have >= q.need) continue;
      if ((q.kind === 'devotion' && isTribe(u, 'kindred')) || (q.kind === 'bill' && isTribe(u, 'demons'))) {
        q.have++;
        if (q.have >= q.need) completeQuest(g, p, q.kind, q.reward);
      }
    }
  }
  checkTriples(g, p);
  return true;
}

export function gainNew(g: GameState, p: Player, cardId: string | undefined, golden = false) {
  if (!cardId) return;
  gainCard(g, p, makeUnit(g, cardId, golden));
}

function completeQuest(g: GameState, p: Player, kind: 'devotion' | 'bill', reward: number) {
  if (kind === 'bill') {
    p.gold += reward;
    log(p, `Quest complete: gained ${reward} gold.`);
  } else {
    p.slots[0].kw.includes('reborn') || p.slots[0].kw.push('reborn');
    const right = Math.max(0, p.board.length - 1);
    p.slots[right].kw.includes('reborn') || p.slots[right].kw.push('reborn');
    log(p, 'Devotion complete: your left and right-most slots gained Reborn.');
  }
}

/** move waiting cards into the hand while it has room (they count as gained then) */
export function drainOverflow(g: GameState, p: Player) {
  while (p.overflow?.length && p.hand.length < CONFIG.handSize) gainCard(g, p, p.overflow.shift()!);
}

export function checkTriples(g: GameState, p: Player) {
  for (;;) {
    const counts = new Map<string, Unit[]>();
    // locked units count too: tripling frees them (the Golden copy arrives unlocked)
    for (const u of [...p.hand, ...p.board]) {
      if (u.golden) continue;
      const arr = counts.get(u.cardId) ?? [];
      arr.push(u);
      counts.set(u.cardId, arr);
    }
    const trip = [...counts.values()].find((a) => a.length >= 3);
    if (!trip) break;
    const three = trip.slice(0, 3);
    const d = def(three[0].cardId);
    const gold = makeUnit(g, d.id, true);
    for (const u of three) {
      gold.atk += u.atk - d.atk;
      gold.hp += u.hp - d.hp;
      for (const k of u.kw) if (!gold.kw.includes(k)) gold.kw.push(k);
      p.hand = p.hand.filter((x) => x !== u);
      p.board = p.board.filter((x) => x !== u);
    }
    gold.mem.tripleReward = 1;
    p.hand.push(gold);
    if (p.human) (p.tripleEvents ??= []).push({ cardId: d.id, uids: three.map((u) => u.uid), goldenUid: gold.uid });
    log(p, `Tripled ${d.name}! Golden ${d.name} added to hand.`);
  }
  drainOverflow(g, p);
}

// ---------------- discover ----------------
export function discoverOptions(g: GameState, filter: (id: string) => boolean, n = 3): string[] {
  const ids = Object.keys(g.pool).filter((id) => g.pool[id] > 0 && filter(id));
  const fallback = CARDS.filter((c) => !c.token && inPlay(g, c.id) && filter(c.id)).map((c) => c.id);
  const src = ids.length >= n ? ids : [...new Set([...ids, ...fallback])];
  return sample(g, src, n);
}

export function queueDiscover(g: GameState, p: Player, options: string[], reason: string, golden = false, unlockTier?: number) {
  if (!options.length) return;
  const d: Discover = { options, reason, golden, ...(unlockTier ? { unlockTier } : {}) };
  if (p.human && !g.simulateAll) p.discovers.push(d);
  else {
    const choice = aiChooseDiscover(g, p, d);
    takeDiscover(g, p, d, choice);
  }
}

/** Discover a Hero Power (Abragail): the first one replaces Well-Studied, the second is added. */
export function queuePowerDiscover(g: GameState, p: Player, options: string[], reason: string) {
  if (!options.length) return;
  const d: Discover = { options, reason, powers: true };
  if (p.human && !g.simulateAll) p.discovers.push(d);
  else takeDiscover(g, p, d, aiChooseDiscover(g, p, d));
}

function takeDiscover(g: GameState, p: Player, d: Discover, idx: number) {
  const id = d.options[Math.max(0, Math.min(idx, d.options.length - 1))];
  if (d.powers) {
    gainPower(g, p, id, 'abragail');
    log(p, `Learned ${heroDef(id)?.power}.`);
    return;
  }
  if (g.pool[id] > 0) g.pool[id]--;
  const u = makeUnit(g, id, !!d.golden);
  if (d.unlockTier) u.mem.unlockTier = d.unlockTier;
  gainCard(g, p, u);
}

/** a card in hand that can't be played until your Tavern reaches its tier (Mazrael Bettencourt) */
export function handLocked(p: Player, u: Unit): boolean {
  return (u.mem.unlockTier ?? 0) > p.tier;
}

export function chooseDiscover(g: GameState, p: Player, idx: number) {
  const d = p.discovers.shift();
  if (d) takeDiscover(g, p, d, idx);
}

// ---------------- shop actions ----------------
export type ActionResult = { ok: true } | { ok: false; reason: string };
const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

function busy(p: Player) {
  return p.discovers.length > 0;
}

export function buy(g: GameState, p: Player, shopIdx: number): ActionResult {
  if (busy(p)) return fail('Choose a card first');
  const u = p.shop[shopIdx];
  if (!u) return fail('Nothing there');
  const cost = buyCost(p, u.cardId);
  if (p.gold < cost) return fail('Not enough gold');
  if (p.hand.length >= CONFIG.handSize) return fail('Your hand is full');
  p.gold -= cost;
  p.shop.splice(shopIdx, 1);
  heroHooks.onBuy(g, p, u);
  if (isTribe(u, 'alcove') && p.tinkerThisTier) {
    u.atk += p.tinkerThisTier;
    u.hp += p.tinkerThisTier;
  }
  gainCard(g, p, u, 'buy');
  for (const b of [...p.board]) {
    const e = EFFECTS[b.cardId]?.onBuy;
    if (e) withFx(g, p, { unit: b }, 'Ability', () => e({ g, p, self: b, m: mult(b), board: p.board }, u));
  }
  return OK;
}

export function sellValue(u: Unit, p?: Player) {
  if (u.cardId === 'treasure' && p?.lostLast) return 5 * mult(u); // only after losing your last battle
  return CONFIG.sellValue + (u.mem.sellBonus ?? 0); // Intern's growth
}

export function sell(g: GameState, p: Player, boardIdx: number): ActionResult {
  if (busy(p)) return fail('Choose a card first');
  const u = p.board[boardIdx];
  if (!u) return fail('Nothing there');
  if (u.mem.locked) return fail('That unit is locked');
  sellUnit(g, p, u);
  return OK;
}

export function sellUnit(g: GameState, p: Player, u: Unit) {
  const i = p.board.indexOf(u);
  if (i < 0) return;
  p.board.splice(i, 1);
  p.gold += sellValue(u, p);
  returnToPool(g, u);
  const onSell = EFFECTS[u.cardId]?.onSell;
  if (onSell) withFx(g, p, { unit: u }, 'Sold', () => onSell({ g, p, self: u, m: mult(u), board: p.board }));
  heroHooks.onSell(g, p, u);
  for (const b of [...p.board]) {
    const e = EFFECTS[b.cardId]?.onSellOther;
    if (e) withFx(g, p, { unit: b }, 'Ability', () => e({ g, p, self: b, m: mult(b), board: p.board }, u));
  }
}

/** Remove a unit from the board without selling it (destroyed / consumed). */
export function destroyUnit(g: GameState, p: Player, u: Unit) {
  const i = p.board.indexOf(u);
  if (i < 0) return; // already gone (a repeated Battlecry destroying itself again): don't return it to the pool twice
  p.board.splice(i, 1);
  returnToPool(g, u);
}

export function needsTarget(cardId: string): boolean {
  return !!EFFECTS[cardId]?.target;
}

export function validTargets(p: Player, cardId: string): Unit[] {
  const t = EFFECTS[cardId]?.target;
  if (!t) return [];
  return p.board.filter((u) => !(t === 'unlocked' && u.mem.locked));
}

export function play(g: GameState, p: Player, handIdx: number, pos: number, targetUid?: number): ActionResult {
  if (busy(p)) return fail('Choose a card first');
  const u = p.hand[handIdx];
  if (!u) return fail('Nothing there');
  if (p.board.length >= CONFIG.boardSize) return fail('Your army is full');
  if (handLocked(p, u)) return fail(`Unlocks at Tavern Tier ${u.mem.unlockTier}`);
  delete u.mem.unlockTier;
  p.hand.splice(handIdx, 1);
  pos = Math.max(0, Math.min(pos, p.board.length));
  p.board.splice(pos, 0, u);
  const target = targetUid !== undefined ? p.board.find((b) => b.uid === targetUid) : undefined;
  if (hasBattlecry(u.cardId)) runBattlecry(g, p, u, target);
  const onPlay = EFFECTS[u.cardId]?.onPlay;
  if (onPlay) withFx(g, p, { unit: u }, 'Played', () => onPlay({ g, p, self: u, m: mult(u), board: p.board }));
  if (u.golden && u.mem.tripleReward) {
    delete u.mem.tripleReward;
    const tier = Math.min(CONFIG.maxTier, p.tier + 1);
    queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === tier), `Triple reward: Discover a Tier ${tier} unit`);
  }
  for (const b of [...p.board]) {
    const e = EFFECTS[b.cardId]?.onPlayOther;
    if (b !== u && e) withFx(g, p, { unit: b }, 'Ability', () => e({ g, p, self: b, m: mult(b), board: p.board }, u));
  }
  heroHooks.onPlay(g, p, u);
  drainOverflow(g, p); // a card waiting for room takes the freed hand slot
  return OK;
}

export function runBattlecry(g: GameState, p: Player, u: Unit, target?: Unit) {
  const e = EFFECTS[u.cardId];
  if (!e?.battlecry) return;
  // each "triggers an extra time" adds one: Gem Wizard (+1, Golden +2 for Red Gems), Crown of Echoes (+1), Derby Pocket (+1)
  const times = battlecryTimes(p, u) + (hasTrinket(p, 'crown_of_echoes') ? 1 : 0) + heroHooks.battlecryExtra(p);
  // repeats happen even if the unit is gone by then (Sword and Shield destroy themselves in their Battlecry)
  for (let i = 0; i < times; i++) {
    withFx(g, p, { unit: u }, i === 0 ? 'Battlecry' : 'Battlecry again!', () => e.battlecry!({ g, p, self: u, m: mult(u), board: p.board, target }));
    onBattlecryTriggered(g, p);
  }
}

export function onBattlecryTriggered(g: GameState, p: Player) {
  p.battlecriesThisTurn++;
  p.battlecriesGame++;
  for (const b of [...p.board]) {
    const e = EFFECTS[b.cardId]?.onBattlecry;
    if (e) withFx(g, p, { unit: b }, 'Ability', () => e({ g, p, self: b, m: mult(b), board: p.board }));
  }
}

export function move(p: Player, from: number, to: number): ActionResult {
  const u = p.board[from];
  if (!u) return fail('Nothing there');
  if (u.mem.locked) return fail('That unit is locked');
  to = Math.max(0, Math.min(to, p.board.length - 1));
  p.board.splice(from, 1);
  p.board.splice(to, 0, u);
  return OK;
}

export function reroll(g: GameState, p: Player): ActionResult {
  if (busy(p)) return fail('Choose a card first');
  if (p.gold < CONFIG.rerollCost) return fail('Not enough gold');
  p.gold -= CONFIG.rerollCost;
  p.frozen = false;
  rollShop(g, p);
  // "when you Refresh" (Tinker)
  for (const b of [...p.board]) {
    const e = EFFECTS[b.cardId]?.onRefresh;
    if (e) withFx(g, p, { unit: b }, 'Ability', () => e({ g, p, self: b, m: mult(b), board: p.board }));
  }
  return OK;
}

export function toggleFreeze(p: Player): ActionResult {
  if (p.heroMem.skipRound !== undefined && !p.frozen && p.shop.length === 0 && p.gold === 0) return fail('Nothing to freeze');
  p.frozen = !p.frozen;
  return OK;
}

export function upgrade(g: GameState, p: Player): ActionResult {
  if (busy(p)) return fail('Choose a card first');
  if (p.tier >= CONFIG.maxTier) return fail('Already at max tier');
  if (p.gold < p.upgradeCost) return fail('Not enough gold');
  p.gold -= p.upgradeCost;
  techUp(p);
  return OK;
}

export function techUp(p: Player) {
  if (p.tier >= CONFIG.maxTier) return;
  p.tier++;
  p.upgradeCost = CONFIG.upgradeCost[p.tier + 1] ?? 0;
  // Tinker's and Scientist's bonuses last for the rest of the game (they used to reset here, per "tower level")
}

export function endTurnEffects(g: GameState, p: Player) {
  let times = 1;
  for (const u of p.board) if (u.cardId === 'sarinee') times = Math.max(times, u.golden ? 3 : 2);
  setFxPhase('end');
  for (const u of [...p.board]) {
    const e = EFFECTS[u.cardId]?.endTurn;
    if (!e) continue;
    for (let i = 0; i < times; i++) {
      if (!p.board.includes(u)) break;
      withFx(g, p, { unit: u }, 'End of turn', () => e({ g, p, self: u, m: mult(u), board: p.board }));
    }
  }
  heroEndTurn(g, p);
}

/** Human pressed End Turn: bots take their turns, combats are fought, next round starts. */
export function endTurn(g: GameState): CombatResult[] {
  for (const p of alivePlayers(g)) {
    if (!p.human || g.simulateAll) aiTakeTurn(g, p);
    if (p.trinketOffer) p.trinketOffer = null;
    while (p.discovers.length) chooseDiscover(g, p, 0);
    endTurnEffects(g, p);
    while (p.discovers.length) chooseDiscover(g, p, 0);
  }
  g.phase = 'combat';
  setFxPhase('combat');
  const results: CombatResult[] = [];
  const done = new Set<number>();
  const aliveBefore = alivePlayers(g).length;
  for (const p of alivePlayers(g)) {
    if (done.has(p.id)) continue;
    done.add(p.id);
    if (p.nextOpponent === -1 || p.nextOpponent === null) {
      const ghostId = g.deadOrder[g.deadOrder.length - 1];
      const ghost = ghostId !== undefined ? g.players[ghostId] : undefined;
      if (!ghost?.ghost) continue;
      const r = runCombat(g, p, ghost, true);
      results.push(r);
    } else {
      const o = g.players[p.nextOpponent];
      done.add(o.id);
      results.push(runCombat(g, p, o, false));
    }
  }
  // apply damage, and remember who lost (Treasure)
  for (const p of g.players) p.lostLast = false;
  for (const r of results) {
    const ids = [r.a, r.b].filter((id) => id >= 0);
    if (r.winner === -1) {
      for (const id of ids) g.players[id].streak = 0;
      if (r.stalemate) { if (r.a >= 0) g.players[r.a].health -= r.stalemate[0]; if (r.b >= 0) g.players[r.b].health -= r.stalemate[1]; }
      continue;
    }
    const loserId = r.winner === 0 ? r.b : r.a;
    const winnerId = r.winner === 0 ? r.a : r.b;
    if (loserId >= 0) { g.players[loserId].health -= r.damage; g.players[loserId].lostLast = true; g.players[loserId].streak = 0; }
    if (winnerId >= 0) g.players[winnerId].streak = (g.players[winnerId].streak ?? 0) + 1;
  }
  // battle history (shown when you hover a player)
  for (const r of results) {
    const sides: [number, number, 0 | 1][] = [[r.a, r.b, 0], [r.b, r.a, 1]];
    for (const [me, vs, side] of sides) {
      if (me < 0) continue;
      const result = r.winner === -1 ? 'draw' : r.winner === side ? 'win' : 'loss';
      const h = (g.players[me].history ??= []);
      h.push({ round: g.round, vs: vs >= 0 ? vs : r.ghostOf ?? -1, ghost: vs < 0, result, dmg: result === 'draw' ? (r.stalemate?.[side] ?? 0) : r.damage });
      if (h.length > 6) h.shift();
    }
  }
  // eliminations
  const dying = alivePlayers(g).filter((p) => p.health <= 0).sort((a, b) => a.health - b.health);
  let place = aliveBefore;
  for (const p of dying) {
    p.alive = false;
    p.placement = place--;
    p.ghost = { board: p.board.map(cloneUnit), slots: p.slots.map((s) => ({ ...s, kw: [...s.kw] })), tier: p.tier };
    g.deadOrder.push(p.id);
  }
  g.lastCombats = results;
  const alive = alivePlayers(g);
  if (alive.length <= 1 || (!human(g).alive && !g.simulateAll)) {
    g.phase = 'over';
    if (alive.length === 1) alive[0].placement = 1;
    if (human(g).alive) human(g).placement = 1;
    return results;
  }
  startRound(g);
  return results;
}

/** damage to the loser: 2 for each of the winner's surviving units (plus extras like Horseman's), no cap */
export const DAMAGE_PER_UNIT = 2;
export function combatDamage(survivors: number, bonus: number) {
  return survivors * DAMAGE_PER_UNIT + bonus;
}

export type { CombatResult } from './types';
import type { CombatResult } from './types';
