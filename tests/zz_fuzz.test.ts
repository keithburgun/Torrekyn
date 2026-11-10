import { it } from 'vitest';
import { newGame, selectHero, endTurn } from '../src/engine/game';
import { CARDS, CONFIG, makeUnit, def } from '../src/engine/core';
import { runCombat } from '../src/engine/combat';
import { HEROES } from '../src/engine/heroes';
import { profileForSkill } from '../src/engine/personas';
import type { GameState, Player, Unit } from '../src/engine/types';

const KW = new Set(['taunt', 'divineShield', 'reborn', 'venomous', 'poisonous', 'windfury']);
const IDS = new Set(CARDS.map((c) => c.id));
const problems = new Map<string, number>();
const note = (k: string) => problems.set(k, (problems.get(k) ?? 0) + 1);

function checkUnit(u: Unit, where: string) {
  if (!IDS.has(u.cardId)) note(`${where}: unknown card ${u.cardId}`);
  for (const [k, v] of [['atk', u.atk], ['hp', u.hp]] as const) if (!Number.isFinite(v) || !Number.isInteger(v)) note(`${where}: ${u.cardId} ${k}=${v}`);
  if (u.atk < 0) note(`${where}: ${u.cardId} negative atk ${u.atk}`);
  if (u.hp < 1 && where !== 'shop') note(`${where}: ${u.cardId} hp ${u.hp}`);
  for (const k of u.kw) if (!KW.has(k)) note(`${where}: ${u.cardId} bad keyword ${k}`);
  if (new Set(u.kw).size !== u.kw.length) note(`${where}: ${u.cardId} duplicate keywords ${u.kw}`);
  if (where === 'shop' && def(u.cardId).tier > CONFIG.maxTier) note(`shop offers Tier ${def(u.cardId).tier} ${u.cardId}`);
  for (const [k, v] of Object.entries(u.mem ?? {})) if (typeof v === 'number' && !Number.isFinite(v)) note(`${where}: ${u.cardId} mem.${k}=${v}`);
}
function check(g: GameState) {
  const uids = new Map<number, string>();
  for (const p of g.players) {
    if (!Number.isFinite(p.gold) || p.gold < 0) note(`gold ${p.gold} (${p.hero})`);
    if (!Number.isFinite(p.health)) note(`health ${p.health}`);
    if (p.tier < 1 || p.tier > CONFIG.maxTier) note(`tier ${p.tier}`);
    if (p.board.length > CONFIG.boardSize) note(`board ${p.board.length} (${p.hero})`);
    if (p.hand.length > CONFIG.handSize) note(`hand ${p.hand.length} (${p.hero})`);
    if (!p.alive) continue;
    for (const [zone, list] of [['board', p.board], ['hand', p.hand], ['shop', p.shop]] as const) {
      for (const u of list) {
        checkUnit(u, zone);
        const prev = uids.get(u.uid);
        if (prev) note(`duplicate uid in ${prev} and ${zone}:${p.id} (${u.cardId})`);
        uids.set(u.uid, `${zone}:${p.id}`);
      }
    }
    if (p.slots) for (const s of p.slots) if (s && (!Number.isFinite(s.atk) || !Number.isFinite(s.hp))) note('slot NaN');
  }
}

it('fuzz full games', () => {
  const expert = profileForSkill(1);
  const N = Number(process.env.FUZZ ?? 120);
  let rounds = 0, stuck = 0, errors = 0;
  const heroCount = new Map<string, number>();
  for (let s = 0; s < N; s++) {
    const g = newGame(900000 + s * 7);
    g.simulateAll = true;
    const offer = (g.players.find((p) => p.human) as Player).heroOffer!;
    selectHero(g, offer[s % offer.length]);
    for (const p of g.players) { p.bot = { ...expert, ...(s % 3 === 0 ? { tribe: g.tribes[s % 4] } : {}) }; heroCount.set(p.hero ?? '?', (heroCount.get(p.hero ?? '?') ?? 0) + 1); }
    let guard = 0;
    try {
      while (g.phase !== 'over' && guard++ < 80) { endTurn(g); check(g); rounds++; }
      if (g.phase !== 'over') stuck++;
    } catch (e) {
      errors++;
      note(`EXCEPTION seed ${s} round ${g.round}: ${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')}`);
    }
  }
  console.log(`games ${N}, rounds ${rounds}, stuck ${stuck}, errors ${errors}`);
  console.log('heroes seen', [...heroCount].map(([h, n]) => `${h}:${n}`).join(' '), 'missing', HEROES.filter((h) => !heroCount.has(h.id)).map((h) => h.id));
  console.log([...problems].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}x ${k}`).slice(0, 60).join('\n'));
}, 3600000);

it('fuzz random combats with every card (golden too)', () => {
  problems.clear();
  const ids = CARDS.filter((c) => !c.token).map((c) => c.id);
  const toks = CARDS.filter((c) => c.token).map((c) => c.id);
  let n = 0, frames = 0, ties = 0, stale = 0;
  for (let s = 0; s < Number(process.env.FUZZC ?? 3000); s++) {
    const g = newGame(100 + s);
    const [a, b] = g.players;
    const army = (off: number) => Array.from({ length: 1 + ((s + off) % 7) }, (_, i) => {
      const id = (i + s) % 11 === 0 && toks.length ? toks[(s + i + off) % toks.length] : ids[(s * 7 + i * 13 + off * 31) % ids.length];
      const u = makeUnit(g, id, (s + i) % 5 === 0);
      if (s % 4 === 0) { u.atk += 10; u.hp += 10; }
      return u;
    });
    a.board = army(0); b.board = army(3);
    a.hand = s % 2 ? [makeUnit(g, 'orange_ninja'), makeUnit(g, ids[s % ids.length])] : [];
    try {
      const r = runCombat(g, a, b, false);
      n++; frames += r.frames.length; if (r.winner === -1) ties++; if (r.stalemate) stale++;
      if (!r || !Array.isArray(r.frames ?? [])) note('no result');
      if ((r.frames?.length ?? 0) > 5000) note(`huge combat ${r.frames.length} frames: ${a.board.map((u) => u.cardId)} vs ${b.board.map((u) => u.cardId)}`);
      for (const p of [a, b]) for (const u of [...p.board, ...p.hand]) checkUnit(u, 'after-combat');
      if (a.board.length > CONFIG.boardSize || a.hand.length > CONFIG.handSize) note(`limits after combat board ${a.board.length} hand ${a.hand.length}`);
    } catch (e) {
      note(`COMBAT EXCEPTION seed ${s}: ${(e as Error).message} | ${(e as Error).stack?.split('\n')[1]?.trim()} | ${a.board.map((u) => u.cardId + (u.golden ? '*' : ''))} vs ${b.board.map((u) => u.cardId + (u.golden ? '*' : ''))}`);
    }
  }
  console.log(`combats ${n}, avg frames ${(frames / n).toFixed(1)}, ties ${ties}, stalemates ${stale}`);
  console.log([...problems].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}x ${k}`).slice(0, 60).join('\n'));
}, 3600000);
