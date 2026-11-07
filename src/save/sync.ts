/**
 * Cloud save sync: keeps this device's progress (rating, achievements, the game in progress, a few settings)
 * the same as the cloud copy, using whichever provider is available (cloud.ts).
 *
 * Each pass reads the cloud copy, merges it with this device's data against the last copy both agreed on
 * (doc.ts), writes the result back only if nobody else wrote in between (otherwise it merges again), then
 * applies it here. Passes run shortly after something changes, when the app goes to the background, at start,
 * and every few minutes. Everything also keeps working offline; it catches up next time.
 */
import type { CloudProvider } from './cloud';
import { isBlank, localDoc, mergeDocs, sameDoc, type SaveDoc } from './doc';
import { SYNCED_KEYS, getMeta, setMeta, store, type SyncedKey } from './store';
import { supabase } from './providers/supabase';
import { gameCenter, googlePlay, steam } from './providers/platform';

declare const __CLOUD__: boolean;

export type SyncState = 'off' | 'signedOut' | 'idle' | 'busy' | 'error';

const PROVIDERS: CloudProvider[] = [steam, googlePlay, gameCenter, supabase];

const S = {
  state: 'idle' as SyncState,
  last: 0,
  error: '',
  timer: 0 as ReturnType<typeof setTimeout> | 0,
  chain: Promise.resolve(),
  again: false,
  /** set when this device's progress was combined with an account that already had progress */
  combined: false,
};
const listeners: (() => void)[] = [];
const appliedHooks: ((keys: SyncedKey[]) => void)[] = [];
/** keys the app is using right now and mustn't be swapped underneath it (the game being played) */
let busyKeys: () => SyncedKey[] = () => [];

const enabled = () => (typeof __CLOUD__ === 'undefined' ? true : __CLOUD__);

/** the provider in use: a platform's own cloud when there is one, otherwise the Torrekin account */
export function provider(): CloudProvider | null {
  if (!enabled()) return null;
  return PROVIDERS.find((p) => p.kind === 'platform' && p.available() && p.signedIn())
    ?? (supabase.available() ? supabase : null);
}

export function state(): SyncState {
  const p = provider();
  if (!p) return 'off';
  if (!p.signedIn()) return 'signedOut';
  return S.state;
}

export function statusText(): string {
  const st = state();
  if (st === 'off' || st === 'signedOut') return '';
  if (st === 'busy') return 'Saving to the cloud…';
  if (S.error) return S.error;
  if (!S.last) return 'Not synced yet';
  const s = Math.round((Date.now() - S.last) / 1000);
  return s < 60 ? 'Synced just now' : s < 3600 ? `Synced ${Math.round(s / 60)} min ago` : `Synced ${new Date(S.last).toLocaleString()}`;
}

function emit() { for (const f of listeners) f(); }

/** write the merged copy into this device (keys the app is busy with stay as they are and win next time) */
function apply(doc: SaveDoc) {
  const skip = busyKeys();
  const changed: SyncedKey[] = [];
  for (const k of SYNCED_KEYS) {
    const v = doc.keys[k]?.value ?? null;
    if (store.get(k) === v) continue;
    if (skip.includes(k)) { S.again = true; continue; }
    store.setFromCloud(k, v, doc.keys[k]?.mt ?? Date.now());
    changed.push(k);
  }
  if (changed.length) for (const f of appliedHooks) f(changed);
}

async function pass(p: CloudProvider) {
  const account = p.accountId()!;
  for (let attempt = 0; attempt < 4; attempt++) {
    const local = localDoc();
    const meta = getMeta();
    const base = meta.base?.account === account ? (meta.base.doc as SaveDoc) : null;
    const cloud = await p.read();
    let doc: SaveDoc;
    if (!cloud) {
      doc = local;
      const r = await p.write(doc, null);
      if (!r.ok) continue;
    } else {
      if (!base && isBlank(local)) doc = cloud.doc;
      else {
        doc = mergeDocs(base, local, cloud.doc);
        if (!base && !isBlank(cloud.doc) && !isBlank(local)) S.combined = true;
      }
      if (!sameDoc(doc, cloud.doc)) {
        const r = await p.write(doc, cloud.rev);
        if (!r.ok) continue; // another device saved in between: start over with its copy
      }
    }
    // anything that happened here during the pass is kept (merged on top, and sent next pass)
    const now = localDoc();
    if (!sameDoc(now, local)) { doc = mergeDocs(local, now, doc); S.again = true; }
    apply(doc);
    setMeta({ ...getMeta(), base: { account, doc } });
    S.last = Date.now();
    S.error = '';
    return;
  }
  throw new Error('Couldn’t save to the cloud because another device kept changing it. It will try again.');
}

/** run a sync pass now (queued behind any pass already running) */
export function syncNow(): Promise<void> {
  const p = provider();
  if (!p || !p.signedIn()) return S.chain;
  S.chain = S.chain.then(async () => {
    S.state = 'busy';
    S.again = false;
    emit();
    try {
      await pass(p);
      S.state = 'idle';
    } catch (e) {
      S.error = (e as Error).message || 'Cloud save failed. It will try again.';
      S.state = 'error';
    }
    emit();
    if (S.again) schedule(4000);
  }).catch(() => undefined);
  return S.chain;
}

function schedule(ms = 2500) {
  if (!provider()?.signedIn()) return;
  clearTimeout(S.timer as ReturnType<typeof setTimeout>);
  S.timer = setTimeout(() => void syncNow(), ms);
}

/** true once after a sign-in combined this device's progress with the account's */
export function takeCombined(): boolean {
  const c = S.combined;
  S.combined = false;
  return c;
}

export const sync = {
  onStatus(f: () => void) { listeners.push(f); },
  /** called after cloud data replaced local data (so caches can reload and the screen can redraw) */
  onApplied(f: (keys: SyncedKey[]) => void) { appliedHooks.push(f); },
  /** tell sync which keys the app is actively using (not replaced mid-game) */
  setBusyKeys(f: () => SyncedKey[]) { busyKeys = f; },
  /** a new account was signed in: forget the merge base from any previous one and sync now */
  async signedIn() { S.last = 0; S.error = ''; await syncNow(); },
  /** sign out: push last changes, then forget the session (this device keeps its data) */
  async signOut() {
    await syncNow();
    if (supabase.signedIn()) await supabase.signOut();
    setMeta({ ...getMeta(), base: null });
    S.last = 0; S.error = ''; S.state = 'idle';
    emit();
  },
  start() {
    if (!enabled()) return;
    store.onChange(() => schedule());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void syncNow();
      else if (Date.now() - S.last > 60000) void syncNow();
    });
    setTimeout(() => void syncNow(), 1200);
    setInterval(() => { if (Date.now() - S.last > 5 * 60000) void syncNow(); emit(); }, 30000);
  },
};
