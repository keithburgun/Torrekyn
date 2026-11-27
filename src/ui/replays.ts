/**
 * Replays and Match History.
 *
 * Each round, the human's battle is recorded exactly as it was played (the frames the battle screen shows), along with
 * everyone's Health after it, so a replay plays back the same battle even after cards change. At the end of the game
 * the final standings are added. Matches live in IndexedDB (the last MAX_MATCHES); a match can be exported to a JSON
 * file and imported again (from you or anyone else).
 */
import { def } from '../engine/core';
import type { CombatResult, CombatFrameUnit, GameState } from '../engine/types';
import { heroDef } from '../engine/heroes';
import { APP_VERSION } from './update';
import { cardArt, esc, heroArt } from './view';

export const MAX_MATCHES = 30;
const FORMAT = 'torrekin-replay';

export interface ReplayPlayer { name: string; hero?: string }
export interface ReplayBattle {
  round: number;
  meSide: 0 | 1;
  oppId: number;
  /** everyone's Health after this battle (by player id) */
  health: number[];
  /** your Tavern Tier this round */
  tier: number;
  r: CombatResult;
}
export interface Standing { id: number; place: number; name: string; hero?: string; health: number; board: { cardId: string; golden: boolean; atk: number; hp: number }[] }
export interface MatchMeta {
  id: string;
  /** the game version that recorded it */
  v: string;
  at: number;
  ended?: number;
  hero?: string;
  place?: number;
  rounds: number;
  rating?: { before: number; after: number; delta: number };
  players: ReplayPlayer[];
  standings?: Standing[];
  imported?: boolean;
}
export interface MatchRecord extends MatchMeta { battles: ReplayBattle[] }

