/**
 * Where cloud saves live. Each place is a "provider" with the same small interface, so the sync engine
 * (sync.ts) doesn't care whether the save goes to our own account server, Steam Cloud or a phone's app store.
 *
 *  - supabase:   Torrekin accounts (email + password), shared with Spellstorm. Works everywhere: web, itch.io,
 *                Windows, Android. See providers/supabase.ts and docs/cloud-saves.md.
 *  - steam:      Steam Cloud, for a Steam release. See providers/platform.ts.
 *  - googlePlay: Google Play Games "Saved Games", for a Play Store release.
 *  - gameCenter: iCloud, for an App Store release.
 *
 * Platform providers sign in on their own (the player is already signed in to Steam / Google Play / iCloud);
 * when one is available it's used instead of an account.
 */
import type { SaveDoc } from './doc';

export interface CloudCopy {
  doc: SaveDoc;
  /** version tag of the stored copy, so a write can refuse to overwrite a copy it hasn't seen */
  rev: string;
}

export type WriteResult = { ok: true; rev: string } | { ok: false; conflict: true };

export interface CloudProvider {
  id: 'supabase' | 'steam' | 'googlePlay' | 'gameCenter';
  /** shown to the player, e.g. "Steam Cloud" */
  label: string;
  /** 'account': the player signs in with email (our UI); 'platform': signed in through the store/OS */
  kind: 'account' | 'platform';
  /** can this provider work in this build at all? */
  available(): boolean;
  /** is someone signed in (an account, or the platform user)? */
  signedIn(): boolean;
  /** a stable id for whoever is signed in (so a merge base from one account isn't used for another) */
  accountId(): string | null;
  /** read the cloud copy (null when there isn't one yet) */
  read(): Promise<CloudCopy | null>;
  /** write; `rev` is the revision this write is based on (null = there was no copy). Conflict when it changed. */
  write(doc: SaveDoc, rev: string | null): Promise<WriteResult>;
}

/** errors providers throw, with text fit to show the player */
export class CloudError extends Error {
  constructor(message: string, readonly status = 0, readonly code = '') { super(message); }
}
