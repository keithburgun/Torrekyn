/**
 * Cloud saves on Supabase (the same service and accounts as Spellstorm). Talks to Supabase's REST API with
 * fetch, no SDK. One row per player in the `game_saves` table (game = 'torrekin'); row-level security means a
 * player can only read and write their own row. Table setup: docs/cloud-saves.md.
 */
import { CLOUD } from '../../config';
import { CloudError, type CloudCopy, type CloudProvider, type WriteResult } from '../cloud';
import type { SaveDoc } from '../doc';
import { store } from '../store';

const SESSION = 'torrekin-account';
const GAME = 'torrekin';
const SLOT = 'profile';

interface Session { at: string; rt: string; exp: number; uid: string; email: string }

let ses: Session | null = store.getJSON<Session>(SESSION);
const keep = (s: Session | null) => { ses = s; store.setJSON(SESSION, s); };

async function call<T>(path: string, o: { method?: string; body?: unknown; tok?: string; prefer?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { apikey: CLOUD.supabaseKey, 'Content-Type': 'application/json' };
  if (o.tok) headers.Authorization = `Bearer ${o.tok}`;
  if (o.prefer) headers.Prefer = o.prefer;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 15000);
  let r: Response;
  try {
    r = await fetch(CLOUD.supabaseUrl + path, { method: o.method ?? 'GET', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ac.signal });
  } catch {
    throw new CloudError('Couldn’t reach the save server. Check your internet connection.');
  } finally {
    clearTimeout(to);
  }
  let j: Record<string, unknown> | null = null;
  try { const t = await r.text(); j = t ? JSON.parse(t) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    const code = String(j?.error_code ?? j?.code ?? '');
    const msg = String(j?.msg ?? j?.error_description ?? j?.message ?? j?.error ?? `Error ${r.status}`);
    throw new CloudError(msg, r.status, code);
  }
  return j as T;
}

/** what to tell the player for each kind of account error */
export function friendly(e: unknown): string {
  const err = e as CloudError;
  const byCode: Record<string, string> = {
    invalid_credentials: 'Wrong email or password.',
    user_already_exists: 'An account with that email already exists. Try signing in.',
    weak_password: 'Passwords need at least 6 characters.',
    email_address_invalid: 'That email address doesn’t look right.',
    email_not_confirmed: 'Please confirm your email address first (check your inbox), then sign in.',
    over_email_send_rate_limit: 'Too many emails sent. Please wait a few minutes and try again.',
    over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
    signup_disabled: 'New accounts are turned off at the moment.',
    PGRST205: 'Cloud saves aren’t set up on the server yet.',
    '42P01': 'Cloud saves aren’t set up on the server yet.',
  };
  return byCode[err?.code] ?? err?.message ?? 'Something went wrong. Please try again.';
}

const fromAuth = (j: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; user?: { id: string; email?: string } }): Session => ({
  at: j.access_token, rt: j.refresh_token,
  exp: j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in ?? 3600) * 1000,
  uid: j.user?.id ?? '', email: j.user?.email ?? '',
});

async function token(force = false): Promise<string> {
  if (!ses) throw new CloudError('Not signed in.', 401);
  if (force || Date.now() > ses.exp - 60000) {
    try {
      keep(fromAuth(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: ses.rt } })));
    } catch (e) {
      const st = (e as CloudError).status;
      if (st && st < 500 && st !== 429) { keep(null); throw new CloudError('Your sign-in expired. Please sign in again.', 401); }
      throw e;
    }
  }
  return ses!.at;
}

async function rest<T>(path: string, o: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  try {
    return await call<T>(path, { ...o, tok: await token() });
  } catch (e) {
    if ((e as CloudError).status === 401 && ses) return call<T>(path, { ...o, tok: await token(true) });
    throw e;
  }
}

export const supabase: CloudProvider & {
  email(): string | null;
  signIn(email: string, password: string, create: boolean): Promise<'signedIn' | 'confirmEmail'>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
} = {
  id: 'supabase',
  label: 'Torrekin account',
  kind: 'account',
  available: () => !!CLOUD.supabaseUrl && !!CLOUD.supabaseKey,
  signedIn: () => !!ses,
  accountId: () => (ses ? `supabase:${ses.uid}` : null),
  email: () => ses?.email ?? null,

  async read(): Promise<CloudCopy | null> {
    const rows = await rest<{ data: SaveDoc; updated_at: string }[]>(
      `/rest/v1/game_saves?select=data,updated_at&user_id=eq.${ses!.uid}&game=eq.${GAME}&slot=eq.${SLOT}`);
    return rows.length ? { doc: rows[0].data, rev: rows[0].updated_at } : null;
  },

  async write(doc: SaveDoc, rev: string | null): Promise<WriteResult> {
    const now = new Date().toISOString();
    if (rev === null) {
      try {
        await rest('/rest/v1/game_saves', { method: 'POST', prefer: 'return=minimal', body: { user_id: ses!.uid, game: GAME, slot: SLOT, data: doc, updated_at: now } });
        return { ok: true, rev: now };
      } catch (e) {
        if ((e as CloudError).status === 409) return { ok: false, conflict: true }; // another device created it first
        throw e;
      }
    }
    // only overwrite the copy we based this on: if another device saved in between, nothing matches
    const rows = await rest<unknown[]>(
      `/rest/v1/game_saves?user_id=eq.${ses!.uid}&game=eq.${GAME}&slot=eq.${SLOT}&updated_at=eq.${encodeURIComponent(rev)}`,
      { method: 'PATCH', prefer: 'return=representation', body: { data: doc, updated_at: now } });
    return rows?.length ? { ok: true, rev: now } : { ok: false, conflict: true };
  },

  async signIn(email, password, create) {
    const j = await call<Parameters<typeof fromAuth>[0] | null>(create ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password',
      { method: 'POST', body: { email: email.trim(), password } });
    if (!j?.access_token) {
      if (create) return 'confirmEmail';
      throw new CloudError('Couldn’t sign in. Please try again.');
    }
    keep(fromAuth(j));
    return 'signedIn';
  },

  async signOut() {
    try { if (ses) await call('/auth/v1/logout', { method: 'POST', tok: ses.at }); } catch { /* signing out locally is what matters */ }
    keep(null);
  },

  async resetPassword(email) {
    await call('/auth/v1/recover', { method: 'POST', body: { email: email.trim() } });
  },
};
