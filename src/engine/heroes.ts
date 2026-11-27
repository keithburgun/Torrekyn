/**
 * Heroes, hero powers and trinkets.
 * Heroes are the Torrekin champions. Trinkets are still PLACEHOLDERS.
 * Each hook is called from game.ts / combat.ts.
 */
import { addKw, def, effStats, handUnits, isSpell, isTribe, log, makeUnit, pick, rand, sample, CONFIG } from './core';
import type { GameState, Player, Tribe, Unit } from './types';
import type { CUnit, Side, Combat } from './combat';
import { EFFECTS, GEMS, hasBattlecry } from './effects';
import { fxHooks, withFx } from './fx';
import { discoverOptions, drawFromPool, gainCard, gainNew, queueDiscover, queuePowerDiscover, randomCardOfTier, returnToPool } from './game';

export interface HeroDef {
  id: string;
  name: string;
  title: string; // one-line identity shown on hero select
  power: string;
  text: string;
  /** a power about the start of the game (Mazrael's skipped first turn, a starting Pumpkin): never offered later (Abragail, New Power, Different Power Time) */
  startOnly?: boolean;
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
  /** Arrive effects trigger this many times (multiplies with other effects) */
  /** how many times an Arrive happens because of this power (inShop: a unit played from hand, not one in battle) */
  battlecryTimes?(p: Player, inShop?: boolean): number;
  startTurn?(g: GameState, p: Player): void;
  endTurn?(g: GameState, p: Player): void;
  soc?(c: Combat, s: Side): void;
  /** combat: a unit was summoned for this side */
  onSummon?(c: Combat, s: Side, u: CUnit): void;
  /** combat: a friendly unit died (Avenge counters) */
  onFriendlyDeath?(c: Combat, s: Side): void;
  /** you increased your Tavern Tier */
  onTierUp?(g: GameState, p: Player): void;
  /** short progress note for the UI, e.g. "3/5" */
  progress?(g: GameState, p: Player): string | null;
}

const BATTLECRIES_FOR_COFFEE = 5;
const SALES_FOR_LEAVES = 4;
const ZUZUNI_FOR_RESEARCH = 3;
const POT_SIZE = 3;
const ZUZUNI: Tribe = 'cloister'; // Omar Evans' "Zuzuni" units (assumed to be Cloister, the ninja tribe)

/** Avenge (n) for a hero power: count friendly deaths this combat, fire every n. */
function heroAvenge(s: Side, id: string, n: number): boolean {
  s.heroAvenge[id] = (s.heroAvenge[id] ?? 0) + 1;
  if (s.heroAvenge[id] < n) return false;
  s.heroAvenge[id] = 0;
  return true;
}

/** Hero Powers nobody alive has (and that still mean something mid-game: not the "start of the game" ones) (as their hero or a power they've gained), whose faction is in play: what Abragail and New Power choose from */
export function freshPowers(g: GameState): HeroDef[] {
  const taken = new Set<string>();
  for (const q of g.players) if (q.alive) { if (q.hero) taken.add(q.hero); q.powers.forEach((x) => taken.add(x)); }
  return HEROES.filter((h) => h.id !== 'abragail' && !h.startOnly && !taken.has(h.id) && (!h.needsTribe || g.tribes.includes(h.needsTribe)));
}

