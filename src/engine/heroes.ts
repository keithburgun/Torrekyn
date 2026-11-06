/**
 * Heroes, hero powers and trinkets.
 * Heroes are the Torrekin champions. Trinkets are still PLACEHOLDERS.
 * Each hook is called from game.ts / combat.ts.
 */
import { addKw, cloneUnit, def, effStats, log, makeUnit, pick, sample, tribeOf, CONFIG } from './core';
import type { GameState, Player, Unit } from './types';
import type { Side, Combat } from './combat';
import { drawFromPool, gainCard, gainNew, queueDiscover, discoverOptions, randomCardOfTier } from './game';

export interface HeroDef {
  id: string;
  name: string;
  title: string; // one-line identity shown on hero select
  power: string;
  text: string;
  avatar: number;
  cost?: number; // active powers only
  passive?: boolean;
  target?: boolean; // active power needs a friendly target
  canUse?(g: GameState, p: Player): boolean;
  use?(g: GameState, p: Player, target?: Unit): void;
  shopBonus?: number;
  buyCost?(p: Player): number;
  onBuy?(g: GameState, p: Player): void;
  startTurn?(g: GameState, p: Player): void;
  endTurn?(g: GameState, p: Player): void;
  soc?(c: Combat, s: Side): void;
}

const ELEMENTS: [string, (u: Unit) => void][] = [
  ['Fire', (u) => { u.atk += 3; }],
  ['Water', (u) => { u.hp += 4; }],
  ['Earth', (u) => { u.atk += 1; u.hp += 2; addKw(u, 'taunt'); }],
  ['Wind', (u) => { u.atk += 2; u.hp += 2; }],
];

function opponentBoard(g: GameState, p: Player): Unit[] {
  if (p.nextOpponent === null) return [];
  if (p.nextOpponent === -1) {
    const ghost = g.players[g.deadOrder[g.deadOrder.length - 1]];
    return ghost?.ghost?.board ?? [];
  }
  return g.players[p.nextOpponent].board;
}

