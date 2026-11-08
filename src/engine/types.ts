export type Tribe =
  | 'neverending' | 'azure' | 'kindred' | 'brambor' | 'cloister' | 'alcove' | 'demons' | 'neutral';

export type Keyword = 'taunt' | 'divineShield' | 'reborn' | 'venomous' | 'stealth' | 'windfury';

export const BONUS_KEYWORDS: Keyword[] = ['taunt', 'divineShield', 'reborn', 'venomous', 'stealth', 'windfury'];

export interface CardDef {
  id: string;
  name: string;
  tribe: Tribe;
  tier: number;
  atk: number;
  hp: number;
  text: string;
  goldenText: string;
  keywords: Keyword[];
  token?: boolean;
  /** counts as every tribe (Andromeda Robin's Pumpkin) */
  allTribes?: boolean;
}

/** Anything with stats and keywords: a persistent unit or a combat unit. */
export interface Body {
  cardId: string;
  golden: boolean;
  atk: number;
  hp: number;
  kw: Keyword[];
  mem: Record<string, number>;
}

/** A unit the player owns (shop, hand or board). Stats include permanent buffs. */
export interface Unit extends Body {
  uid: number;
}

export interface Slot {
  atk: number;
  hp: number;
  kw: Keyword[];
}

export interface Quest {
  kind: 'devotion' | 'bill';
  have: number;
  need: number;
  reward: number;
}

export interface Discover {
  options: string[]; // card ids, or hero ids when `powers` is set
  /** choosing a Hero Power instead of a card (Abragail) */
  powers?: boolean;
  golden?: boolean;
  /** the unit waits in your hand until your Tavern reaches this tier (Mazrael Bettencourt) */
  unlockTier?: number;
  reason: string;
}

/**
 * How a bot plays (see ai.ts). Personas are profiles with a name. Every field is optional; missing
 * fields fall back to the Expert bot.
 */
export interface BotProfile {
  /** random noise added to every evaluation (bigger = more mistakes) */
  noise?: number;
  /** chance each turn of an outright blunder (random buy, skipped level, no repositioning) */
  blunder?: number;
  /** feature switches, so each improvement can be measured against the old behaviour */
  f?: Record<string, boolean>;
  /** tuning numbers (see ai.ts `knob`) */
  x?: Record<string, number>;
  /** a tribe this bot always goes for when it's in the game (persona quirk) */
  tribe?: Tribe;
}

export interface Player {
  id: number;
  /** bot behaviour; undefined = Expert */
  bot?: BotProfile;
  /** which persona is playing this seat (personas.ts) */
  persona?: string;
  /** effect events waiting to be shown (human only; src/engine/fx.ts) */
  fx?: import('./fx').FxEvent[];
  name: string;
  human: boolean;
  avatar: number;
  health: number;
  alive: boolean;
  placement: number;
  tier: number;
  upgradeCost: number;
  gold: number;
  maxGoldBonus: number;
  goldNextTurn: number;
  board: Unit[];
  hand: Unit[];
  shop: Unit[];
  slots: Slot[];
  frozen: boolean;
  tribeAtk: Partial<Record<Tribe, number>>;
  /** Scientist: extra Attack for Alcove units, for the rest of the game (name kept so saved games still load) */
  alcoveAtkThisTier: number;
  /** Tinker: extra stats for Alcove units in the shop, for the rest of the game (name kept so saved games still load) */
  tinkerThisTier: number;
  bannerBonus: number;
  redGemBonus: number;
  battlecriesThisTurn: number;
  battlecriesLastTurn: number;
  battlecriesGame: number;
  quests: Quest[];
  discovers: Discover[];
  lastOpponent: number | null;
  lastOpponentBoard: Unit[];
  /** this player's own army at their last fight (public; bots use it to plan) */
  lastFightBoard?: Unit[];
  nextOpponent: number | null;
  favoriteTribe?: Tribe;
  hero?: string;
  /** hero powers you have (normally just your hero's; Abragail swaps hers for two others) */
  powers: string[];
  /** active hero powers already used this turn */
  usedPowers: string[];
  heroMem: Record<string, number>;
  heroSeeds: number[];
  /** units loaded into Eve Williams' Doom Bauble, fired in the next battle with room (combat.ts fireBaubles) */
  bauble?: Unit[];
  /** lost their most recent battle (Treasure sells for more) */
  lostLast?: boolean;
  /** wins in a row (a loss or a draw ends it) */
  streak?: number;
  /** recent battles, newest last (kept short): who they fought and how it went */
  history?: { round: number; vs: number; ghost?: boolean; result: 'win' | 'loss' | 'draw'; dmg: number }[];
  /** cards gained while the hand was full: they move into the hand as soon as there's room */
  overflow?: Unit[];
  /** times each Gem was improved (Red Gem uses redGemBonus) */
  gemBonus?: Record<string, number>;
  /** Left Twinbot: +X/+X to all your Twinbots for the rest of the game */
  twinBonus?: number;
  heroOffer?: string[];
  trinkets: string[];
  trinketOffer: string[] | null;
  /** triples made by the human player, waiting to be celebrated by the UI */
  tripleEvents?: { cardId: string; uids: number[]; goldenUid: number }[];
  /** snapshot of the board used when this player is a ghost */
  ghost?: { board: Unit[]; slots: Slot[]; tier: number };
  log: string[];
}

export interface CombatFrameUnit {
  id: number;
  dead?: boolean; // dealt lethal damage, about to be removed
  /** damage past 0 Health (so a 15 damage hit on a 1 Health unit can show -15) */
  over?: number;
  cardId: string;
  golden: boolean;
  atk: number;
  hp: number;
  kw: Keyword[];
}

/** Visual effects attached to a combat frame (for animation only). */
export interface CombatFx {
  k: 'hit' | 'kill' | 'shield' | 'venom' | 'reborn' | 'summon';
  to: number;
  from?: number; // source unit id
  fromSide?: 0 | 1; // a hero/trinket on this side caused it
}

export interface CombatFrame {
  kind: 'start' | 'trigger' | 'attack' | 'hit' | 'death' | 'resolve' | 'end';
  sides: [CombatFrameUnit[], CombatFrameUnit[]];
  fx?: CombatFx[];
  attacker?: number;
  target?: number;
  source?: number;
  note?: string;
}

export interface CombatResult {
  a: number; // player id
  b: number; // player id or -1 for ghost
  ghostOf?: number;
  winner: 0 | 1 | -1; // side index, -1 tie
  damage: number;
  /** what the damage is made of (for showing it): the winner's tier, their surviving units, and extra stars from units (Horseman) */
  dmgParts?: { tier: number; perUnit?: number; units: number[]; bonus: number[] };
  /** a draw with both armies still standing (time ran out): the damage each side takes [to a, to b] */
  stalemate?: [number, number];
  frames: CombatFrame[];
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  round: number;
  phase: 'hero' | 'shop' | 'combat' | 'over';
  players: Player[];
  pool: Record<string, number>;
  tribes: Tribe[];
  nextUid: number;
  lastCombats: CombatResult[];
  deadOrder: number[];
  /** testing only: bots play every seat and the game runs until one player is left */
  simulateAll?: boolean;
  /** the human's rating has been updated for this game */
  rated?: boolean;
}
