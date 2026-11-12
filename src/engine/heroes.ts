/**
 * Heroes, hero powers and trinkets.
 * Heroes are the Torrekin champions. Trinkets are still PLACEHOLDERS.
 * Each hook is called from game.ts / combat.ts.
 */
import { addKw, def, effStats, isTribe, log, makeUnit, pick, sample, CONFIG } from './core';
import type { GameState, Player, Tribe, Unit } from './types';
import type { CUnit, Side, Combat } from './combat';
import { EFFECTS, hasBattlecry } from './effects';
import { fxHooks, withFx } from './fx';
import { discoverOptions, drawFromPool, gainCard, gainNew, queueDiscover, queuePowerDiscover, randomCardOfTier } from './game';

export interface HeroDef {
  id: string;
  name: string;
  title: string; // one-line identity shown on hero select
  power: string;
  text: string;
  avatar: number;
  /** starting Health (balance: stronger heroes start lower); CONFIG.startHealth when not set */
  health?: number;
  cost?: number; // active powers only
  /** cost that changes during the game (Locas Clare); overrides `cost` */
  costFn?(g: GameState, p: Player): number;
  passive?: boolean;
  target?: boolean; // active power needs a friendly target
  targetShop?: boolean; // active power needs a unit in the Tavern
  /** not offered when this tribe is banned (HS convention for tribe heroes) */
  needsTribe?: Tribe;
  canUse?(g: GameState, p: Player): boolean;
  /** why an active power can't be used right now, if there is a rule beyond gold (shown to the player) */
  locked?(g: GameState, p: Player): string | null;
  use?(g: GameState, p: Player, target?: Unit): void;
  /** the power was gained (hero chosen, or discovered by Abragail) */
  onGain?(g: GameState, p: Player): void;
  shopBonus?: number;
  /** gold off the price of this card */
  discount?(p: Player, cardId: string): number;
  onBuy?(g: GameState, p: Player, u: Unit): void;
  onPlay?(g: GameState, p: Player, u: Unit): void;
  onSell?(g: GameState, p: Player, u: Unit): void;
  /** Battlecries trigger this many times (multiplies with other effects) */
  battlecryTimes?(p: Player): number;
  startTurn?(g: GameState, p: Player): void;
  endTurn?(g: GameState, p: Player): void;
  soc?(c: Combat, s: Side): void;
  /** combat: a unit was summoned for this side */
  onSummon?(c: Combat, s: Side, u: CUnit): void;
  /** combat: a friendly unit died (Avenge counters) */
  onFriendlyDeath?(c: Combat, s: Side): void;
  /** short progress note for the UI, e.g. "3/5" */
  progress?(g: GameState, p: Player): string | null;
}

const BATTLECRIES_FOR_COFFEE = 5;
const SALES_FOR_LEAVES = 4;
const ZUZUNI: Tribe = 'cloister'; // Omar Evans' "Zuzuni" units (assumed to be Cloister, the ninja tribe)

/** Avenge (n) for a hero power: count friendly deaths this combat, fire every n. */
function heroAvenge(s: Side, id: string, n: number): boolean {
  s.heroAvenge[id] = (s.heroAvenge[id] ?? 0) + 1;
  if (s.heroAvenge[id] < n) return false;
  s.heroAvenge[id] = 0;
  return true;
}

