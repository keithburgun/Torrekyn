/**
 * Store/OS cloud saves: Steam Cloud, Google Play Games Saved Games, iCloud (Game Center).
 *
 * These need a small native piece in the app wrapper, which doesn't exist yet. The game side is ready: when the
 * wrapper provides the bridge below, the provider switches on and the sync engine uses it instead of accounts.
 *
 * Bridge contract (all JSON text, one save "file" called torrekin_profile.json):
 *   status()            -> { signedIn: boolean, user: string }          who is signed in to the platform
 *   read()              -> { text: string | null, rev: string | null }  the stored file and its version tag
 *   write(text, rev)    -> { ok: boolean, rev: string }                 ok false = rev didn't match (conflict)
 *
 * Steam (Windows/Linux app, Tauri): add Rust commands `steam_cloud_status/read/write` using the `steamworks`
 *   crate's RemoteStorage (file write/read; rev = file timestamp). Turn on Steam Cloud for the app in Steamworks
 *   (byte quota ~1 MB is plenty). Steam Auto-Cloud would also work with no code, by syncing the app's data folder.
 * Google Play (Android, Capacitor): a plugin `CloudSave` wrapping Play Games Services v2 SnapshotsClient
 *   (open snapshot "torrekin_profile", read/write contents; rev = snapshot modification time).
 * App Store (iOS, Capacitor): the same `CloudSave` plugin backed by NSUbiquitousKeyValueStore or a CloudKit record.
 */
import { CloudError, type CloudCopy, type CloudProvider, type WriteResult } from '../cloud';
import type { SaveDoc } from '../doc';

interface Bridge {
  status(): Promise<{ signedIn: boolean; user: string }>;
  read(): Promise<{ text: string | null; rev: string | null }>;
  write(text: string, rev: string | null): Promise<{ ok: boolean; rev: string }>;
}

type W = Window & {
  __TAURI__?: { core?: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> } };
  Capacitor?: { isPluginAvailable?(n: string): boolean; Plugins?: Record<string, Record<string, (a?: unknown) => Promise<unknown>>> };
};

/** Steam: Tauri commands provided by the desktop wrapper */
const win = (): W | null => (typeof window === 'undefined' ? null : (window as W));

function steamBridge(): Bridge | null {
  const inv = win()?.__TAURI__?.core?.invoke;
  if (!inv || !(win() as W & { __STEAM__?: boolean }).__STEAM__) return null; // the Steam build sets window.__STEAM__
  return {
    status: () => inv('steam_cloud_status') as ReturnType<Bridge['status']>,
    read: () => inv('steam_cloud_read') as ReturnType<Bridge['read']>,
    write: (text, rev) => inv('steam_cloud_write', { text, rev }) as ReturnType<Bridge['write']>,
  };
}

/** Google Play / iCloud: the Capacitor plugin `CloudSave` */
function capacitorBridge(): Bridge | null {
  const cap = win()?.Capacitor;
  const p = cap?.isPluginAvailable?.('CloudSave') ? cap.Plugins?.CloudSave : undefined;
  if (!p) return null;
  return {
    status: () => p.status() as ReturnType<Bridge['status']>,
    read: () => p.read() as ReturnType<Bridge['read']>,
    write: (text, rev) => p.write({ text, rev }) as ReturnType<Bridge['write']>,
  };
}

function platformProvider(id: 'steam' | 'googlePlay' | 'gameCenter', label: string, bridge: () => Bridge | null, when: () => boolean): CloudProvider {
  let user: string | null = null;
  let checked = false;
  const b = () => (when() ? bridge() : null);
  // ask the platform who's signed in once, in the background
  const check = () => {
    const br = b();
    if (checked || !br) return;
    checked = true;
    br.status().then((s) => { user = s.signedIn ? s.user : null; }).catch(() => { user = null; });
  };
  return {
    id, label, kind: 'platform',
    available: () => { check(); return !!b(); },
    signedIn: () => { check(); return !!user; },
    accountId: () => (user ? `${id}:${user}` : null),
    async read(): Promise<CloudCopy | null> {
      const r = await b()!.read().catch(() => { throw new CloudError(`Couldn’t read your ${label} save.`); });
      if (!r.text) return null;
      return { doc: JSON.parse(r.text) as SaveDoc, rev: r.rev ?? '' };
    },
    async write(doc: SaveDoc, rev: string | null): Promise<WriteResult> {
      const r = await b()!.write(JSON.stringify(doc), rev).catch(() => { throw new CloudError(`Couldn’t write your ${label} save.`); });
      return r.ok ? { ok: true, rev: r.rev } : { ok: false, conflict: true };
    },
  };
}

const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

export const steam = platformProvider('steam', 'Steam Cloud', steamBridge, () => true);
export const googlePlay = platformProvider('googlePlay', 'Google Play Games', capacitorBridge, () => !isIOS());
export const gameCenter = platformProvider('gameCenter', 'iCloud', capacitorBridge, isIOS);
