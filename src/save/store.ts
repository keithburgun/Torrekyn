/**
 * Local storage for everything that gets saved, with change tracking for cloud saves.
 *
 * Each synced key remembers when it last changed on this device ("mt"), so the sync engine (sync.ts) can tell
 * which side is newer when two devices both changed something. Writes go to localStorage; if that's unavailable
 * (private mode) the game still works for the session from memory.
 */

/** keys that follow you between devices (device-only settings like layout and sound stay local) */
export const SYNCED_KEYS = ['torrekin-rating', 'torrekin-achievements', 'torrekin-save', 'torrekin-art', 'torrekin-speed'] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];

const META = 'torrekin-sync-meta';
const memory = new Map<string, string | null>();
const listeners: (() => void)[] = [];

function rawGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}
function rawSet(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable: kept in memory */ }
}

export interface SyncMeta {
  /** when each synced key last changed on this device (ms) */
  mt: Partial<Record<SyncedKey, number>>;
  /** the copy both sides agreed on at the last sync (for three-way merges), per cloud account */
  base?: { account: string; doc: unknown } | null;
}

export function getMeta(): SyncMeta {
  try { return { mt: {}, ...JSON.parse(rawGet(META) ?? '{}') }; } catch { return { mt: {} }; }
}
export function setMeta(m: SyncMeta) {
  rawSet(META, JSON.stringify(m));
}

const isSynced = (k: string): k is SyncedKey => (SYNCED_KEYS as readonly string[]).includes(k);

export const store = {
  get(key: string): string | null { return rawGet(key); },
  getJSON<T>(key: string): T | null {
    try { const r = rawGet(key); return r ? (JSON.parse(r) as T) : null; } catch { return null; }
  },
  /** save a value; synced keys are stamped and the cloud sync is told something changed */
  set(key: string, value: string | null) {
    if (rawGet(key) === value) return;
    rawSet(key, value);
    if (isSynced(key)) {
      const m = getMeta();
      m.mt[key] = Date.now();
      setMeta(m);
      for (const f of listeners) f();
    }
  },
  setJSON(key: string, value: unknown) { this.set(key, value === null ? null : JSON.stringify(value)); },
  remove(key: string) { this.set(key, null); },
  /** written by the sync engine: a value that came from the cloud (no stamp, no "changed" signal) */
  setFromCloud(key: SyncedKey, value: string | null, mt: number) {
    rawSet(key, value);
    const m = getMeta();
    m.mt[key] = mt;
    setMeta(m);
  },
  onChange(f: () => void) { listeners.push(f); },
};