export const HEROES: HeroDef[] = [
  {
    id: 'andromeda_robin', name: 'Andromeda Robin', title: 'Potato witch', power: 'Pumpkin Buddy', avatar: 0, health: 40, passive: true,
    text: 'Start the game with a 1/1 Pumpkin. It has every tribe and gains the Deathrattle of any other unit that dies in combat.',
    onGain: (g, p) => { gainNew(g, p, 'pumpkin'); },
  },
  {
    id: 'gelf_lanz', name: 'Gelf Lanz', title: 'Leader of the Azure Order', power: 'Inspire', avatar: 1, health: 42, cost: 3, needsTribe: 'azure',
    text: 'Gain an Azure unit. This costs 1 less each time you buy an Azure unit.',
    costFn: (g, p) => Math.max(0, 3 - (p.heroMem.azureBought ?? 0)),
    onBuy: (g, p, u) => { if (isTribe(u, 'azure')) p.heroMem.azureBought = (p.heroMem.azureBought ?? 0) + 1; },
    use: (g, p) => { gainNew(g, p, drawFromPool(g, (id) => isTribe(id, 'azure') && def(id).tier <= p.tier)); },
  },
  {
    id: 'derby_pocket', name: 'Derby Pocket', title: 'Ex-Business Demon intern', power: 'Coffee Run', avatar: 2, health: 44, passive: true,
    text: `After you play ${BATTLECRIES_FOR_COFFEE} Battlecry units, your Battlecries trigger an extra time.`,
    onPlay: (g, p, u) => { if (hasBattlecry(u.cardId)) p.heroMem.coffee = (p.heroMem.coffee ?? 0) + 1; },
    battlecryTimes: (p) => ((p.heroMem.coffee ?? 0) >= BATTLECRIES_FOR_COFFEE ? 2 : 1),
    progress: (g, p) => ((p.heroMem.coffee ?? 0) >= BATTLECRIES_FOR_COFFEE ? 'Active' : `${p.heroMem.coffee ?? 0}/${BATTLECRIES_FOR_COFFEE}`),
  },
  {
    id: 'bunny_wizard', name: 'Bunny Wizard', title: 'A very soft healer', power: 'New Friends', avatar: 3, health: 46, cost: 1, needsTribe: 'kindred',
    text: 'Discover a Kindred unit. (Unlocks at Tavern Tier 4.)',
    locked: (g, p) => (p.tier < 4 ? 'Unlocks at Tavern Tier 4' : null),
    use: (g, p) => queueDiscover(g, p, discoverOptions(g, (id) => isTribe(id, 'kindred') && def(id).tier <= p.tier), 'New Friends: Discover a Kindred unit'),
  },
  {
    id: 'croh_vosh', name: 'Croh Vosh', title: 'The drowned lich', power: 'Abyssal Sweep', avatar: 4, health: 44, passive: true,
    text: 'Units you summon during combat get +1/+2.',
    onSummon: (c, s, u) => { u.atk += 1; u.hp += 2; },
  },
  {
    id: 'may_danaris', name: 'May Danaris', title: 'Hacker from the neon district', power: 'Root Access', avatar: 5, health: 32, cost: 3,
    text: "Discover a unit from your last opponent's army.",
    locked: (g, p) => (p.lastOpponentBoard.length ? null : 'No opponent fought yet'),
    use: (g, p) => {
      const ids = [...new Set(p.lastOpponentBoard.map((u) => u.cardId))];
      queueDiscover(g, p, sample(g, ids, 3), "Root Access: Discover a unit from your last opponent's army");
    },
  },
  {
    id: 'locas_clare', name: 'Locas Clare', title: 'Prankster and lockpick', power: 'Stealing A Boat', avatar: 6, health: 51,
    text: 'Steal every unit in the Tavern (they go to your hand), then this resets to 7. Costs 1 less each turn.',
    costFn: (g, p) => Math.max(0, 7 - (g.round - (p.heroMem.locasFrom ?? 1))),
    locked: (g, p) => (!p.shop.length ? 'The Tavern is empty' : p.hand.length >= CONFIG.handSize ? 'Your hand is full' : null),
    use: (g, p) => {
      while (p.shop.length && p.hand.length < CONFIG.handSize) gainCard(g, p, p.shop.shift()!);
      p.heroMem.locasFrom = g.round + 1; // back to 7 next turn
      log(p, 'Locas cleaned out the Tavern!');
    },
  },
  {
    id: 'venice_gorn', name: 'Venice Gorn', title: 'Potato farmer', power: 'Sow Seeds', avatar: 7, health: 38, cost: 2,
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
    progress: (g, p) => (p.heroSeeds.length ? `${p.heroSeeds.length} planted` : null),
  },
  {
    id: 'omar_evans', name: 'Omar Evans', title: 'Bug ninja of the green', power: 'Leaf Cloak', avatar: 8, health: 44, passive: true, needsTribe: ZUZUNI,
    text: `After you sell ${SALES_FOR_LEAVES} units, Discover a Cloister unit. (Repeats.)`,
    onSell: (g, p) => {
      p.heroMem.leaves = (p.heroMem.leaves ?? 0) + 1;
      if (p.heroMem.leaves >= SALES_FOR_LEAVES) {
        p.heroMem.leaves = 0;
        queueDiscover(g, p, discoverOptions(g, (id) => isTribe(id, ZUZUNI) && def(id).tier <= p.tier), 'Leaf Cloak: Discover a Cloister unit');
      }
    },
    progress: (g, p) => `${p.heroMem.leaves ?? 0}/${SALES_FOR_LEAVES}`,
  },
  {
    id: 'eve_williams', name: 'Eve Williams', title: 'Revolutionary', power: 'Doom Bauble', avatar: 9, health: 43, cost: 1, targetShop: true,
    text: 'Select a unit in the Tavern. When you have space in a battle, FIRE it at a random enemy.',
    locked: (g, p) => (!p.shop.length ? 'The Tavern is empty' : null),
    use: (g, p, t) => {
      const i = t ? p.shop.indexOf(t) : -1;
      if (i < 0) return;
      p.shop.splice(i, 1);
      (p.bauble ??= []).push(t!);
      log(p, `${def(t!.cardId).name} is loaded into the Doom Bauble.`);
    },
    progress: (g, p) => (p.bauble?.length ? `${p.bauble.length} loaded` : null),
  },
  {
    id: 'abragail', name: 'Abragail', title: 'Scholar of the Azura Academy', power: 'Well-Studied', avatar: 10, health: 32, passive: true,
    text: 'At the start of turn 4, Discover two Hero Powers to replace this one.',
    startTurn: (g, p) => {
      if (g.round < 4 || p.heroMem.studied) return;
      p.heroMem.studied = 1;
      const pool = HEROES.filter((h) => h.id !== 'abragail' && !p.powers.includes(h.id) && (!h.needsTribe || g.tribes.includes(h.needsTribe)));
      const six = sample(g, pool, 6).map((h) => h.id);
      queuePowerDiscover(g, p, six.slice(0, 3), 'Well-Studied: Choose your first new Hero Power');
      queuePowerDiscover(g, p, six.slice(3, 6), 'Well-Studied: Choose your second new Hero Power');
    },
    progress: (g, p) => (g.round < 4 ? `Turn ${g.round}/4` : null),
  },
  {
    id: 'bill_milton', name: 'Bill Milton', title: 'CEO of the Business Demons', power: 'Golden Parachute', avatar: 11, health: 44, passive: true, needsTribe: 'demons',
    text: 'Whenever you buy a Business Demon, gain 1 Gold.',
    onBuy: (g, p, u) => { if (isTribe(u, 'demons')) p.gold += 1; },
  },
  {
    id: 'clover', name: 'Clover', title: 'Dragon of Dragon Bridge', power: 'Broodmother', avatar: 12, health: 32, passive: true,
    text: 'Avenge (4): Summon a 1/1 Dragon and improve this (+1/+1 to future Dragons).',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'clover', 4)) return;
      const lvl = s.owner.heroMem.brood ?? 0;
      const d = c.spawn(s, 'dragon', false, s.units.length);
      if (d) { d.atk += lvl; d.hp += lvl; }
      if (s.persistent) s.owner.heroMem.brood = lvl + 1;
      c.snap('trigger', { note: 'Broodmother: Summon a Dragon' });
    },
    progress: (g, p) => `Dragons ${1 + (p.heroMem.brood ?? 0)}/${1 + (p.heroMem.brood ?? 0)}`,
  },
  {
    id: 'mazrael_bettencourt', name: 'Mazrael Bettencourt', title: 'Vampire of the Secret Arts', power: '1000 Years Old', avatar: 14, passive: true,
    text: 'Skip your first turn. Discover a Tier 3, a Tier 4 and a Tier 5 unit. Each unlocks once your Tavern reaches its Tier.',
    startTurn: (g, p) => {
      if (g.round !== 1 || p.heroMem.longGame) return;
      p.heroMem.longGame = 1;
      p.heroMem.skipRound = g.round; // game.ts startTurn empties the shop and the gold
      for (const t of [3, 4, 5]) {
        queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === t), `1000 Years Old: Discover a Tier ${t} unit (unlocks at Tavern Tier ${t})`, false, t);
      }
    },
    progress: (g, p) => {
      const waiting = p.hand.filter((u) => (u.mem.unlockTier ?? 0) > p.tier).length;
      return waiting ? `${waiting} waiting` : null;
    },
  },
  {
    id: 'trevor_l', name: 'Trevor L', title: 'Rock and roll skeleton', power: 'Party All Night', avatar: 13, health: 37, passive: true,
    text: 'Avenge (5): Give a random friendly unit Reborn.',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'trevor_l', 5)) return;
      const u = pick(c.g, s.units.filter((x) => x.hp > 0 && !x.kw.includes('reborn')));
      if (!u) return;
      addKw(u, 'reborn');
      c.snap('trigger', { source: u.id, note: 'Party All Night: Reborn' });
    },
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
  startTurn?(g: GameState, p: Player): void;
  onPlay?(g: GameState, p: Player): void;
  /** combat: a friendly unit died (Avenge) */
  onFriendlyDeath?(c: Combat, s: Side): void;
  /** turn counter shown on the trinket */
  progress?(p: Player): string;
}

