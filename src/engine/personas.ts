/**
 * Bot personas: the rivals you meet. Each has a skill (0 = beginner, 1 = the Expert bot), a play-style
 * quirk, and an Elo rating measured by having them play each other (tests/calibrate.test.ts writes
 * src/data/personaElo.json). See DESIGN_NOTES "Bots and Elo".
 */
import type { BotProfile, Tribe } from './types';
import { FEATURES, type Feature } from './ai';
import eloData from '../data/personaElo.json';

/**
 * Skill to bot profile. Expert habits switch on as skill rises, most valuable last (so the top personas
 * are the ones that position by simulation and reroll with discipline); below that, evaluation noise and
 * blunders grow, and the weakest also level their Tavern late.
 */
const UNLOCK: Record<Feature, number> = {
  triples: 0.2, hero: 0.25, discover: 0.3, tribe: 0.35, value: 0.4, freeze: 0.5, econ: 0.55, spend: 0.6, reroll: 0.65, arrange: 0.8,
  level: 2, simbuy: 2, powerFirst: 2, // never (measured not to help)
};

export function profileForSkill(skill: number): BotProfile {
  const s = Math.max(0, Math.min(1, skill));
  const f = Object.fromEntries(FEATURES.map((k) => [k, s >= UNLOCK[k]])) as Record<string, boolean>;
  const x: Record<string, number> = {};
  if (s < 0.45) {
    // beginners level late and never on a whim
    f.level = true;
    const late = Math.round((0.45 - s) * 11);
    x.lvl3 = 5 + late; x.lvl4 = 8 + late; x.lvl5 = 10 + late; x.cheap = 0;
  }
  // beginners also wander off with gold unspent and hang on to weak units
  if (s < 0.5) { x.lazy = +((0.5 - s) * 1.2).toFixed(2); x.keep = +((0.5 - s) * 40).toFixed(1); }
  return { noise: +(3 * (1 - s) ** 2).toFixed(3), blunder: +(0.3 * (1 - s) ** 2).toFixed(3), f, x };
}

export interface Persona {
  id: string;
  /** username shown in game */
  name: string;
  skill: number;
  /** one line shown when you look at them */
  style: string;
  /** play-style quirks layered on the skill profile */
  quirk?: { tribe?: Tribe; x?: Record<string, number> };
}

export const PERSONAS: Persona[] = [
  // best first
  { id: 'norikajims', name: 'norikajims', skill: 1, style: 'Plays like the house always wins. Because it does.' },
  { id: 'sturmjurglers', name: 'sturmJurglers', skill: 0.85, style: 'Will sell their grandmother for a triple.', quirk: { x: { trip2: 80, trip1: 16 } } },
  { id: 'mint', name: 'mint', skill: 0.7, style: 'Thinks about positioning more than is healthy.' },
  { id: 'robodavids', name: 'robodavids_', skill: 0.62, style: 'Never met a Refresh button they didn\'t like.', quirk: { x: { rerollBar: 1.5 } } },
  { id: 'urchidscrawley', name: 'UrchidScrawley', skill: 0.56, style: 'Steady, sensible, a little smug about it.' },
  { id: 'jjessicasax', name: 'jjessica_sax', skill: 0.5, style: 'Reads every card. Twice.' },
  { id: 'dbrenners', name: 'D.brenners', skill: 0.45, style: 'Never first, never last, always fine.' },
  { id: 'rothazar08', name: 'Rothazar08', skill: 0.4, style: 'Plays Neverending whenever it shows up.', quirk: { tribe: 'neverending' } },
  { id: 'bogman', name: 'BOGMAN_', skill: 0.35, style: 'Brambor or bust. Usually bust.', quirk: { tribe: 'brambor' } },
  { id: 'dirchgavels', name: 'dirch-gavels-dds', skill: 0.3, style: 'Levels up fast and asks questions later.', quirk: { x: { lvl3: 4, lvl4: 6, lvl5: 8 } } },
  { id: 'fhowitt', name: 'f.howitt', skill: 0.25, style: 'Confident. Unclear why.' },
  { id: 'orbath', name: 'orbath', skill: 0.2, style: 'Kindred forever.', quirk: { tribe: 'kindred' } },
  { id: 'chocadillydoo', name: 'chocadillydoo', skill: 0.15, style: 'Clicks fast. Thinks later.' },
  { id: 'vivi001', name: 'vivi_001', skill: 0.1, style: 'Sure this strategy will work eventually.' },
  { id: 'mintyclyve', name: 'mintyclyve', skill: 0.05, style: 'Here for the art.' },
  { id: 'bunnihooligan', name: 'bunnihooligan', skill: 0, style: 'Just happy to be here.' },
];

export function personaById(id: string | undefined): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

/** The bot profile a persona plays with (skill profile plus quirks). */
export function personaProfile(per: Persona): BotProfile {
  const b = profileForSkill(per.skill);
  if (per.quirk?.x) b.x = { ...b.x, ...per.quirk.x };
  if (per.quirk?.tribe) b.tribe = per.quirk.tribe;
  return b;
}

/** measured ratings (calibration run); falls back to a line from 2000 (Expert) down if missing */
const ELO = eloData as Record<string, number>;
export function personaElo(per: Persona): number {
  return ELO[per.id] ?? Math.round(1000 + per.skill * 500);
}

/** the scale: the Expert bot is 1500, the weakest bot (and a new player) about 1000 */
export const EXPERT_ELO = 1500;

/**
 * Matchmaking: pick rivals near a rating, like Battlegrounds. Each persona's chance falls off with its
 * distance from the rating (about halving every 90 points), with a small floor so lobbies still vary.
 */
export function matchPersonas(rating: number, n: number, rnd: () => number): Persona[] {
  const left = [...PERSONAS];
  const out: Persona[] = [];
  while (out.length < n && left.length) {
    const w = left.map((p) => Math.max(0.015, Math.exp(-(((personaElo(p) - rating) / 110) ** 2))));
    let r = rnd() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < w.length - 1 && (r -= w[i]) > 0) i++;
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}
