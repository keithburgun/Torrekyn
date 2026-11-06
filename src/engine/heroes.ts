/**
 * Heroes, hero powers and trinkets.
 * NOTE: these heroes and trinkets are PLACEHOLDERS until the real list is supplied.
 * Each hook is called from game.ts / combat.ts.
 */
import { addKw, def, effStats, log, makeUnit, pick, sample } from './core';
import type { GameState, Player, Unit } from './types';
import type { Side, Combat } from './combat';
import { gainNew, randomCardOfTier, rollShop } from './game';

export interface HeroDef {
  id: string;
  name: string;
  power: string;
  text: string;
  avatar: number; // index of art/heroes/<n>.svg
  cost?: number; // active powers only
  passive?: boolean;
  target?: boolean; // active power needs a friendly target
  use?(g: GameState, p: Player, target?: Unit): void;
  shopBonus?: number;
  startTurn?(g: GameState, p: Player): void;
  endTurn?(g: GameState, p: Player): void;
  soc?(c: Combat, s: Side): void;
}

export const HEROES: HeroDef[] = [
  {
    id: 'warden', name: 'Warden of Slots', power: 'Fortify', avatar: 5, cost: 2,
    text: 'Give your left-most slot +2/+2.',
    use: (g, p) => { p.slots[0].atk += 2; p.slots[0].hp += 2; },
  },
  {
    id: 'merchant', name: 'Merchant Prince', power: 'Procure', avatar: 4, cost: 2,
    text: 'Get a random Tier 1 unit.',
    use: (g, p) => gainNew(g, p, randomCardOfTier(g, 1)),
  },
  {
    id: 'tactician', name: 'The Tactician', power: 'Last Line', avatar: 0, passive: true,
    text: 'Start of Combat: Give your right-most unit Divine Shield.',
    soc: (c, s) => { const u = s.units[s.units.length - 1]; if (u) addKw(u, 'divineShield'); },
  },
  {
    id: 'quartermaster', name: 'Quartermaster', power: 'Restock', avatar: 9, cost: 0,
    text: 'Refresh the shop.',
    use: (g, p) => { p.frozen = false; rollShop(g, p); },
  },
  {
    id: 'forgemaster', name: 'Forgemaster', power: 'Temper', avatar: 8, cost: 1, target: true,
    text: 'Give a friendly unit +1/+2.',
    use: (g, p, t) => { if (t) { t.atk += 1; t.hp += 2; } },
  },
  {
    id: 'oracle', name: 'Oracle of the Pool', power: 'Foresight', avatar: 1, passive: true, shopBonus: 1,
    text: 'Your shop offers 1 extra unit.',
  },
  {
    id: 'bloodletter', name: 'Bloodletter', power: 'Life Tap', avatar: 2, cost: 0,
    text: 'Take 2 damage. Gain 1 gold.',
    use: (g, p) => { p.health -= 2; p.gold += 1; },
  },
  {
    id: 'steward', name: 'The Steward', power: 'Tend', avatar: 3, passive: true,
    text: 'At the end of your turn, give your left-most unit +1/+1.',
    endTurn: (g, p) => { const u = p.board[0]; if (u) { u.atk++; u.hp++; } },
  },
];

export interface TrinketDef {
  id: string;
  name: string;
  text: string;
  cost: number;
  greater?: boolean;
  onGain?(g: GameState, p: Player): void;
  endTurn?(g: GameState, p: Player): void;
  soc?(c: Combat, s: Side): void;
  shopBonus?: number;
}