// ---------- storage (IndexedDB: 'meta' holds the list, 'battles' the heavy part) ----------

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open('torrekin-replays', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('battles')) d.createObjectStore('battles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
function done(t: IDBTransaction) { return new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
function reqP<T>(r: IDBRequest<T>) { return new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

/** (kept in memory too, so the game-over screen works even if storage doesn't) */
const live = new Map<string, MatchRecord>();

async function put(rec: MatchRecord) {
  live.set(rec.id, rec);
  const d = await db();
  if (!d) return;
  try {
    const t = d.transaction(['meta', 'battles'], 'readwrite');
    const { battles, ...meta } = rec;
    t.objectStore('meta').put(meta);
    t.objectStore('battles').put(battles, rec.id);
    await done(t);
  } catch { /* storage full or unavailable: the match still plays back this session */ }
}

export async function listMatches(): Promise<MatchMeta[]> {
  const d = await db();
  let out: MatchMeta[] = [];
  if (d) {
    try { out = await reqP(d.transaction('meta').objectStore('meta').getAll() as IDBRequest<MatchMeta[]>); } catch { out = []; }
  }
  for (const r of live.values()) if (!out.some((m) => m.id === r.id)) { const { battles: _b, ...m } = r; out.push(m); }
  return out.sort((a, b) => b.at - a.at);
}

export async function getMatch(id: string): Promise<MatchRecord | null> {
  const mem = live.get(id);
  if (mem) return mem;
  const d = await db();
  if (!d) return null;
  try {
    const t = d.transaction(['meta', 'battles']);
    const meta = await reqP(t.objectStore('meta').get(id) as IDBRequest<MatchMeta | undefined>);
    const battles = await reqP(t.objectStore('battles').get(id) as IDBRequest<ReplayBattle[] | undefined>);
    return meta ? { ...meta, battles: battles ?? [] } : null;
  } catch { return null; }
}

export async function deleteMatch(id: string) {
  live.delete(id);
  const d = await db();
  if (!d) return;
  try {
    const t = d.transaction(['meta', 'battles'], 'readwrite');
    t.objectStore('meta').delete(id);
    t.objectStore('battles').delete(id);
    await done(t);
  } catch { /* ignore */ }
}

/** keep the newest MAX_MATCHES (your own games and imports alike) */
async function prune() {
  const all = await listMatches();
  for (const m of all.slice(MAX_MATCHES)) await deleteMatch(m.id);
}

// ---------- recording ----------

function matchId(g: GameState): string {
  if (!g.replayId) g.replayId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return g.replayId;
}

async function current(g: GameState): Promise<MatchRecord> {
  const id = matchId(g);
  const have = live.get(id) ?? (await getMatch(id));
  if (have) { live.set(id, have); return have; }
  const rec: MatchRecord = {
    id, v: APP_VERSION, at: Date.now(), hero: g.players[0].hero, rounds: 0,
    players: g.players.map((p) => ({ name: p.name, hero: p.hero })), battles: [],
  };
  live.set(id, rec);
  return rec;
}

/** a battle of yours has been fought: keep it (call before it plays, with everyone's Health already after it) */
export async function recordBattle(g: GameState, r: CombatResult, meSide: 0 | 1, oppId: number, round: number) {
  const rec = await current(g);
  if (rec.battles.some((b) => b.round === round)) return;
  rec.players = g.players.map((p) => ({ name: p.name, hero: p.hero }));
  rec.hero = g.players[0].hero;
  rec.battles.push({ round, meSide, oppId, tier: g.players[0].tier, health: g.players.map((p) => p.health), r });
  rec.rounds = round;
  await put(rec);
  if (rec.battles.length === 1) await prune();
}

/** the game is over: the final standings (place, hero, Health, army) and your rating change */
export async function recordEnd(g: GameState, rating: MatchMeta['rating'] | null) {
  const rec = await current(g);
  rec.ended = Date.now();
  rec.place = g.players[0].placement || 1;
  rec.rounds = g.round;
  if (rating) rec.rating = rating;
  // (players still in when you're knocked out have no place yet: 0, listed first, by Health)
  rec.standings = g.players.map((p) => ({
    id: p.id, place: p.placement || 0, name: p.name, hero: p.hero, health: p.health,
    board: p.board.map((u) => ({ cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp })),
  })).sort((a, b) => (a.place || 0) - (b.place || 0) || b.health - a.health);
  await put(rec);
}

export function liveMatch(g: GameState | null): MatchRecord | null {
  return g?.replayId ? live.get(g.replayId) ?? null : null;
}

// ---------- export / import ----------

export function exportJson(rec: MatchRecord): string {
  return JSON.stringify({ format: FORMAT, formatVersion: 1, match: rec });
}

export function exportName(rec: MatchRecord): string {
  const d = new Date(rec.at);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hero = (heroDef(rec.hero)?.name ?? 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `torrekin-replay-${day}-${hero}.json`;
}

/** offer the file: the page's download capability when it has one (claude.ai), a plain download otherwise */
export async function saveFile(name: string, text: string): Promise<'saved' | 'declined' | 'failed'> {
  const cl = (window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (r: { filename: string; data: Blob }) => Promise<unknown> } | null> } }).claude;
  if (cl?.use) {
    try {
      const dl = await cl.use('downloads');
      if (dl) {
        try { await dl.save({ filename: name, data: new Blob([text], { type: 'application/json' }) }); return 'saved'; } catch (e) {
          const code = (e as { code?: string }).code;
          return code === 'declined' ? 'declined' : 'failed';
        }
      }
    } catch { /* fall through */ }
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'saved';
  } catch { return 'failed'; }
}

/** read an exported file back in (as a new entry if that match is already here) */
export async function importJson(text: string): Promise<MatchRecord> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("That file isn't a Torrekin replay."); }
  const o = data as { format?: string; match?: MatchRecord };
  const m = o?.match;
  if (o?.format !== FORMAT || !m || !Array.isArray(m.battles) || !Array.isArray(m.players)) throw new Error("That file isn't a Torrekin replay.");
  for (const b of m.battles) if (!b?.r || !Array.isArray(b.r.frames) || !Array.isArray(b.health)) throw new Error('That replay is damaged.');
  const rec: MatchRecord = { ...m, id: `imp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, imported: true };
  await put(rec);
  await prune();
  return rec;
}

// ---------- screens ----------

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const heroName = (id?: string) => (id ? heroDef(id)?.name ?? id : '?');
const knownCard = (id: string) => { try { def(id); return true; } catch { return false; } };

/** a unit as a small chip: its picture, name and stats */
function chip(u: { cardId: string; golden: boolean; atk: number; hp: number }) {
  const name = knownCard(u.cardId) ? def(u.cardId).name : u.cardId;
  return `<div class="rp-chip ${u.golden ? 'golden' : ''}" title="${esc(name)}"><span class="rp-art" style="background-image:url('${knownCard(u.cardId) ? cardArt(u.cardId) : ''}')"></span>
    <span class="rp-cn">${esc(name)}</span><span class="rp-st"><b class="a">${u.atk}</b><b class="h">${u.hp}</b></span></div>`;
}
const army = (us: { cardId: string; golden: boolean; atk: number; hp: number }[]) => (us.length ? us.map(chip).join('') : '<span class="hint" style="padding:0">(nobody left)</span>');

/** how a battle went, from your side */
export function battleOutcome(b: ReplayBattle) {
  const r = b.r;
  const won = r.winner === b.meSide, tie = r.winner === -1;
  const stale = tie ? r.stalemate?.[b.meSide] ?? 0 : 0;
  return { won, tie, label: tie ? (stale ? `Stalemate: took ${stale}` : 'Tie') : won ? `Won: dealt ${r.damage}` : `Lost: took ${r.damage}`, cls: tie ? 'tie' : won ? 'won' : 'lost' };
}

/** the start and end of a recorded battle: both armies as they began, and who was left */
export function finalBattleHtml(rec: MatchRecord, b?: ReplayBattle) {
  b ??= rec.battles[rec.battles.length - 1];
  if (!b) return '';
  const opp = rec.players[b.oppId];
  const first = b.r.frames[0], last = b.r.frames[b.r.frames.length - 1];
  const o = battleOutcome(b);
  const toChip = (u: CombatFrameUnit) => ({ cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp });
  const ghost = b.r.b === -1 && b.meSide === 0;
  return `<div class="rp-final">
    <div class="rp-fhead"><span class="rp-hero" style="background-image:url('${heroArt(opp?.hero)}')"></span>
      <div><div class="rp-ftitle">Round ${b.round}: ${ghost ? 'the Ghost of ' : ''}${esc(opp?.name ?? '?')} <span class="hint" style="padding:0">(${esc(heroName(opp?.hero))})</span></div>
      <div class="rp-res ${o.cls}">${o.label} · your Health after: ${Math.max(0, b.health[0] ?? 0)}</div></div></div>
    <div class="rp-row"><div class="rp-lab">Your army</div><div class="rp-chips">${army((first?.sides[b.meSide] ?? []).map(toChip))}</div></div>
    <div class="rp-row"><div class="rp-lab">Their army</div><div class="rp-chips">${army((first?.sides[1 - b.meSide] ?? []).map(toChip))}</div></div>
    <div class="rp-row"><div class="rp-lab">Still standing</div><div class="rp-chips">${army([...(last?.sides[b.meSide] ?? []), ...(last?.sides[1 - b.meSide] ?? [])].map(toChip))}</div></div>
  </div>`;
}

export function historyBody(list: MatchMeta[] | null, msg = '') {
  const rows = list === null ? '<div class="hint" style="padding:30px">Loading…</div>' : !list.length
    ? '<div class="hint" style="padding:30px">No matches yet. Finish a game (or import a replay) and it shows up here.</div>'
    : list.map((m) => `<div class="mh-row">
        <span class="rp-hero" style="background-image:url('${heroArt(m.hero)}')"></span>
        <div class="mh-main"><div class="mh-title">${m.place ? `<span class="mh-place p${m.place <= 4 ? 'win' : 'lose'}">${ordinal(m.place)}</span>` : '<span class="mh-place">Unfinished</span>'} ${esc(heroName(m.hero))}${m.imported ? ' <span class="mh-tag">Imported</span>' : ''}</div>
          <div class="hint" style="padding:0;text-align:left">${when(m.at)} · ${m.rounds} round${m.rounds === 1 ? '' : 's'}${m.rating ? ` · Rating ${m.rating.delta >= 0 ? '+' : ''}${m.rating.delta}` : ''}${m.v !== APP_VERSION ? ` · v${esc(m.v)}` : ''}</div></div>
        <div class="mh-btns"><button class="btn primary" data-act="rp-open" data-id="${esc(m.id)}">Watch</button>
          <button class="btn" data-act="rp-export" data-id="${esc(m.id)}">Export</button>
          <button class="btn" data-act="rp-delete" data-id="${esc(m.id)}" title="Delete">✕</button></div>
      </div>`).join('');
  return `<div class="mh-bar"><button class="btn" data-act="rp-import">Import Replay</button><span class="hint" style="padding:0">${list ? `${list.length} of the last ${MAX_MATCHES} matches kept on this device` : ''}</span></div>
    ${msg ? `<div class="mh-msg">${esc(msg)}</div>` : ''}
    ${rows}
    <input type="file" id="rp-file" accept=".json,application/json" style="display:none">`;
}

export function replayHtml(rec: MatchRecord, canWatch: boolean, msg = '') {
  const stand = rec.standings ? `<h3 class="ach-group">Final standings</h3><div class="rp-stand">${rec.standings.map((s) => `<div class="rp-srow ${s.id === 0 ? 'me' : ''}">
      <span class="rp-sp">${s.place ? ordinal(s.place) : `<small>Still in<br>${Math.max(0, s.health)} Health</small>`}</span><span class="rp-hero sm" style="background-image:url('${heroArt(s.hero)}')"></span>
      <span class="rp-sn">${esc(s.name)} <span class="hint" style="padding:0">${esc(heroName(s.hero))}</span></span>
      <div class="rp-chips">${s.board.length ? army(s.board) : '<span class="hint" style="padding:0">(no army)</span>'}</div></div>`).join('')}</div>` : '';
  const rounds = rec.battles.map((b, i) => {
    const o = battleOutcome(b);
    const opp = rec.players[b.oppId];
    return `<div class="rp-round"><span class="rp-rn">Round ${b.round}</span><span class="rp-hero sm" style="background-image:url('${heroArt(opp?.hero)}')"></span>
      <span class="rp-vs">vs ${b.r.b === -1 && b.meSide === 0 ? 'the Ghost of ' : ''}${esc(opp?.name ?? '?')}</span>
      <span class="rp-res ${o.cls}">${o.label}</span><span class="rp-hp">Health ${Math.max(0, b.health[0] ?? 0)}</span>
      <button class="btn primary" data-act="rp-watch" data-i="${i}" ${canWatch ? '' : 'disabled'}>▶ Watch</button></div>`;
  }).join('');
  return `<div class="modal" style="z-index:87"><div class="panel achv rp">
    <div class="cv-head"><h2>Replay</h2><span class="cv-count">${esc(heroName(rec.hero))} · ${rec.place ? `${ordinal(rec.place)} place` : 'unfinished'} · ${when(rec.at)}</span>
      <button class="btn" data-act="rp-watch" data-i="0" data-all="1" ${canWatch && rec.battles.length ? '' : 'disabled'}>▶ Watch all</button>
      <button class="btn" data-act="rp-export" data-id="${esc(rec.id)}">Export</button>
      <button class="btn" data-act="rp-close">Close</button></div>
    ${msg ? `<div class="mh-msg">${esc(msg)}</div>` : ''}
    ${!canWatch ? '<div class="mh-msg">Replays can be watched once this battle is over.</div>' : ''}
    <div class="ach-scroll">
      ${rec.battles.length ? `<h3 class="ach-group">Final battle</h3>${finalBattleHtml(rec)}` : '<div class="hint">No battles were recorded for this match.</div>'}
      ${stand}
      <h3 class="ach-group">Every round</h3><div class="rp-rounds">${rounds}</div>
    </div>
  </div></div>`;
}

/** what the battle screen needs from a game, rebuilt from a replay (names, heroes, Health after that battle) */
export function replayGame(rec: MatchRecord, b: ReplayBattle): GameState {
  return { players: rec.players.map((p, i) => ({ id: i, name: p.name, hero: p.hero, health: b.health[i] ?? 0 })) } as unknown as GameState;
}