export const HEROES: HeroDef[] = [
  {
    id: 'andromeda_robin', name: 'Andromeda Robin', title: 'Potato witch of the forest', power: 'Elemental Weave', avatar: 0, cost: 1, target: true,
    text: 'Give a friendly unit a random Element: Fire (+3 Attack), Water (+4 Health), Earth (+1/+2 and Taunt) or Wind (+2/+2).',
    use: (g, p, t) => {
      if (!t) return;
      const [name, fn] = pick(g, ELEMENTS)!;
      fn(t);
      log(p, `${def(t.cardId).name} was blessed with ${name}.`);
    },
  },
  {
    id: 'gelf_lanz', name: 'Gelf Lanz', title: 'Leader of the Azure Order', power: 'Lance Charge', avatar: 1, passive: true,
    text: 'Start of Combat: Your left-most unit charges, dealing half its Attack to the enemy across from it.',
    soc: (c, s) => {
      const u = s.units[0];
      const t = c.enemy(s).units.find((x) => x.hp > 0);
      if (u && t && u.atk > 1) c.damage(t, Math.floor(u.atk / 2), u);
    },
  },
  {
    id: 'derby_pocket', name: 'Derby Pocket', title: 'Ex-intern, eternal optimist', power: 'Team Spirit', avatar: 2, passive: true,
    text: 'At the end of your turn, give a random friendly unit +1/+1 for each different tribe in your army (up to +3/+3).',
    endTurn: (g, p) => {
      const n = Math.min(3, new Set(p.board.map(tribeOf).filter((t) => t !== 'neutral')).size);
      const u = pick(g, p.board);
      if (u && n) { u.atk += n; u.hp += n; }
    },
  },
  {
    id: 'bunny_wizard', name: 'Bunny Wizard', title: 'A very soft healer', power: 'Cuddle Spell', avatar: 3, cost: 1, target: true,
    text: 'Give a friendly unit +1/+3. Restore 1 Health to your hero.',
    use: (g, p, t) => {
      if (t) { t.atk += 1; t.hp += 3; }
      p.health = Math.min(CONFIG.startHealth, p.health + 1);
    },
  },
  {
    id: 'croh_vosh', name: 'Croh Vosh', title: 'The drowned lich', power: 'Abyssal Sweep', avatar: 4, passive: true,
    text: 'Start of Combat: Swing the sunken greatsword, dealing damage equal to your Tavern Tier to 2 random enemy units.',
    soc: (c, s) => {
      for (const u of sample(c.g, c.enemy(s).units.filter((x) => x.hp > 0), 2)) c.damage(u, s.tier);
    },
  },
  {
    id: 'may_danaris', name: 'May Danaris', title: 'Hacker from the neon district', power: 'Root Access', avatar: 5, cost: 2,
    text: 'Get a copy of the strongest unit (most Attack + Health) in your next opponent\'s army.',
    canUse: (g, p) => opponentBoard(g, p).length > 0,
    use: (g, p) => {
      const src = [...opponentBoard(g, p)].sort((a, b) => b.atk + b.hp - (a.atk + a.hp))[0];
      if (!src) return;
      const copy = cloneUnit(src);
      copy.uid = g.nextUid++;
      copy.mem = {};
      gainCard(g, p, copy);
    },
  },
  {
    id: 'locas_clare', name: 'Locas Clare', title: 'Prankster and lockpick', power: 'Five-Finger Discount', avatar: 6, passive: true,
    text: 'The first unit you buy each turn costs 1 less.',
    buyCost: (p) => (p.heroMem.bought ? CONFIG.buyCost : CONFIG.buyCost - 1),
    onBuy: (g, p) => { p.heroMem.bought = 1; },
    startTurn: (g, p) => { p.heroMem.bought = 0; },
  },
  {
    id: 'venice_gorn', name: 'Venice Gorn', title: 'Potato farmer', power: 'Sow Seeds', avatar: 7, cost: 2,
    text: 'Plant a seed. In 2 turns it sprouts into a random unit from 1 Tier higher than your Tavern.',
    use: (g, p) => { p.heroSeeds.push(2); },
    startTurn: (g, p) => {
      const ready = p.heroSeeds.map((t) => t - 1);
      p.heroSeeds = ready.filter((t) => t > 0);
      for (let i = ready.filter((t) => t <= 0).length; i > 0; i--) {
        gainNew(g, p, randomCardOfTier(g, Math.min(CONFIG.maxTier, p.tier + 1)));
        log(p, 'A seed sprouted!');
      }
    },
  },
  {
    id: 'omar_evans', name: 'Omar Evans', title: 'Bug ninja of the green', power: 'Leaf Cloak', avatar: 8, passive: true,
    text: 'Start of Combat: Your right-most unit gains Stealth and +1/+1 for each Tier of your Tavern.',
    soc: (c, s) => {
      const u = s.units[s.units.length - 1];
      if (u) { addKw(u, 'stealth'); u.atk += s.tier; u.hp += s.tier; }
    },
  },
  {
    id: 'eve_williams', name: 'Eve Williams', title: 'The grinning skeleton', power: 'Wild Card', avatar: 9, cost: 1, target: true,
    text: 'Transform a friendly unit into a random unit of the same Tier, then give it +3/+3.',
    use: (g, p, t) => {
      if (!t || t.mem.locked) return;
      const i = p.board.indexOf(t);
      const tier = def(t.cardId).tier;
      const id = drawFromPool(g, (cid) => def(cid).tier === tier && cid !== t.cardId);
      if (i < 0 || !id) return;
      if (!def(t.cardId).token && g.pool[t.cardId] !== undefined) g.pool[t.cardId] += t.golden ? 3 : 1;
      const nu = makeUnit(g, id, t.golden);
      nu.atk += 3;
      nu.hp += 3;
      p.board[i] = nu;
      log(p, `Ha! ${def(t.cardId).name} became ${def(id).name}.`);
    },
  },
  {
    id: 'abragail', name: 'Abragail', title: 'Scholar of the Azura Academy', power: 'Pop Quiz', avatar: 10, cost: 2,
    text: 'Discover a unit from your Tavern Tier.',
    use: (g, p) => queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === p.tier), 'Pop Quiz: Discover a unit'),
  },
  {
    id: 'bill_milton', name: 'Bill Milton', title: 'CEO of the Business Demons', power: 'Golden Parachute', avatar: 11, passive: true,
    text: 'Your units sell for 2 gold. (Obviously.)',
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

export function canUseHeroPower(g: GameState, p: Player): boolean {
  const h = heroDef(p.hero);
  if (!h || h.passive || p.heroUsed || p.gold < (h.cost ?? 0)) return false;
  return h.canUse ? h.canUse(g, p) : true;
}

export function useHeroPower(g: GameState, p: Player, target?: Unit): boolean {
  const h = heroDef(p.hero);
  if (!h || !canUseHeroPower(g, p) || !h.use) return false;
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

export function buyCost(p: Player): number {
  return heroDef(p.hero)?.buyCost?.(p) ?? CONFIG.buyCost;
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
