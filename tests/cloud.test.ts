/**
 * Cloud saves: the merge rules, and a full sync against an in-memory stand-in for Supabase (two devices,
 * offline changes on both, a conflicting write in between).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mergeDocs, emptyDoc, type SaveDoc } from '../src/save/doc';

const doc = (keys: Record<string, unknown>, mt = 1): SaveDoc => {
  const d = emptyDoc();
  for (const [k, v] of Object.entries(keys)) (d.keys as Record<string, unknown>)[k] = { mt, value: v === null ? null : JSON.stringify(v) };
  return d;
};
const val = (d: SaveDoc, k: string) => JSON.parse((d.keys as Record<string, { value: string }>)[k].value);

describe('cloud save merge', () => {
  it('takes the side that changed', () => {
    const base = doc({ 'torrekin-art': 'illustrated' });
    const local = doc({ 'torrekin-art': 'illustrated' });
    const cloud = doc({ 'torrekin-art': 'classic' }, 2);
    expect(val(mergeDocs(base, local, cloud), 'torrekin-art')).toBe('classic');
    expect(val(mergeDocs(base, cloud, local), 'torrekin-art')).toBe('classic');
  });

  it('adds up achievement progress from both devices and keeps every unlock', () => {
    const base = doc({ 'torrekin-achievements': { unlocked: { a: 5 }, stats: { bought: 10 } } });
    const local = doc({ 'torrekin-achievements': { unlocked: { a: 5, b: 9 }, stats: { bought: 14 } } }, 3);
    const cloud = doc({ 'torrekin-achievements': { unlocked: { a: 5, c: 7, b: 8 }, stats: { bought: 13, sold: 2 } } }, 2);
    const m = val(mergeDocs(base, local, cloud), 'torrekin-achievements');
    expect(m.unlocked).toEqual({ a: 5, b: 8, c: 7 });
    expect(m.stats).toEqual({ bought: 17, sold: 2 });
  });

  it('keeps the newer rating, both histories and the total games', () => {
    const r = (rating: number, games: number, at: number[]) => ({ rating, games, peak: rating, v: 2, history: at.map((t) => ({ at: t, place: 1, delta: 10, rating })) });
    const base = doc({ 'torrekin-rating': r(1000, 2, [1, 2]) });
    const local = doc({ 'torrekin-rating': r(1040, 3, [1, 2, 10]) }, 10);
    const cloud = doc({ 'torrekin-rating': r(1020, 4, [1, 2, 5, 6]) }, 6);
    const m = val(mergeDocs(base, local, cloud), 'torrekin-rating');
    expect(m.rating).toBe(1040);
    expect(m.games).toBe(5);
    expect(m.history.map((h: { at: number }) => h.at)).toEqual([1, 2, 5, 6, 10]);
  });

  it('first sign-in on a device with progress combines it with the account', () => {
    const local = doc({ 'torrekin-achievements': { unlocked: { a: 1 }, stats: { won: 2 } } }, 5);
    const cloud = doc({ 'torrekin-achievements': { unlocked: { b: 2 }, stats: { won: 3 } } }, 4);
    const m = val(mergeDocs(null, local, cloud), 'torrekin-achievements');
    expect(m.unlocked).toEqual({ a: 1, b: 2 });
    expect(m.stats.won).toBe(5);
  });
});

/** an in-memory Supabase: auth + the game_saves table with the same conditional-update behaviour */
function fakeSupabase() {
  const rows = new Map<string, { data: unknown; updated_at: string }>();
  let clock = 0;
  const users = new Map<string, string>([['me@x.com', 'secret1']]);
  const json = (status: number, body: unknown) => new Response(body === undefined ? '' : JSON.stringify(body), { status });
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (u.pathname === '/auth/v1/token') {
      if (body.refresh_token) return json(200, { access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: 'me@x.com' } });
      if (users.get(body.email) !== body.password) return json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: body.email } });
    }
    if (u.pathname === '/rest/v1/game_saves') {
      const key = 'u1/torrekin/profile';
      const q = (k: string) => u.searchParams.get(k)?.replace(/^eq\./, '');
      if (init.method === 'POST') {
        if (rows.has(key)) return json(409, { code: '23505' });
        rows.set(key, { data: body.data, updated_at: `t${++clock}` });
        return json(201, undefined);
      }
      if (init.method === 'PATCH') {
        const row = rows.get(key);
        if (!row || row.updated_at !== q('updated_at')) return json(200, []);
        rows.set(key, { data: body.data, updated_at: `t${++clock}` });
        return json(200, [rows.get(key)]);
      }
      const row = rows.get(key);
      return json(200, row ? [row] : []);
    }
    return json(404, {});
  });
  return { rows, fetchMock, bump: () => { const r = rows.get('u1/torrekin/profile')!; rows.set('u1/torrekin/profile', { ...r, updated_at: `t${++clock}` }); } };
}