export const TRINKETS: TrinketDef[] = [
  // lesser (offered at the start of turn 6)
  { id: 'bronze_compass', name: 'Bronze Compass', cost: 2, text: 'Your shop offers 1 extra unit.', shopBonus: 1 },
  { id: 'lucky_coin', name: 'Lucky Coin', cost: 4, text: 'Increase your maximum Gold by 1.', onGain: (g, p) => { p.maxGoldBonus += 1; } },
  { id: 'whetstone', name: 'Whetstone', cost: 1, text: 'Start of Combat: Your left-most unit gains +5 Attack.', soc: (c, s) => { const u = s.units[0]; if (u) u.atk += 5; } },
  { id: 'iron_bracer', name: 'Iron Bracer', cost: 2, text: 'Your left-most slot gains Taunt.', onGain: (g, p) => addKw(p.slots[0], 'taunt') },
  { id: 'healing_draught', name: 'Healing Draught', cost: 0, text: 'Restore 8 Health to your hero.', onGain: (g, p) => { p.health += 8; } },
  { id: 'spare_parts', name: 'Spare Parts', cost: 3, text: 'At the end of your turn, give a random unit in your hand +2/+2.', endTurn: (g, p) => { const u = pick(g, p.hand); if (u) { u.atk += 2; u.hp += 2; } } },
  { id: 'old_map', name: 'Old Map', cost: 1, text: 'Get a random Tier 2 unit.', onGain: (g, p) => gainNew(g, p, randomCardOfTier(g, 2)) },
  { id: 'war_drum', name: 'War Drum', cost: 3, text: 'Start of Combat: Give your units +2 Attack.', soc: (c, s) => { for (const u of s.units) u.atk += 2; } },
  // greater (offered at the start of turn 9)
  { id: 'crown_of_echoes', name: 'Crown of Echoes', cost: 7, greater: true, text: 'Your Battlecries trigger twice.' },
  { id: 'gravebell', name: 'Gravebell', cost: 6, greater: true, text: 'Your Deathrattles trigger an extra time.' },
  { id: 'aegis_charm', name: 'Aegis Charm', cost: 4, greater: true, text: 'Start of Combat: Give your 2 left-most units Divine Shield.', soc: (c, s) => { for (const u of s.units.slice(0, 2)) addKw(u, 'divineShield'); } },
  { id: 'golden_lantern', name: 'Golden Lantern', cost: 6, greater: true, text: 'Make a random non-golden unit in your army Golden.', onGain: (g, p) => makeGolden(g, p) },
  { id: 'bannerlords_standard', name: "Bannerlord's Standard", cost: 3, greater: true, text: 'Give all your slots +3/+3.', onGain: (g, p) => { for (const s of p.slots) { s.atk += 3; s.hp += 3; } } },
  { id: 'hourglass_of_plenty', name: 'Hourglass of Plenty', cost: 4, greater: true, text: 'Increase your maximum Gold by 2.', onGain: (g, p) => { p.maxGoldBonus += 2; } },
  { id: 'phoenix_feather', name: 'Phoenix Feather', cost: 5, greater: true, text: 'Your left-most slot gains Reborn.', onGain: (g, p) => addKw(p.slots[0], 'reborn') },
  { id: 'warlords_horn', name: "Warlord's Horn", cost: 5, greater: true, text: 'Start of Combat: Give your units +8/+8.', soc: (c, s) => { for (const u of s.units) { u.atk += 8; u.hp += 8; } } },
];

export const LESSER_TRINKET_TURN = 6;
export const GREATER_TRINKET_TURN = 9;

export function heroDef(id: string | undefined): HeroDef | undefined {
  return HEROES.find((h) => h.id === id);
}
export function trinketDef(id: string): TrinketDef {
  const t = TRINKETS.find((x) => x.id === id);
  if (!t) throw new Error('unknown trinket ' + id);
  return t;
}

function makeGolden(g: GameState, p: Player) {
  const u = pick(g, p.board.filter((x) => !x.golden && !def(x.cardId).token));
  if (!u) return;
  const d = def(u.cardId);
  const gold = makeUnit(g, u.cardId, true);
  gold.atk += u.atk - d.atk;
  gold.hp += u.hp - d.hp;
  gold.kw = [...new Set([...gold.kw, ...u.kw])];
  gold.uid = u.uid;
  p.board[p.board.indexOf(u)] = gold;
  log(p, `Golden Lantern made ${d.name} Golden!`);
}

export function shopBonus(p: Player): number {
  return (heroDef(p.hero)?.shopBonus ?? 0) + p.trinkets.reduce((s, t) => s + (trinketDef(t).shopBonus ?? 0), 0);
}

export function offerTrinkets(g: GameState, p: Player, greater: boolean) {
  const pool = TRINKETS.filter((t) => !!t.greater === greater && !p.trinkets.includes(t.id));
  p.trinketOffer = sample(g, pool, 4).map((t) => t.id);
}

export function canUseHeroPower(p: Player): boolean {
  const h = heroDef(p.hero);
  if (h?.id === 'bloodletter' && p.health <= 2) return false;
  return !!h && !h.passive && !p.heroUsed && p.gold >= (h.cost ?? 0);
}

export function useHeroPower(g: GameState, p: Player, target?: Unit): boolean {
  const h = heroDef(p.hero);
  if (!h || !canUseHeroPower(p) || !h.use) return false;
  if (h.target && !target) return false;
  p.gold -= h.cost ?? 0;
  p.heroUsed = true;
  h.use(g, p, target);
  return true;
}

export function pickTrinket(g: GameState, p: Player, id: string | null): boolean {
  if (!p.trinketOffer) return false;
  if (id === null) {
    p.trinketOffer = null;
    return true;
  }
  if (!p.trinketOffer.includes(id)) return false;
  const t = trinketDef(id);
  if (p.gold < t.cost) return false;
  p.gold -= t.cost;
  p.trinkets.push(id);
  p.trinketOffer = null;
  t.onGain?.(g, p);
  return true;
}

export function heroEndTurn(g: GameState, p: Player) {
  heroDef(p.hero)?.endTurn?.(g, p);
  for (const t of p.trinkets) trinketDef(t).endTurn?.(g, p);
}

export function heroSoc(c: Combat, s: Side) {
  heroDef(s.owner.hero)?.soc?.(c, s);
  for (const t of s.owner.trinkets ?? []) trinketDef(t).soc?.(c, s);
}

export const hasTrinket = (p: Player, id: string) => p.trinkets.includes(id);
export { effStats };
