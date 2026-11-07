/**
 * 100 achievements. Progress and unlocks are kept on this device (localStorage).
 * The UI reports what happens (buys, combats, game ends…) and the state is checked after every change.
 */
import { store } from '../save/store';
import { ALL_TRIBES, def, effStats, TRIBE_NAMES } from '../engine/core';
import { HEROES } from '../engine/heroes';
import type { GameState, Player, Tribe } from '../engine/types';

type Stats = Record<string, number>;

export interface CombatInfo {
  won: boolean;
  lost: boolean;
  tie: boolean;
  damage: number;
  myUnits: number;
  oppUnits: number;
  survivors: number;
  ghost: boolean;
}

/** Facts about the game in progress (not saved across reloads). */
interface GameTrack {
  discovers: number;
  heroPowers: number;
  streak: number;
  firstTripleRound: number | null;
}

interface Ctx {
  stats: Stats;
  g?: GameState;
  p?: Player;
  game: GameTrack;
  combat?: CombatInfo;
  end?: boolean;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  group: string;
  stat?: string; // counter achievements: unlock when stats[stat] >= target
  target?: number;
  check?(c: Ctx): boolean;
}

const A: AchievementDef[] = [];
const counter = (id: string, name: string, desc: string, group: string, stat: string, target: number) => A.push({ id, name, desc, group, stat, target });
const feat = (id: string, name: string, desc: string, group: string, check: (c: Ctx) => boolean) => A.push({ id, name, desc, group, check });

// ---- Playing (lifetime counters) ----
counter('games1', 'First Steps', 'Finish a game.', 'Career', 'games', 1);
counter('games5', 'Regular', 'Finish 5 games.', 'Career', 'games', 5);
counter('games10', 'Tavern Local', 'Finish 10 games.', 'Career', 'games', 10);
counter('games25', 'Seasoned', 'Finish 25 games.', 'Career', 'games', 25);
counter('first1', 'Champion', 'Finish 1st.', 'Career', 'firsts', 1);
counter('first5', 'Repeat Champion', 'Finish 1st 5 times.', 'Career', 'firsts', 5);
counter('first10', 'Dynasty', 'Finish 1st 10 times.', 'Career', 'firsts', 10);
counter('top3a', 'On the Podium', 'Finish in the top 3.', 'Career', 'top3', 1);
counter('cw1', 'First Blood', 'Win a combat.', 'Combat', 'combatWins', 1);
counter('cw10', 'Brawler', 'Win 10 combats.', 'Combat', 'combatWins', 10);
counter('cw50', 'Warlord', 'Win 50 combats.', 'Combat', 'combatWins', 50);
counter('cw100', 'Conqueror', 'Win 100 combats.', 'Combat', 'combatWins', 100);
counter('dmg100', 'Heavy Hitter', 'Deal 100 damage to opponents in total.', 'Combat', 'damage', 100);
counter('dmg1000', 'Devastator', 'Deal 1,000 damage to opponents in total.', 'Combat', 'damage', 1000);
counter('tri1', 'Three of a Kind', 'Make a Golden unit.', 'Tavern', 'triples', 1);
counter('tri10', 'Goldsmith', 'Make 10 Golden units.', 'Tavern', 'triples', 10);
counter('tri50', 'Midas Touch', 'Make 50 Golden units.', 'Tavern', 'triples', 50);
counter('buy10', 'Customer', 'Buy 10 units.', 'Tavern', 'bought', 10);
counter('buy100', 'Shopaholic', 'Buy 100 units.', 'Tavern', 'bought', 100);
counter('buy500', 'Bulk Buyer', 'Buy 500 units.', 'Tavern', 'bought', 500);
counter('sell10', 'Trader', 'Sell 10 units.', 'Tavern', 'sold', 10);
counter('sell100', 'Merchant', 'Sell 100 units.', 'Tavern', 'sold', 100);
counter('roll25', 'Window Shopper', 'Refresh the Tavern 25 times.', 'Tavern', 'rerolls', 25);
counter('roll250', 'Picky', 'Refresh the Tavern 250 times.', 'Tavern', 'rerolls', 250);
counter('frz10', 'Cold Storage', 'Freeze the Tavern 10 times.', 'Tavern', 'freezes', 10);
counter('hp10', 'Empowered', 'Use your Hero Power 10 times.', 'Heroes', 'heroPowers', 10);
counter('trk1', 'Collector', 'Buy a Trinket.', 'Tavern', 'trinkets', 1);

// ---- Heroes (2 per hero) ----
for (const h of HEROES) {
  counter(`play_${h.id}`, `Meet ${h.name}`, `Play a game as ${h.name}.`, 'Heroes', `heroPlay:${h.id}`, 1);
  counter(`win_${h.id}`, `${h.name} Triumphant`, `Finish 1st as ${h.name}.`, 'Heroes', `heroWin:${h.id}`, 1);
}