export const TRINKETS: TrinketDef[] = [
  // lesser (offered at the start of turn 6)
  { id: 'healing_draught', name: 'Teched Up', cost: 0, text: 'Gain 3 Gold. Your Tavern no longer offers Tier 1 or 2 units.', onGain: (g, p) => { p.gold += 3; } },
  { id: 'whetstone', name: 'Crop Circle', cost: 1, text: 'End of Turn: Gain a random Brambor unit.', endTurn: (g, p) => {
    const id = drawFromPool(g, (cid) => def(cid).tribe === 'brambor' && def(cid).tier <= p.tier);
    if (id) gainNew(g, p, id);
  } },
  { id: 'old_map', name: 'Old Map', cost: 1, text: 'Every other End of Turn: Discover a Tier 5 unit.',
    endTurn: (g, p) => {
      if (!everyOther(p, 'old_map')) return;
      p.heroMem.old_map_discover = 1; // discovered at the start of next turn, when you can choose
    },
    startTurn: (g, p) => {
      if (!p.heroMem.old_map_discover) return;
      p.heroMem.old_map_discover = 0;
      queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === 5), 'Old Map: Discover a Tier 5 unit');
    },
    progress: (p) => `${p.heroMem.t_old_map ?? 0}/2` },
  { id: 'bronze_compass', name: 'Bronze Compass', cost: 2, text: 'Your Neverending units have +12 Attack.' }, // see effStats
  { id: 'iron_bracer', name: 'Iron Bracer', cost: 2, text: 'Your left-most slot gains Taunt.', onGain: (g, p) => addKw(p.slots[0], 'taunt') },
  { id: 'spare_parts', name: 'Spare Parts', cost: 3, text: 'Every time you play a unit, give a random unit in your hand +2/+2.', onPlay: (g, p) => { const u = pick(g, p.hand); if (u) { u.atk += 2; u.hp += 2; } } },
  { id: 'war_drum', name: 'War Drum', cost: 3, text: 'Start of Combat: Give your units +2 Attack.', soc: (c, s) => { for (const u of s.units) u.atk += 2; } },
  { id: 'lucky_coin', name: 'Lucky Coin', cost: 0, text: 'Gain 8 Gold.', onGain: (g, p) => { p.gold += 8; } },
  { id: 'summit_key', name: 'Summit Key', cost: 2, text: 'In two turns, Discover a Tier 6 unit.',
    onGain: (g, p) => { p.heroMem.summitAt = g.round + 2; },
    startTurn: (g, p) => {
      if (p.heroMem.summitAt !== g.round) return;
      delete p.heroMem.summitAt;
      queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === 6), 'Summit Key: Discover a Tier 6 unit');
    } },
  // greater (offered at the start of turn 9)
  { id: 'bannerlords_standard', name: "Bannerlord's Standard", cost: 3, greater: true, text: 'Give all your slots +3/+3.', onGain: (g, p) => { for (const s of p.slots) { s.atk += 3; s.hp += 3; } } },
  { id: 'aegis_charm', name: 'Aegis Charm', cost: 4, greater: true, text: 'Start of Combat: Give your 2 left-most units Divine Shield.', soc: (c, s) => { for (const u of s.units.slice(0, 2)) addKw(u, 'divineShield'); } },
  { id: 'hourglass_of_plenty', name: 'Hourglass of Plenty', cost: 4, greater: true, text: 'Avenge (6): Summon a random Deathrattle unit.',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'hourglass_of_plenty', 6)) return;
      const ids = Object.keys(c.g.pool).filter((id) => EFFECTS[id]?.deathrattle && !def(id).token && def(id).tier <= s.owner.tier);
      const id = pick(c.g, ids);
      if (id && c.spawn(s, id, false, s.units.length)) c.snap('trigger', { note: `Hourglass of Plenty: Summon ${def(id).name}` });
    } },
  { id: 'phoenix_feather', name: 'Phoenix Feather', cost: 5, greater: true, text: 'Your left-most slot gains Reborn.', onGain: (g, p) => addKw(p.slots[0], 'reborn') },
  { id: 'warlords_horn', name: "Warlord's Horn", cost: 5, greater: true, text: 'Avenge (8): Increase your maximum Gold by 1.',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'warlords_horn', 8)) return;
      if (s.persistent) s.owner.maxGoldBonus += 1;
      c.snap('trigger', { note: "Warlord's Horn: +1 maximum Gold" });
    } },
  { id: 'gravebell', name: 'Gravebell', cost: 6, greater: true, text: 'Your Deathrattles trigger an extra time.' },
  { id: 'golden_lantern', name: 'Golden Lantern', cost: 6, greater: true, text: 'Every other End of Turn: Make a random non-Golden unit in your army Golden.',
    endTurn: (g, p) => { if (everyOther(p, 'golden_lantern')) makeGolden(g, p); },
    progress: (p) => `${p.heroMem.t_golden_lantern ?? 0}/2` },
  { id: 'crown_of_echoes', name: 'Crown of Echoes', cost: 7, greater: true, text: 'Your Battlecries trigger an extra time.' },
  { id: 'summit_vault', name: 'Summit Vault', cost: 4, greater: true, text: 'Discover two Tier 6 units.',
    onGain: (g, p) => {
      for (let i = 0; i < 2; i++) queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === 6), 'Summit Vault: Discover a Tier 6 unit');
    } },
];