export const HEROES: HeroDef[] = [
  {
    id: 'andromeda_robin', name: 'Andromeda Robin', title: 'Potato witch', power: 'Pumpkin Buddy', avatar: 0, health: 24, passive: true, startOnly: true,
    text: 'Start the game with a 1/1 Pumpkin. It has every tribe and gains the Deathrattle of any other unit that dies in combat.',
    onGain: (g, p) => { gainNew(g, p, 'pumpkin'); },
  },
  {
    id: 'gelf_lanz', name: 'Gelf Lanz', title: 'Leader of the Azure Order', power: 'Inspire', avatar: 1, health: 25, cost: 3, needsTribe: 'azure',
    text: 'Gain an Azure unit. This costs 1 less each time you buy an Azure unit.',
    costFn: (g, p) => Math.max(0, 3 - (p.heroMem.azureBought ?? 0)),
    onBuy: (g, p, u) => { if (isTribe(u, 'azure')) p.heroMem.azureBought = (p.heroMem.azureBought ?? 0) + 1; },
    use: (g, p) => {
      gainNew(g, p, drawFromPool(g, (id) => isTribe(id, 'azure') && def(id).tier <= p.tier));
      p.heroMem.azureBought = 0; // the discount starts over: back to 3 (not written on the power, on purpose)
    },
  },
  {
    id: 'derby_pocket', name: 'Derby Pocket', title: 'Ex-Business Demon intern', power: 'Coffee Run', avatar: 2, health: 25, passive: true,
    text: `After you play ${BATTLECRIES_FOR_COFFEE} Arrive units, your first Arrive each turn happens an extra time.`,
    onPlay: (g, p, u) => {
      if (!hasBattlecry(u.cardId)) return;
      p.heroMem.coffee = (p.heroMem.coffee ?? 0) + 1;
    },
    // once it's going: the first Arrive unit you play each turn (in the Tavern) Arrives twice
    battlecryTimes: (p, inShop) => (inShop && (p.heroMem.coffee ?? 0) >= BATTLECRIES_FOR_COFFEE && p.battlecryUnitsThisTurn === 1 ? 2 : 1),
    progress: (g, p) => ((p.heroMem.coffee ?? 0) >= BATTLECRIES_FOR_COFFEE ? 'Active' : `${p.heroMem.coffee ?? 0}/${BATTLECRIES_FOR_COFFEE}`),
  },
  {
    id: 'bunny_wizard', name: 'Bunny Wizard', title: 'A very soft healer', power: 'New Friends', avatar: 3, health: 27, cost: 1, needsTribe: 'kindred',
    text: 'Discover a Kindred unit. (Unlocks at Tavern Tier 4.)',
    locked: (g, p) => (p.tier < 4 ? 'Unlocks at Tavern Tier 4' : null),
    use: (g, p) => queueDiscover(g, p, discoverOptions(g, (id) => isTribe(id, 'kindred') && def(id).tier <= p.tier), 'New Friends: Discover a Kindred unit'),
  },
  {
    id: 'croh_vosh', name: 'Croh Vosh', title: 'The drowned lich', power: 'Abyssal Sweep', avatar: 4, health: 26, passive: true,
    text: 'Units you summon during combat get Taunt and +1/+2.',
    onSummon: (c, s, u) => { u.atk += 1; u.hp += 2; if (!u.kw.includes('taunt')) u.kw.push('taunt'); },
  },
  {
    id: 'may_danaris', name: 'May Danaris', title: 'Hacker from the neon district', power: 'Root Access', avatar: 5, health: 20, cost: 2,
    text: "Discover a unit from your last opponent's army.",
    locked: (g, p) => (p.lastOpponentBoard.length ? null : 'No opponent fought yet'),
    use: (g, p) => {
      const ids = [...new Set(p.lastOpponentBoard.map((u) => u.cardId))];
      queueDiscover(g, p, sample(g, ids, 3), "Root Access: Discover a unit from your last opponent's army");
    },
  },
  {
    id: 'locas_clare', name: 'Locas Clare', title: 'Prankster and lockpick', power: 'Stealing A Boat', avatar: 6, health: 30,
    text: 'Steal every unit in the Tavern (they go to your hand), then this resets to 7. Costs 1 less each turn.', // (not the Spell)
    costFn: (g, p) => Math.max(0, 7 - (g.round - (p.heroMem.locasFrom ?? 1))),
    locked: (g, p) => (!p.shop.some((u) => !isSpell(u)) ? 'The Tavern is empty' : p.hand.length >= CONFIG.handSize ? 'Your hand is full' : null),
    use: (g, p) => {
      for (const u of p.shop.filter((x) => !isSpell(x))) {
        if (p.hand.length >= CONFIG.handSize) break;
        p.shop.splice(p.shop.indexOf(u), 1);
        gainCard(g, p, u);
      }
      p.heroMem.locasFrom = g.round + 1; // back to 7 next turn
      log(p, 'Locas cleaned out the Tavern!');
    },
  },
  {
    id: 'venice_gorn', name: 'Venice Gorn', title: 'Potato farmer', power: 'Sow Seeds', avatar: 7, health: 23, cost: 2,
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
    id: 'omar_evans', name: 'Omar Evans', title: 'Bug ninja of the green', power: 'Leaf Cloak', avatar: 8, health: 26, passive: true, needsTribe: ZUZUNI,
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
    id: 'eve_williams', name: 'Eve Williams', title: 'Revolutionary', power: 'Doom Bauble', avatar: 9, health: 26, cost: 1, targetShop: true,
    text: 'Select a unit in the Tavern. When you have space in a battle, FIRE it at a random enemy.',
    locked: (g, p) => (!p.shop.some((u) => !isSpell(u)) ? 'The Tavern is empty' : null),
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
    id: 'abragail', name: 'Abragail', title: 'Scholar of the Azura Academy', power: 'Well-Studied', avatar: 10, health: 20, passive: true,
    text: 'At the start of turn 4, Discover two Hero Powers to replace this one.',
    startTurn: (g, p) => {
      if (g.round < 4 || p.heroMem.studied) return;
      p.heroMem.studied = 1;
      const pool = freshPowers(g);
      const six = sample(g, pool, 6).map((h) => h.id);
      queuePowerDiscover(g, p, six.slice(0, 3), 'Well-Studied: Choose your first new Hero Power');
      queuePowerDiscover(g, p, six.slice(3, 6), 'Well-Studied: Choose your second new Hero Power');
    },
    progress: (g, p) => (g.round < 4 ? `Turn ${g.round}/4` : null),
  },
  {
    id: 'bill_milton', name: 'Bill Milton', title: 'CEO of the Business Demons', power: 'Golden Parachute', avatar: 11, health: 26, passive: true, needsTribe: 'demons',
    text: 'Whenever you buy a Business Demon, gain 1 Gold.',
    onBuy: (g, p, u) => { if (isTribe(u, 'demons')) p.gold += 1; },
  },
  {
    id: 'clover', name: 'Clover', title: 'Dragon of Dragon Bridge', power: 'Broodmother', avatar: 12, health: 20, passive: true,
    text: 'Avenge (4): Summon a 1/1 Dragon and improve this (+1/+1 to future Dragons).',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'clover', 4)) return;
      const lvl = s.owner.heroMem.brood ?? 0;
      const d = c.spawn(s, 'dragon', false, s.units.length);
      if (d) { d.atk += lvl; d.hp += lvl; }
      if (s.persistent) s.owner.heroMem.brood = lvl + 1;
      c.snap('trigger', { note: 'Broodmother: Summon a Dragon', noteSide: s.idx });
    },
    progress: (g, p) => `Dragons ${1 + (p.heroMem.brood ?? 0)}/${1 + (p.heroMem.brood ?? 0)}`,
  },
  {
    id: 'mazrael_bettencourt', name: 'Mazrael Bettencourt', title: 'Vampire of the Secret Arts', power: '1000 Years Old', avatar: 14, passive: true, startOnly: true,
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
    id: 'trevor_l', name: 'Trevor L', title: 'Rock and roll skeleton', power: 'Party All Night', avatar: 13, health: 23, passive: true,
    text: 'Avenge (5): Give a random friendly unit Reborn.',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'trevor_l', 5)) return;
      const u = pick(c.g, s.units.filter((x) => x.hp > 0 && !x.kw.includes('reborn')));
      if (!u) return;
      addKw(u, 'reborn');
      c.snap('trigger', { source: u.id, note: 'Party All Night: Reborn' });
    },
  },
  {
    id: 'lori_ann_davis', name: 'Lori-Ann Davis', title: 'Zuzuni researcher', power: 'Deep Research', avatar: 15, health: 25, passive: true, needsTribe: ZUZUNI,
    text: `After you play ${ZUZUNI_FOR_RESEARCH} Cloister units, upgrading your Tavern costs 3 less. (Repeats.)`,
    onPlay: (g, p, u) => {
      if (!isTribe(u, ZUZUNI)) return;
      p.heroMem.research = (p.heroMem.research ?? 0) + 1;
      if (p.heroMem.research >= ZUZUNI_FOR_RESEARCH) {
        p.heroMem.research = 0;
        p.upgradeCost = Math.max(0, p.upgradeCost - 3);
        log(p, 'Deep Research: upgrading costs 3 less');
      }
    },
    progress: (g, p) => `${p.heroMem.research ?? 0}/${ZUZUNI_FOR_RESEARCH}`,
  },
  {
    id: 'robot_boy_hero', name: 'Robot Boy', title: 'A real-life robot boy', power: "I'm Robot Boy", avatar: 16, health: 25, passive: true, startOnly: true,
    text: 'Start the game with a 1/1 Orbo Pet with Doomstrike and every tribe.',
    onGain: (g, p) => { gainNew(g, p, 'orbo_pet'); },
  },
  {
    id: 'zara', name: 'Zara', title: 'Student of healing magic', power: 'Read the Material', avatar: 17, health: 25, passive: true,
    text: 'After you increase your Tavern Tier, gain 2 Gold.',
    onTierUp: (g, p) => { p.gold += 2; },
  },
  {
    id: 'marn_torf', name: 'Marn Torf', title: 'Magic chef', power: 'Into the Pot', avatar: 18, health: 25, cost: 0, targetShop: true,
    text: `Remove a unit from the Tavern. After you've removed ${POT_SIZE}, Discover a unit from their tribes.`,
    use: (g, p, t) => {
      if (!t) return;
      const i = p.shop.indexOf(t);
      if (i < 0) return;
      p.shop.splice(i, 1);
      returnToPool(g, t); // back in the pool, like a unit rerolled away
      const tribe = def(t.cardId).tribe;
      p.heroMem[`pot_${tribe}`] = 1;
      p.heroMem.pot = (p.heroMem.pot ?? 0) + 1;
      log(p, `Into the Pot: ${def(t.cardId).name}`);
      if (p.heroMem.pot < POT_SIZE) return;
      const tribes = Object.keys(p.heroMem).filter((k) => k.startsWith('pot_')).map((k) => k.slice(4));
      for (const k of Object.keys(p.heroMem)) if (k.startsWith('pot_') || k === 'pot') delete p.heroMem[k];
      queueDiscover(g, p, discoverOptions(g, (id) => tribes.includes(def(id).tribe) && def(id).tier <= p.tier), 'Into the Pot: Discover a unit');
    },
    locked: (g, p) => (p.shop.some((u) => !isSpell(u)) ? null : 'The Tavern is empty'),
    progress: (g, p) => `${p.heroMem.pot ?? 0}/${POT_SIZE}`,
  },
  {
    id: 'oren_bark', name: 'Oren Bark', title: 'Reckless chemist', power: 'D6 Potion', avatar: 19, health: 25, cost: 1,
    text: 'Roll a D6. Gain that much Gold. You can use this again after that many turns.',
    use: (g, p) => {
      const roll = 1 + Math.floor(rand(g) * 6);
      p.gold += roll;
      p.heroMem.potionWait = roll;
      log(p, `D6 Potion: rolled a ${roll}`);
    },
    locked: (g, p) => ((p.heroMem.potionWait ?? 0) > 0 ? `Ready in ${p.heroMem.potionWait} turn${p.heroMem.potionWait === 1 ? '' : 's'}` : null),
    startTurn: (g, p) => { if ((p.heroMem.potionWait ?? 0) > 0) p.heroMem.potionWait--; },
    progress: (g, p) => ((p.heroMem.potionWait ?? 0) > 0 ? `${p.heroMem.potionWait} turn${p.heroMem.potionWait === 1 ? '' : 's'}` : 'Ready'),
  },
];