// ---- Tribes (14) ----
const countTribe = (p: Player, t: Tribe) => p.board.filter((u) => def(u.cardId).tribe === t).length;
for (const t of ALL_TRIBES) {
  counter(`tw_${t}`, `${TRIBE_NAMES[t]} Victory`, `Finish 1st with 4 or more ${TRIBE_NAMES[t]} units in your army.`, 'Tribes', `tribeWin:${t}`, 1);
  feat(`t7_${t}`, `Pure ${TRIBE_NAMES[t]}`, `Have 7 ${TRIBE_NAMES[t]} units in your army at once.`, 'Tribes', (c) => !!c.p && countTribe(c.p, t) >= 7);
}

// ---- Feats in a single game ----
const board = (c: Ctx) => c.p?.board ?? [];
const stat = (c: Ctx, i: number) => effStats(c.p!, c.p!.board[i], 'board', i);
feat('tier5', 'Top Shelf', 'Reach Tavern Tier 5.', 'Feats', (c) => !!c.p && c.p.tier >= 5);
feat('tier5fast', 'Fast Climber', 'Reach Tavern Tier 5 by turn 8.', 'Feats', (c) => !!c.p && c.p.tier >= 5 && c.g!.round <= 8);
feat('gold3', 'Gilded Army', 'Have 3 Golden units in your army at once.', 'Feats', (c) => board(c).filter((u) => u.golden).length >= 3);
feat('gold7', 'Solid Gold', 'Have 7 Golden units in your army at once.', 'Feats', (c) => board(c).filter((u) => u.golden).length >= 7);
feat('atk100', 'Overkill', 'Have a unit with 100 or more Attack.', 'Feats', (c) => board(c).some((_, i) => stat(c, i).atk >= 100));
feat('hp200', 'Mountain', 'Have a unit with 200 or more Health.', 'Feats', (c) => board(c).some((_, i) => stat(c, i).hp >= 200));
feat('alltaunt', 'Shield Wall', 'Have 7 units with Taunt in your army.', 'Feats', (c) => board(c).length === 7 && board(c).every((_, i) => stat(c, i).kw.includes('taunt')));
feat('allshield', 'Holy Order', 'Have 5 units with Divine Shield in your army.', 'Feats', (c) => board(c).filter((_, i) => stat(c, i).kw.includes('divineShield')).length >= 5);
feat('rich', 'Deep Pockets', 'Have 20 or more gold at once.', 'Feats', (c) => !!c.p && c.p.gold >= 20);
feat('handfull', 'Full Hands', 'Have 10 cards in your hand.', 'Feats', (c) => !!c.p && c.p.hand.length >= 10);
feat('slot20', 'Hallowed Ground', 'Have a slot with +20 or more total bonus stats.', 'Feats', (c) => !!c.p && c.p.slots.some((s) => s.atk + s.hp >= 20));
feat('allslots', 'Fortified', 'Have a bonus on all 7 slots.', 'Feats', (c) => !!c.p && c.p.slots.every((s) => s.atk || s.hp || s.kw.length));
feat('bc5', 'Rapid Fire', 'Trigger 5 Battlecries in one turn.', 'Feats', (c) => !!c.p && c.p.battlecriesThisTurn >= 5);
feat('bc50', 'Battle Cry', 'Trigger 50 Battlecries in one game.', 'Feats', (c) => !!c.p && c.p.battlecriesGame >= 50);
feat('disc5', 'Curious Mind', 'Discover 5 units in one game.', 'Feats', (c) => c.game.discovers >= 5);
feat('hpgame10', 'Power Trip', 'Use your Hero Power 10 times in one game.', 'Feats', (c) => c.game.heroPowers >= 10);
feat('earlytri', 'Early Gold', 'Make a Golden unit before turn 5.', 'Feats', (c) => c.game.firstTripleRound !== null && c.game.firstTripleRound < 5);
feat('goldt5', 'Crown Jewel', 'Have a Golden Tier 5 unit.', 'Feats', (c) => !!c.p && [...c.p.board, ...c.p.hand].some((u) => u.golden && def(u.cardId).tier === 5));
feat('trinkets2', 'Fully Accessorized', 'Own 2 Trinkets in one game.', 'Feats', (c) => !!c.p && c.p.trinkets.length >= 2);
// combat feats
feat('max15', 'Maximum Damage', 'Deal 15 damage in a single combat.', 'Combat', (c) => !!c.combat?.won && c.combat.damage >= 15);
feat('lone', 'Last One Standing', 'Win a combat with only 1 unit left.', 'Combat', (c) => !!c.combat?.won && c.combat.survivors === 1);
feat('flawless', 'Untouchable', 'Win a combat with all 7 of your units surviving.', 'Combat', (c) => !!c.combat?.won && c.combat.survivors >= 7);
feat('underdog', 'Underdog', 'Win a combat while outnumbered.', 'Combat', (c) => !!c.combat?.won && c.combat.oppUnits > c.combat.myUnits);
feat('tie', 'Stalemate', 'Tie a combat.', 'Combat', (c) => !!c.combat?.tie);
feat('streak3', 'On a Roll', 'Win 3 combats in a row.', 'Combat', (c) => c.game.streak >= 3);
feat('streak5', 'Rampage', 'Win 5 combats in a row.', 'Combat', (c) => c.game.streak >= 5);
feat('ghost', 'Ghostbuster', 'Defeat a ghost.', 'Combat', (c) => !!c.combat?.won && c.combat.ghost);
// end of game feats
const place = (c: Ctx) => (c.end && c.p ? c.p.placement : 0);
feat('healthy', 'Barely a Scratch', 'Finish 1st with 30 or more Health.', 'Feats', (c) => place(c) === 1 && c.p!.health >= 30);
feat('comeback', 'Comeback Kid', 'Finish 1st with 5 or less Health.', 'Feats', (c) => place(c) === 1 && c.p!.health <= 5);
feat('quick', 'Blitz', 'Finish 1st by turn 12.', 'Feats', (c) => place(c) === 1 && c.g!.round <= 12);
feat('long', 'War of Attrition', 'Play a game that lasts 20 turns.', 'Feats', (c) => !!c.end && c.g!.round >= 20);
feat('second', 'So Close', 'Finish 2nd.', 'Career', (c) => place(c) === 2);
feat('sixth', 'Everyone Starts Somewhere', 'Finish 6th.', 'Career', (c) => place(c) === 6);
feat('neutral', 'No Allegiance', 'Finish 1st with no tribe having 3 or more units in your army.', 'Tribes',
  (c) => place(c) === 1 && ALL_TRIBES.every((t) => countTribe(c.p!, t) < 3));