/** counts turns for "every 2 turns" trinkets; true on every second one */
function everyOther(p: Player, id: string): boolean {
  const k = `t_${id}`;
  p.heroMem[k] = (p.heroMem[k] ?? 0) + 1;
  if (p.heroMem[k] < 2) return false;
  p.heroMem[k] = 0;
  return true;
}

export const LESSER_TRINKET_TURN = 6;
export const GREATER_TRINKET_TURN = 9;

/** a hero's starting Health */
export const heroHealth = (id: string | undefined) => heroDef(id)?.health ?? CONFIG.startHealth;

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
  return powersOf(p).reduce((n, h) => n + (h.shopBonus ?? 0), 0) + p.trinkets.reduce((s, t) => s + (trinketDef(t).shopBonus ?? 0), 0);
}

export function offerTrinkets(g: GameState, p: Player, greater: boolean) {
  const pool = TRINKETS.filter((t) => !!t.greater === greater && !p.trinkets.includes(t.id));
  p.trinketOffer = sample(g, pool, 4).map((t) => t.id);
}

/** The hero powers a player has (usually one). */
export function powersOf(p: Player): HeroDef[] {
  const ids = p.powers?.length ? p.powers : p.hero ? [p.hero] : [];
  return ids.map((id) => heroDef(id)).filter((h): h is HeroDef => !!h);
}

