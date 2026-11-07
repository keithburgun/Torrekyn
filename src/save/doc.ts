/**
 * The save document that goes to the cloud, and how two copies are merged.
 *
 * A document holds every synced key (store.ts) with the time it last changed. When two devices both changed
 * things since they last agreed (the "base"), they're merged piece by piece so nothing earned is lost:
 *  - achievements: unlocks are combined (earliest unlock time wins); counters add up both devices' progress;
 *  - rating: the newer rating wins, game history is combined, games played add up, best is the higher;
 *  - the game in progress and settings: the newer one wins.
 */
import { SYNCED_KEYS, getMeta, store, type SyncedKey } from './store';

export interface SaveDoc {
  v: 1;
  /** per key: the stored text (null = nothing) and when it last changed */
  keys: Partial<Record<SyncedKey, { mt: number; value: string | null }>>;
}

export const emptyDoc = (): SaveDoc => ({ v: 1, keys: {} });

/** this device's data as a document */
export function localDoc(): SaveDoc {
  const mt = getMeta().mt;
  const doc = emptyDoc();
  for (const k of SYNCED_KEYS) {
    const value = store.get(k);
    if (value !== null || mt[k]) doc.keys[k] = { mt: mt[k] ?? 0, value };
  }
  return doc;
}

/** true when a document has no progress worth keeping (a fresh install) */
export function isBlank(d: SaveDoc): boolean {
  return SYNCED_KEYS.every((k) => d.keys[k]?.value == null);
}

export const sameDoc = (a: SaveDoc, b: SaveDoc) => SYNCED_KEYS.every((k) => (a.keys[k]?.value ?? null) === (b.keys[k]?.value ?? null));

const parse = <T>(s: string | null | undefined): T | null => {
  try { return s ? (JSON.parse(s) as T) : null; } catch { return null; }
};

interface Achievements { unlocked: Record<string, number>; stats: Record<string, number> }
interface Rating { rating: number; v?: number; games: number; peak: number; history: { at: number; place: number; delta: number; rating: number }[] }

/** counters: base plus what each side added (falls back to the larger if one went down) */
const addUp = (b: number, l: number, c: number) => (l >= b && c >= b ? b + (l - b) + (c - b) : Math.max(l, c));

function mergeAchievements(b: Achievements | null, l: Achievements, c: Achievements): Achievements {
  const unlocked: Record<string, number> = { ...c.unlocked };
  for (const [id, t] of Object.entries(l.unlocked ?? {})) unlocked[id] = id in unlocked ? Math.min(unlocked[id], t) : t;
  const stats: Record<string, number> = {};
  for (const k of new Set([...Object.keys(l.stats ?? {}), ...Object.keys(c.stats ?? {})])) {
    stats[k] = addUp(b?.stats?.[k] ?? 0, l.stats?.[k] ?? 0, c.stats?.[k] ?? 0);
  }
  return { unlocked, stats };
}

function mergeRating(b: Rating | null, l: Rating, c: Rating, localNewer: boolean): Rating {
  const newer = localNewer ? l : c;
  const seen = new Map<number, Rating['history'][number]>();
  for (const h of [...(c.history ?? []), ...(l.history ?? [])]) seen.set(h.at, h);
  const history = [...seen.values()].sort((x, y) => x.at - y.at).slice(-200);
  return { ...newer, games: addUp(b?.games ?? 0, l.games ?? 0, c.games ?? 0), peak: Math.max(l.peak ?? 0, c.peak ?? 0), history };
}

/**
 * Three-way merge: `base` is what both last agreed on, `local` this device, `cloud` the copy in the cloud.
 * Keys only one side changed take that side; keys both changed are merged (or the newer wins).
 */
export function mergeDocs(base: SaveDoc | null, local: SaveDoc, cloud: SaveDoc): SaveDoc {
  const out = emptyDoc();
  for (const k of SYNCED_KEYS) {
    const b = base?.keys[k];
    const l = local.keys[k];
    const c = cloud.keys[k];
    const lv = l?.value ?? null;
    const cv = c?.value ?? null;
    const bv = b?.value ?? null;
    let pick: { mt: number; value: string | null } | undefined;
    if (lv === cv) pick = (l?.mt ?? 0) >= (c?.mt ?? 0) ? l : c;
    else if (base && lv === bv) pick = c; // only the cloud changed
    else if (base && cv === bv) pick = l; // only this device changed
    else {
      const localNewer = (l?.mt ?? 0) >= (c?.mt ?? 0);
      const mt = Math.max(l?.mt ?? 0, c?.mt ?? 0);
      if (k === 'torrekin-achievements' && lv && cv) {
        pick = { mt, value: JSON.stringify(mergeAchievements(parse(bv), parse<Achievements>(lv)!, parse<Achievements>(cv)!)) };
      } else if (k === 'torrekin-rating' && lv && cv) {
        pick = { mt, value: JSON.stringify(mergeRating(parse(bv), parse<Rating>(lv)!, parse<Rating>(cv)!, localNewer)) };
      } else {
        pick = localNewer ? l : c;
      }
    }
    if (pick) out.keys[k] = pick;
  }
  return out;
}
