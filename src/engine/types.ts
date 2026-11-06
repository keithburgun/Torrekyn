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
  options: string[]; // card ids
  golden?: boolean;
  reason: string;
}

export interface Player {
  id: number;
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
  alcoveAtkThisTier: number;
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
  nextOpponent: number | null;
  favoriteTribe?: Tribe;
  hero?: string;
  heroUsed: boolean;
  heroOffer?: string[];
  trinkets: string[];
  trinketOffer: string[] | null;
  /** snapshot of the board used when this player is a ghost */
  ghost?: { board: Unit[]; slots: Slot[]; tier: number };
  log: string[];
}

export interface CombatFrameUnit {
  id: number;
  cardId: string;
  golden: boolean;
  atk: number;
  hp: number;
  kw: Keyword[];
}

export interface CombatFrame {
  kind: 'start' | 'trigger' | 'attack' | 'resolve' | 'end';
  sides: [CombatFrameUnit[], CombatFrameUnit[]];
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
}