/** The first active power (what clicking your hero uses), if any. */
export function mainActive(p: Player): HeroDef | undefined {
  return powersOf(p).find((h) => !h.passive);
}

export function powerCost(g: GameState, p: Player, h: HeroDef): number {
  return h.costFn ? h.costFn(g, p) : h.cost ?? 0;
}

export function canUseHeroPower(g: GameState, p: Player, id?: string): boolean {
  const h = id ? heroDef(id) : mainActive(p);
  if (!h || h.passive || !powersOf(p).includes(h) || p.usedPowers.includes(h.id) || p.gold < powerCost(g, p, h)) return false;
  if (h.locked?.(g, p)) return false;
  return h.canUse ? h.canUse(g, p) : true;
}

export function useHeroPower(g: GameState, p: Player, target?: Unit, id?: string): boolean {
  const h = id ? heroDef(id) : mainActive(p);
  if (!h || !canUseHeroPower(g, p, h.id) || !h.use) return false;
  if ((h.target || h.targetShop) && !target) return false;
  p.gold -= powerCost(g, p, h);
  p.usedPowers.push(h.id);
  heroFx(g, p, h, () => h.use!(g, p, target));
  return true;
}

/** Give a player a hero power (start of game, or discovered). */
export function gainPower(g: GameState, p: Player, id: string, replace?: string) {
  if (!p.powers.length && p.hero) p.powers = [p.hero];
  const i = replace ? p.powers.indexOf(replace) : -1;
  if (i >= 0) p.powers[i] = id;
  else if (!p.powers.includes(id)) p.powers.push(id);
  heroDef(id)?.onGain?.(g, p);
}