describe('cloud save sync (two devices)', () => {
  let server: ReturnType<typeof fakeSupabase>;
  beforeEach(() => {
    vi.resetModules();
    server = fakeSupabase();
    vi.stubGlobal('fetch', server.fetchMock);
  });

  /** load a fresh copy of the save modules: a separate "device" with its own storage */
  async function device() {
    vi.resetModules();
    const store = (await import('../src/save/store')).store;
    const sync = await import('../src/save/sync');
    const sb = (await import('../src/save/providers/supabase')).supabase;
    return { store, sync, sb };
  }

  it('moves progress between devices and merges changes made on both', async () => {
    const a = await device();
    a.store.setJSON('torrekin-achievements', { unlocked: { first: 1 }, stats: { bought: 3 } });
    expect(await a.sb.signIn('me@x.com', 'secret1', false)).toBe('signedIn');
    await a.sync.syncNow();
    expect(a.sync.state()).toBe('idle');
    expect(server.rows.size).toBe(1);

    const b = await device();
    await b.sb.signIn('me@x.com', 'secret1', false);
    await b.sync.syncNow();
    expect(b.store.getJSON('torrekin-achievements')).toEqual({ unlocked: { first: 1 }, stats: { bought: 3 } });

    // both play offline, then sync; B syncs second and must not lose A's progress
    a.store.setJSON('torrekin-achievements', { unlocked: { first: 1, a: 5 }, stats: { bought: 5 } });
    b.store.setJSON('torrekin-achievements', { unlocked: { first: 1, b: 6 }, stats: { bought: 4 } });
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.store.getJSON('torrekin-achievements')).toEqual({ unlocked: { first: 1, a: 5, b: 6 }, stats: { bought: 6 } });
    await a.sync.syncNow();
    expect(a.store.getJSON('torrekin-achievements')).toEqual({ unlocked: { first: 1, a: 5, b: 6 }, stats: { bought: 6 } });
  });

  it('retries when another device writes in between', async () => {
    const a = await device();
    await a.sb.signIn('me@x.com', 'secret1', false);
    a.store.set('torrekin-art', 'classic');
    await a.sync.syncNow();
    a.store.set('torrekin-speed', '2');
    // someone else saves just before A's write
    const real = server.fetchMock.getMockImplementation()!;
    let once = true;
    server.fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (once && init.method === 'PATCH') { once = false; server.bump(); }
      return real(url, init);
    });
    await a.sync.syncNow();
    expect(a.sync.state()).toBe('idle');
    const saved = server.rows.get('u1/torrekin/profile')!.data as SaveDoc;
    expect(saved.keys['torrekin-speed']?.value).toBe('2');
  });

  it('explains a wrong password', async () => {
    const a = await device();
    const { friendly } = await import('../src/save/providers/supabase');
    await expect(a.sb.signIn('me@x.com', 'nope', false)).rejects.toSatisfy((e) => friendly(e) === 'Wrong email or password.');
  });
});