feat('treasure', 'Treasure Hunter', 'Finish 1st with a Treasure in your army.', 'Feats', (c) => place(c) === 1 && c.p!.board.some((u) => u.cardId === 'treasure'));

export const ACHIEVEMENTS: AchievementDef[] = A;

// ---------------- persistence ----------------
const KEY = 'torrekin-achievements';
interface Saved { unlocked: Record<string, number>; stats: Stats }
let saved: Saved = { unlocked: {}, stats: {} };
/** (re)read from storage: at startup, and after a cloud save brought progress from another device */
export function reloadAchievements() {
  saved = { unlocked: {}, stats: {}, ...(store.getJSON<Saved>(KEY) ?? {}) };
}
reloadAchievements();
function persist() {
  store.setJSON(KEY, saved);
}

let game: GameTrack = { discovers: 0, heroPowers: 0, streak: 0, firstTripleRound: null };
let notify: (a: AchievementDef) => void = () => undefined;

export function onUnlock(f: (a: AchievementDef) => void) { notify = f; }
export function isUnlocked(id: string) { return !!saved.unlocked[id]; }
export function unlockedCount() { return Object.keys(saved.unlocked).filter((id) => A.some((a) => a.id === id)).length; }
export function progress(a: AchievementDef): number {
  if (!a.stat) return isUnlocked(a.id) ? 1 : 0;
  return Math.min(1, (saved.stats[a.stat] ?? 0) / (a.target ?? 1));
}
export function statValue(a: AchievementDef) { return a.stat ? saved.stats[a.stat] ?? 0 : 0; }

export function newGameStarted() {
  game = { discovers: 0, heroPowers: 0, streak: 0, firstTripleRound: null };
}

export function bump(stat: string, n = 1) {
  saved.stats[stat] = (saved.stats[stat] ?? 0) + n;
}

export function noteGame(kind: 'discover' | 'heroPower' | 'triple', g?: GameState) {
  if (kind === 'discover') game.discovers++;
  if (kind === 'heroPower') game.heroPowers++;
  if (kind === 'triple' && game.firstTripleRound === null && g) game.firstTripleRound = g.round;
}

/** Check every achievement against the current situation; unlock and announce new ones. */
export function evaluate(g?: GameState, extra: { combat?: CombatInfo; end?: boolean } = {}) {
  const c: Ctx = { stats: saved.stats, g, p: g?.players[0], game, ...extra };
  let changed = false;
  for (const a of A) {
    if (saved.unlocked[a.id]) continue;
    let ok = false;
    try {
      ok = a.stat ? (saved.stats[a.stat] ?? 0) >= (a.target ?? 1) : !!a.check?.(c);
    } catch { ok = false; }
    if (ok) {
      saved.unlocked[a.id] = Date.now();
      changed = true;
      notify(a);
    }
  }
  persist();
  return changed;
}

export function recordCombat(g: GameState, info: CombatInfo) {
  if (info.won) { bump('combatWins'); bump('damage', info.damage); game.streak++; }
  else game.streak = 0;
  if (info.lost) bump('combatLosses');
  evaluate(g, { combat: info });
}

export function recordGameEnd(g: GameState) {
  const p = g.players[0];
  bump('games');
  if (p.placement === 1) bump('firsts');
  if (p.placement <= 3) bump('top3');
  if (p.hero) {
    bump(`heroPlay:${p.hero}`);
    if (p.placement === 1) bump(`heroWin:${p.hero}`);
  }
  if (p.placement === 1) for (const t of ALL_TRIBES) if (countTribe(p, t) >= 4) bump(`tribeWin:${t}`);
  evaluate(g, { end: true });
}