/** Hero-power hooks, run for every power the player has. */
/** run a hero-power hook as a visible effect (the UI shows your hero doing it) */
const heroFx = (g: GameState, p: Player, h: HeroDef, fn: () => void) => withFx(g, p, { hero: true, name: h.power }, 'Hero Power', fn);
const trinketFx = (g: GameState, p: Player, t: TrinketDef, fn: () => void) => withFx(g, p, { name: t.name }, 'Trinket', fn);
const trinketsOf = (p: Player) => (p.trinkets ?? []).map((id) => TRINKETS.find((t) => t.id === id)).filter((t): t is TrinketDef => !!t);

export const heroHooks = {
  discount: (p: Player, cardId: string) => powersOf(p).reduce((s, h) => s + (h.discount?.(p, cardId) ?? 0), 0),
  onBuy: (g: GameState, p: Player, u: Unit) => { for (const h of powersOf(p)) if (h.onBuy) heroFx(g, p, h, () => h.onBuy!(g, p, u)); },
  onPlay: (g: GameState, p: Player, u: Unit) => {
    for (const h of powersOf(p)) if (h.onPlay) heroFx(g, p, h, () => h.onPlay!(g, p, u));
    for (const t of trinketsOf(p)) if (t.onPlay) trinketFx(g, p, t, () => t.onPlay!(g, p));
  },
  onSell: (g: GameState, p: Player, u: Unit) => { for (const h of powersOf(p)) if (h.onSell) heroFx(g, p, h, () => h.onSell!(g, p, u)); },
  /** extra Battlecry triggers from hero powers (each power's battlecryTimes - 1, added up) */
  battlecryExtra: (p: Player) => powersOf(p).reduce((s, h) => s + ((h.battlecryTimes?.(p) ?? 1) - 1), 0),
  startTurn: (g: GameState, p: Player) => {
    for (const h of powersOf(p)) if (h.startTurn) heroFx(g, p, h, () => h.startTurn!(g, p));
    for (const t of trinketsOf(p)) if (t.startTurn) trinketFx(g, p, t, () => t.startTurn!(g, p));
  },
  onSummon: (c: Combat, s: Side, u: CUnit) => { for (const h of powersOf(s.owner)) h.onSummon?.(c, s, u); },
  onFriendlyDeath: (c: Combat, s: Side) => {
    for (const h of powersOf(s.owner)) h.onFriendlyDeath?.(c, s);
    for (const t of trinketsOf(s.owner)) t.onFriendlyDeath?.(c, s);
  },
};

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

/** What a unit costs you to buy (hero discounts included). */
export function buyCost(p: Player, cardId?: string): number {
  return Math.max(0, CONFIG.buyCost - (cardId ? heroHooks.discount(p, cardId) : 0));
}

export function heroEndTurn(g: GameState, p: Player) {
  for (const h of powersOf(p)) if (h.endTurn) heroFx(g, p, h, () => h.endTurn!(g, p));
  for (const t of trinketsOf(p)) if (t.endTurn) trinketFx(g, p, t, () => t.endTurn!(g, p));
}

export function heroSoc(c: Combat, s: Side) {
  for (const h of powersOf(s.owner)) h.soc?.(c, s);
  for (const t of s.owner.trinkets ?? []) trinketDef(t).soc?.(c, s);
}

export const hasTrinket = (p: Player, id: string) => p.trinkets.includes(id);
export { effStats };

// hero progress for the effect events (e.g. "Coffee Run 2/5"); kept here so fx.ts doesn't import heroes
fxHooks.heroProgress = (g, p) => powersOf(p).map((h) => { const t = h.progress?.(g, p); return t ? `${h.power} ${t}` : ''; }).filter(Boolean).join(' · ');