export interface TrinketDef {
  id: string;
  name: string;
  text: string;
  cost: number;
  greater?: boolean;
  /** only offered when this tribe is in the match (like heroes' needsTribe) */
  needsTribe?: Tribe;
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
  { id: 'healing_draught', name: "Techin'", cost: 0, text: 'Gain 3 Gold. Your Tavern no longer offers Tier 1 or 2 units.', onGain: (g, p) => { p.gold += 3; } },
  { id: 'whetstone', name: 'Crop Circle', cost: 1, needsTribe: 'brambor', text: 'End of Turn: Gain a random Brambor unit.', endTurn: (g, p) => {
    const id = drawFromPool(g, (cid) => isTribe(cid, 'brambor') && def(cid).tier <= p.tier);
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
  { id: 'bronze_compass', name: 'Purple Bracer', cost: 2, needsTribe: 'neverending', text: 'Your Neverending units (wherever they are) have +12 Attack.' }, // see effStats
  { id: 'iron_bracer', name: 'Big Big Shield', cost: 2, text: 'Start of Combat: Give 2 random friendly units Bubble.', soc: (c, s) => { for (const u of sample(c.g, s.units.filter((x) => x.hp > 0 && !x.kw.includes('divineShield')), 2)) addKw(u, 'divineShield'); } },
  { id: 'rattler', name: 'Rattler', cost: 2, text: 'Start of Combat: Give 4 random friendly units "Deathrattle: Summon a random Tier 1 unit."',
    soc: (c, s) => { for (const u of sample(c.g, s.units.filter((x) => x.hp > 0), 4)) u.mem.rattle = (u.mem.rattle ?? 0) + 1; } },
  { id: 'spare_parts', name: 'Spare Parts', cost: 3, text: 'Every time you play a unit, give a random unit in your hand +2/+2.', onPlay: (g, p) => { const u = pick(g, handUnits(p)); if (u) { u.atk += 2; u.hp += 2; } } },
  { id: 'war_drum', name: 'War Drum', cost: 3, text: 'Start of Combat: Give your units +2 Attack.', soc: (c, s) => { for (const u of s.units) u.atk += 2; } },
  { id: 'lucky_coin', name: 'Lucky Coin', cost: 0, text: 'Gain 8 Gold.', onGain: (g, p) => { p.gold += 8; } },
  { id: 'summit_key', name: 'Summit Key', cost: 2, text: 'In two turns, Discover a Tier 6 unit.',
    onGain: (g, p) => { p.heroMem.summitAt = g.round + 2; },
    startTurn: (g, p) => {
      if (p.heroMem.summitAt !== g.round) return;
      delete p.heroMem.summitAt;
      queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === 6), 'Summit Key: Discover a Tier 6 unit');
    } },
  { id: 'double_thing', name: 'Double Thing', cost: 1, text: 'When you get your Greater Trinket, this becomes another copy of it.' }, // see pickTrinket
  { id: 'incense', name: 'Incense', cost: 3, needsTribe: 'neverending', text: 'Start of Combat: Give your left-most and right-most Neverending units Reborn.',
    soc: (c, s) => {
      const nv = s.units.filter((u) => u.hp > 0 && isTribe(u, 'neverending'));
      for (const u of new Set([nv[0], nv[nv.length - 1]])) if (u) addKw(u, 'reborn');
    } },
  { id: 'gem_time', name: 'It is Officially Gem Time', cost: 4, text: 'Fill your hand with random Gems.',
    onGain: (g, p) => {
      const gems = [...GEMS];
      while (p.hand.length < CONFIG.handSize && gems.length) gainNew(g, p, pick(g, gems)!);
    } },
  // greater (offered at the start of turn 9)
  { id: 'dont_even_know', name: "I don't even KNOW", cost: 5, greater: true, text: 'Fill your hand with random units.',
    onGain: (g, p) => {
      while (p.hand.length < CONFIG.handSize) {
        const id = drawFromPool(g, (cid) => def(cid).tier <= p.tier);
        if (!id) break;
        gainNew(g, p, id);
      }
    } },
  { id: 'bannerlords_standard', name: "Bannerlord's Standard", cost: 3, greater: true, text: 'Start of Combat: Give your units +3/+3.', soc: (c, s) => { for (const u of s.units) { u.atk += 3; u.hp += 3; } } },
  { id: 'aegis_charm', name: 'Charm of Charms', cost: 4, greater: true, text: 'Start of Combat: Give your 2 left-most units Bubble.', soc: (c, s) => { for (const u of s.units.slice(0, 2)) addKw(u, 'divineShield'); } },
  { id: 'hourglass_of_plenty', name: 'Guys Comin Up Outta the Woodwork', cost: 4, greater: true, text: 'Avenge (6): Summon a random Deathrattle unit.',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'hourglass_of_plenty', 6)) return;
      const ids = Object.keys(c.g.pool).filter((id) => EFFECTS[id]?.deathrattle && !def(id).token && def(id).tier <= s.owner.tier);
      const id = pick(c.g, ids);
      if (id && c.spawn(s, id, false, s.units.length)) c.snap('trigger', { note: `${trinketDef('hourglass_of_plenty').name}: Summon ${def(id).name}`, noteSide: s.idx });
    } },
  { id: 'new_power', name: 'New Power', cost: 4, greater: true, text: 'Discover a new Hero Power to replace your current one.',
    onGain: (g, p) => {
      const current = p.powers[0] ?? p.hero!;
      const pool = freshPowers(g);
      queuePowerDiscover(g, p, sample(g, pool, 3).map((h) => h.id), 'New Power: Choose a Hero Power to replace yours', current);
    } },
  { id: 'another_chance', name: 'Another Chance', cost: 4, greater: true, text: 'The first time you run out of Health, restore your Health to 10 and gain 10 Gold.' }, // see endCombat (game.ts)
  { id: 'phoenix_feather', name: 'Fenix Down', cost: 5, greater: true, text: 'Start of Combat: Give your left-most unit Reborn.', soc: (c, s) => { const u = s.units.find((x) => x.hp > 0); if (u) addKw(u, 'reborn'); } },
  { id: 'warlords_horn', name: 'Horn of Horn', cost: 5, greater: true, text: 'Avenge (8): Increase your maximum Gold by 1.',
    onFriendlyDeath: (c, s) => {
      if (!heroAvenge(s, 'warlords_horn', 8)) return;
      if (s.persistent) s.owner.maxGoldBonus += 1;
      c.snap('trigger', { note: `${trinketDef('warlords_horn').name}: +1 maximum Gold`, noteSide: s.idx });
    } },
  { id: 'gravebell', name: "Bell o' the Grave", cost: 6, greater: true, text: 'Your Deathrattles trigger an extra time.' },
  { id: 'golden_lantern', name: 'Golden Brass', cost: 6, greater: true, text: 'Every other End of Turn: Make a random non-Golden unit in your army Golden.',
    endTurn: (g, p) => { if (everyOther(p, 'golden_lantern')) makeGolden(g, p); },
    progress: (p) => `${p.heroMem.t_golden_lantern ?? 0}/2` },
  { id: 'crown_of_echoes', name: 'Double Crown: Fusion', cost: 7, greater: true, text: 'Your Arrive effects trigger an extra time.' },
  { id: 'summit_vault', name: 'Secret Guy', cost: 4, greater: true, text: 'Discover two Tier 6 units.',
    onGain: (g, p) => {
      for (let i = 0; i < 2; i++) queueDiscover(g, p, discoverOptions(g, (id) => def(id).tier === 6), `${trinketDef('summit_vault').name}: Discover a Tier 6 unit`);
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
  gold.mem = { ...u.mem }; // keeps being locked (Commitment), counters and so on
  delete gold.mem.pv; delete gold.mem.pa; // (Turtlepult starts watching it fresh)
  p.board[p.board.indexOf(u)] = gold;
  log(p, `${trinketDef('golden_lantern').name} made ${d.name} Golden!`);
}

export function shopBonus(p: Player): number {
  return powersOf(p).reduce((n, h) => n + (h.shopBonus ?? 0), 0) + p.trinkets.reduce((s, t) => s + (trinketDef(t).shopBonus ?? 0), 0);
}

/** Offer a Trinket choice (free: Devotion's). If one is already open, this one waits and comes up after it. */
export function offerTrinkets(g: GameState, p: Player, greater: boolean, free = false) {
  if (p.trinketOffer) { (p.trinketQueue ??= []).push({ greater, free }); return; }
  p.trinketFree = free;
  const pool = TRINKETS.filter((t) => !!t.greater === greater && !p.trinkets.includes(t.id) && (!t.needsTribe || g.tribes.includes(t.needsTribe)));
  p.trinketOffer = sample(g, pool, 4).map((t) => t.id);
  if (!p.trinketOffer.length) { p.trinketOffer = null; nextTrinketOffer(g, p); } // (none left to offer)
}

/** the open choice is settled: bring up the next one waiting, if any */
function nextTrinketOffer(g: GameState, p: Player) {
  const next = p.trinketQueue?.shift();
  if (next) offerTrinkets(g, p, next.greater, next.free);
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
  if (h.targetShop && target && isSpell(target)) return false; // (Tavern powers take units, not the Spell)
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
  /** extra Arrive triggers from hero powers (each power's battlecryTimes - 1, added up) */
  battlecryExtra: (p: Player, inShop = false) => powersOf(p).reduce((s, h) => s + ((h.battlecryTimes?.(p, inShop) ?? 1) - 1), 0),
  battlecryExtraName: (p: Player, inShop = false) => powersOf(p).find((h) => (h.battlecryTimes?.(p, inShop) ?? 1) > 1)?.power ?? '',
  startTurn: (g: GameState, p: Player) => {
    for (const h of powersOf(p)) if (h.startTurn) heroFx(g, p, h, () => h.startTurn!(g, p));
    for (const t of trinketsOf(p)) if (t.startTurn) trinketFx(g, p, t, () => t.startTurn!(g, p));
  },
  onTierUp: (g: GameState, p: Player) => { for (const h of powersOf(p)) if (h.onTierUp) heroFx(g, p, h, () => h.onTierUp!(g, p)); },
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
    p.trinketFree = false;
    nextTrinketOffer(g, p);
    return true;
  }
  if (!p.trinketOffer.includes(id)) return false;
  const t = trinketDef(id);
  const cost = p.trinketFree ? 0 : t.cost; // Devotion's Trinket is free
  if (p.gold < cost) return false;
  p.gold -= cost;
  p.trinkets.push(id);
  p.trinketOffer = null;
  p.trinketFree = false;
  t.onGain?.(g, p);
  // Double Thing becomes another copy of your Greater Trinket (which then works twice, gain effect included)
  const dt = p.trinkets.indexOf('double_thing');
  if (t.greater && dt >= 0) {
    p.trinkets[dt] = id;
    log(p, `Double Thing became another ${t.name}!`);
    t.onGain?.(g, p);
  }
  nextTrinketOffer(g, p);
  return true;
}

/** What a unit costs you to buy (hero discounts included). */
export function buyCost(p: Player, cardId?: string): number {
  // a Spell: its own price (Haste costs Health instead: no Gold)
  if (cardId && isSpell(cardId)) { const d = def(cardId); return d.healthCost ? 0 : d.cost ?? 0; }
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
/** copies of a trinket you have (Double Thing can make a second) */
export const trinketCount = (p: Player, id: string) => (p.trinkets ?? []).filter((t) => t === id).length;
export { effStats };

// hero progress for the effect events (e.g. "Coffee Run 2/5"); kept here so fx.ts doesn't import heroes
fxHooks.heroProgress = (g, p) => powersOf(p).map((h) => { const t = h.progress?.(g, p); return t ? `${h.power} ${t}` : ''; }).filter(Boolean).join(' · ');
