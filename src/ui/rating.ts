/**
 * Your rating (Elo), kept in this browser. After each game it moves like Battlegrounds MMR: by where you
 * finished and how strong the lobby was. Each rival counts as a head-to-head match (you "won" against
 * everyone you finished above); the expected result against each comes from the usual Elo formula.
 * New players start mid-ladder (1400), facing middling bots; the weakest bot is about 1230 and the Expert 1500.
 */
import { store } from '../save/store';
import type { GameState } from '../engine/types';
import { personaById, personaElo } from '../engine/personas';

const KEY = 'torrekin-rating';
export const START_RATING = 1400;
/** ratings saved before the scale moved down 500 points get shifted once */
const SCALE_VERSION = 3;
/** points at stake per game (split across the 5 rivals); doubled for your first 10 games */
const K = 48;
const PROVISIONAL_GAMES = 10;

export interface RatingState {
  rating: number;
  v?: number;
  games: number;
  peak: number;
  history: { at: number; place: number; delta: number; rating: number }[];
}

export function getRating(): RatingState {
  try {
    const r = store.getJSON<RatingState>(KEY);
    if (r && typeof r.rating === 'number') {
      if (r.v !== SCALE_VERSION) {
        if ((r.v ?? 1) < 2) {
          r.rating -= 500; r.peak -= 500;
          for (const h of r.history) h.rating -= 500;
        }
        // v3: new players start mid-ladder; anyone below that moves up to it (the bottom bots got stronger)
        if (r.rating < START_RATING) { r.rating = START_RATING; r.peak = Math.max(r.peak, START_RATING); }
        r.v = SCALE_VERSION;
        save(r);
      }
      return r;
    }
  } catch { /* storage unavailable */ }
  return { rating: START_RATING, v: SCALE_VERSION, games: 0, peak: START_RATING, history: [] };
}

function save(r: RatingState) {
  store.setJSON(KEY, r);
}

export const isProvisional = (r: RatingState) => r.games < PROVISIONAL_GAMES;

/** Rating of a seat in the lobby (a persona's measured Elo). */
export function seatRating(g: GameState, id: number): number {
  const p = g.players[id];
  const per = personaById(p.persona);
  return per ? personaElo(per) : 1250;
}

/** Work out the change for this game without saving it. */
export function ratingChange(g: GameState, r = getRating()): { before: number; after: number; delta: number; place: number } {
  const me = g.players[0];
  const place = me.placement || 1;
  let sum = 0;
  for (const o of g.players.slice(1)) {
    const ro = seatRating(g, o.id);
    // rivals still alive when you were knocked out finished above you
    const above = o.alive && !me.alive;
    const s = !above && place < (o.placement || 1) ? 1 : 0;
    const e = 1 / (1 + 10 ** ((ro - r.rating) / 400));
    sum += s - e;
  }
  const k = isProvisional(r) ? K * 2 : K;
  const delta = Math.round((k * sum) / (g.players.length - 1));
  return { before: r.rating, after: r.rating + delta, delta, place };
}

/** Apply this game's result once (the game remembers it was rated). */
export function rateGame(g: GameState): ReturnType<typeof ratingChange> | null {
  if (g.rated || g.phase !== 'over') return null;
  const r = getRating();
  const c = ratingChange(g, r);
  r.rating = c.after;
  r.games++;
  r.peak = Math.max(r.peak, r.rating);
  r.history.push({ at: Date.now(), place: c.place, delta: c.delta, rating: c.after });
  if (r.history.length > 50) r.history.shift();
  save(r);
  g.rated = true;
  return c;
}
