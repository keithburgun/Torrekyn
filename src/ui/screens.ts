/** Extra screens: tribe announcement, card viewer, achievements. */
import { ALL_TRIBES, CARDS, TRIBE_NAMES, def } from '../engine/core';
import { EFFECTS } from '../engine/effects';
import type { CardDef, GameState, Tribe } from '../engine/types';
import { ACHIEVEMENTS, allStats, isUnlocked, progress, statValue, unlockedCount } from './achievements';
import { getRating } from './rating';
import { historyBody, type MatchMeta } from './replays';
import { abilityTags, bigCardHtml, cardArt, esc, heroArt } from './view';
import { HEROES, TRINKETS, heroHealth } from '../engine/heroes';

/** a sprite for each tribe on the announcement screen (no backdrop: the tribe's colour is on its name) */
const TRIBE_FACE = import.meta.glob('../assets/tribes/*.png', { eager: true, import: 'default' }) as Record<string, string>;
const tribeFace = (t: Tribe) => TRIBE_FACE[`../assets/tribes/${t}.png`] ?? '';

export function tribesAnnounceHtml(g: GameState) {
  const banned = ALL_TRIBES.filter((t) => !g.tribes.includes(t));
  const badge = (t: Tribe, i: number, on: boolean) => `
    <div class="tribe-badge ${on ? 'in' : 'out'} t-${t}" style="animation-delay:${on ? 200 + i * 220 : 1000 + i * 260}ms">
      <div class="tb-face" style="background-image:url('${tribeFace(t)}')"></div>
      <div class="tb-name">${esc(TRIBE_NAMES[t])}</div>
      ${on ? '' : `<div class="tb-stamp" style="animation-delay:${1250 + i * 260}ms">BANNED</div>`}
    </div>`;
  return `<div class="announce">
    <h2 class="an-title">This Match</h2>
    <div class="an-label in">In play</div>
    <div class="an-row">${g.tribes.map((t, i) => badge(t, i, true)).join('')}</div>
    <div class="an-label out">~ Banned ~</div>
    <div class="an-row small">${banned.map((t, i) => badge(t, i, false)).join('')}</div>
    <button class="btn big primary an-go" data-act="to-hero">Choose Your Hero</button>
  </div>`;
}

// ---------------- card viewer ----------------
export interface ViewerState {
  /** what's shown: units and Spells, heroes, or trinkets */
  tab?: 'cards' | 'heroes' | 'trinkets';
  /** trinkets: '' = all, 'lesser' or 'greater' */
  kind?: string;
  fromGame: boolean;
  onlyMatch: boolean;
  tribe: string; // '' = all
  tier: number; // 0 = all
  ability: string; // '' = all
  golden: boolean;
  q: string;
}

const ABILITIES: [string, (c: CardDef) => boolean][] = [
  ['Arrive', (c) => !!EFFECTS[c.id]?.battlecry],
  ['Deathrattle', (c) => !!EFFECTS[c.id]?.deathrattle],
  ['Rally', (c) => !!EFFECTS[c.id]?.rally],
  ['Avenge', (c) => !!EFFECTS[c.id]?.avenge],
  ['Start of Combat', (c) => !!EFFECTS[c.id]?.soc],
  ['End of Turn', (c) => !!EFFECTS[c.id]?.endTurn],
  ['Sell', (c) => !!EFFECTS[c.id]?.onSell],
  ['Discover', (c) => /discover/i.test(c.text)],
  ['Taunt', (c) => c.keywords.includes('taunt') || /taunt/i.test(c.text)],
  ['Bubble', (c) => c.keywords.includes('divineShield') || /bubble/i.test(c.text)],
  ['Reborn', (c) => c.keywords.includes('reborn') || /reborn/i.test(c.text)],
  ['Doomstrike', (c) => c.keywords.includes('venomous') || /doomstrike/i.test(c.text)],
  ['Poisonous', (c) => c.keywords.includes('poisonous') || /poisonous/i.test(c.text)],
  // an ability with no trigger word (Has..., Whenever..., After you..., When this...)
  ['Passive', (c) => abilityTags(c.id).includes('Passive')],
  ['Token', (c) => !!c.token],
];

export function filteredCards(v: ViewerState, g: GameState | null): CardDef[] {
  const q = v.q.trim().toLowerCase();
  const ab = ABILITIES.find(([n]) => n === v.ability)?.[1];
  return CARDS.filter((c) => {
    if (c.hidden) return false;
    if (v.onlyMatch && g && c.tribe !== 'neutral' && !g.tribes.includes(c.tribe)) return false;
    if (v.tribe === 'spell' ? !c.spell : v.tribe && (c.tribe !== v.tribe || c.spell)) return false;
    if (v.tier && c.tier !== v.tier) return false;
    if (ab && !ab(c)) return false;
    if (!v.ability && c.token && !q) return false; // tokens only when asked for
    if (q && !`${c.name} ${c.text} ${c.goldenText} ${TRIBE_NAMES[c.tribe]} ${abilityTags(c.id).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => a.tier - b.tier || a.tribe.localeCompare(b.tribe) || a.name.localeCompare(b.name));
}

const tribeNote = (t?: Tribe) => (t ? `<div class="cv-needs"><span class="tdot t-${t}"></span>Only with ${esc(TRIBE_NAMES[t])}</div>` : '');
const matches = (q: string, ...parts: string[]) => !q || parts.join(' ').toLowerCase().includes(q);

export function viewerHeroes(v: ViewerState, g: GameState | null) {
  const q = v.q.trim().toLowerCase();
  return HEROES.filter((h) => (!v.onlyMatch || !g || !h.needsTribe || g.tribes.includes(h.needsTribe)) && matches(q, h.name, h.title, h.power, h.text));
}
export function viewerTrinkets(v: ViewerState, g: GameState | null) {
  const q = v.q.trim().toLowerCase();
  return TRINKETS.filter((t) => (!v.onlyMatch || !g || !t.needsTribe || g.tribes.includes(t.needsTribe))
    && (!v.kind || (v.kind === 'greater') === !!t.greater) && matches(q, t.name, t.text)).sort((a, b) => Number(!!a.greater) - Number(!!b.greater) || a.cost - b.cost || a.name.localeCompare(b.name));
}

/** what the viewer's grid shows right now, and how many */
export function viewerGridHtml(v: ViewerState, g: GameState | null): string {
  if (v.tab === 'heroes') {
    const list = viewerHeroes(v, g);
    return list.length ? list.map((h) => `<div class="herocard cv-hero">
      <div class="hero-portrait" style="background-image:url('${heroArt(h.id)}')"><div class="hp">${heroHealth(h.id)}</div></div>
      <div class="hn">${esc(h.name)}</div>
      <div class="pc htitle">${esc(h.title)}</div>
      <div class="pw">${esc(h.power)} <span class="pc">(${h.passive ? 'Passive' : h.costFn ? 'cost varies' : `${h.cost} gold`})</span></div>
      <div class="pt">${esc(h.text)}</div>${tribeNote(h.needsTribe)}
    </div>`).join('') : '<div class="hint" style="padding:40px">No heroes match.</div>';
  }
  if (v.tab === 'trinkets') {
    const list = viewerTrinkets(v, g);
    return list.length ? list.map((t) => `<div class="trinketcard cv-trinket ${t.greater ? 'greater' : ''}">
      <div class="gem"></div><div class="tk-kind">${t.greater ? 'Greater' : 'Lesser'}</div><div class="tn">${esc(t.name)}</div><div class="tt">${esc(t.text)}</div>${tribeNote(t.needsTribe)}
      <div class="pc">${t.cost ? `${t.cost} <span class="coin"></span>` : 'Free'}</div></div>`).join('') : '<div class="hint" style="padding:40px">No trinkets match.</div>';
  }
  return cardGridHtml(v, g);
}
export function viewerCount(v: ViewerState, g: GameState | null): string {
  if (v.tab === 'heroes') { const n = viewerHeroes(v, g).length; return `${n} hero${n === 1 ? '' : 'es'}`; }
  if (v.tab === 'trinkets') { const n = viewerTrinkets(v, g).length; return `${n} trinket${n === 1 ? '' : 's'}`; }
  return `${filteredCards(v, g).length} cards`;
}

export function cardGridHtml(v: ViewerState, g: GameState | null) {
  const list = filteredCards(v, g);
  if (!list.length) return '<div class="hint" style="padding:40px">No cards match these filters.</div>';
  return list.map((c) => {
    const m = v.golden && !c.spell ? 2 : 1;
    return `<div class="cv-cell">${bigCardHtml({ cardId: c.id, golden: v.golden && !c.spell, atk: c.atk * m, hp: c.hp * m, kw: [...c.keywords] })}</div>`;
  }).join('');
}

export function cardViewerHtml(v: ViewerState, g: GameState | null) {
  const chip = (act: string, val: string, label: string, on: boolean, cls = '') => `<button class="chip ${on ? 'on' : ''} ${cls}" data-act="${act}" data-v="${val}">${label}</button>`;
  const tribes = [...ALL_TRIBES] as Tribe[]; // (Neutral isn't a faction)
  const tab = v.tab ?? 'cards';
  const filters = tab === 'cards' ? `
    <div class="cv-filters">
      ${chip('cv-tribe', '', 'All tribes', !v.tribe)}${tribes.map((t) => chip('cv-tribe', t, `<span class="tdot t-${t}"></span>${esc(TRIBE_NAMES[t])}`, v.tribe === t, g && t !== 'neutral' && !g.tribes.includes(t) ? 'banned' : '')).join('')}${chip('cv-tribe', 'spell', '<span class="tdot t-spell"></span>Spells', v.tribe === 'spell')}
    </div>
    <div class="cv-filters">
      ${chip('cv-tier', '0', 'All tiers', !v.tier)}${[1, 2, 3, 4, 5, 6].map((t) => chip('cv-tier', String(t), `Tier ${t}`, v.tier === t)).join('')}
      <span class="cv-sep"></span>
      ${chip('cv-ab', '', 'Any ability', !v.ability)}${ABILITIES.map(([n]) => chip('cv-ab', n, n, v.ability === n)).join('')}
    </div>` : tab === 'trinkets' ? `
    <div class="cv-filters">${chip('cv-kind', '', 'All trinkets', !v.kind)}${chip('cv-kind', 'lesser', 'Lesser (turn 6)', v.kind === 'lesser')}${chip('cv-kind', 'greater', 'Greater (turn 9)', v.kind === 'greater')}</div>` : '';
  return `<div class="modal" style="z-index:85"><div class="panel cv">
    <div class="cv-head">
      <h2>Card Viewer</h2>
      <div class="cv-tabs">${chip('cv-tab', 'cards', 'Cards', tab === 'cards')}${chip('cv-tab', 'heroes', 'Heroes', tab === 'heroes')}${chip('cv-tab', 'trinkets', 'Trinkets', tab === 'trinkets')}</div>
      <input id="cv-search" type="search" placeholder="Search names and text" value="${esc(v.q)}" autocomplete="off">
      ${tab === 'cards' ? `<label class="cv-check"><input type="checkbox" data-act="cv-golden" ${v.golden ? 'checked' : ''}> Golden</label>` : ''}
      ${v.fromGame && g ? `<label class="cv-check"><input type="checkbox" data-act="cv-match" ${v.onlyMatch ? 'checked' : ''}> Only ${tab === 'cards' ? 'cards' : tab} in this match</label>` : ''}
      <span class="cv-count" id="cv-count">${viewerCount(v, g)}</span>
      <button class="btn" data-act="cv-close">Close</button>
    </div>${filters}
    <div class="cv-grid ${tab !== 'cards' ? `cv-${tab}` : ''}" id="cv-grid">${viewerGridHtml(v, g)}</div>
  </div></div>`;
}

// ---------------- achievements ----------------
export type StatsTab = 'stats' | 'achievements' | 'history';

/** the Stats screen: your numbers, Achievements and Match History, as tabs */
export function statsPanelHtml(tab: StatsTab, list: MatchMeta[] | null, msg: string) {
  const t = (v: StatsTab, label: string) => `<button class="chip ${tab === v ? 'on' : ''}" data-act="stats-tab" data-v="${v}">${label}</button>`;
  const body = tab === 'achievements' ? achievementsBody() : tab === 'history' ? historyBody(list, msg) : statsBody();
  const count = tab === 'achievements' ? `${unlockedCount()} / ${ACHIEVEMENTS.length} unlocked` : '';
  return `<div class="modal" style="z-index:85"><div class="panel achv stats">
    <div class="cv-head"><h2>Stats</h2><div class="cv-tabs">${t('stats', 'Stats')}${t('achievements', 'Achievements')}${t('history', 'Match History')}</div>
      <span class="cv-count">${count}</span><button class="btn" data-act="stats-close">Close</button></div>
    <div class="ach-scroll">${body}</div>
  </div></div>`;
}

function statsBody() {
  const s = allStats();
  const n = (k: string) => (s[k] ?? 0).toLocaleString();
  const r = getRating();
  const places = r.history.map((h) => h.place).filter((x) => x > 0);
  const avg = places.length ? (places.reduce((a, b) => a + b, 0) / places.length).toFixed(2) : '–';
  const box = (label: string, v: string, sub = '') => `<div class="st-box"><div class="st-v">${v}</div><div class="st-l">${esc(label)}</div>${sub ? `<div class="st-s">${esc(sub)}</div>` : ''}</div>`;
  const games = s.games ?? 0;
  const pct = (k: string) => (games ? `${Math.round(((s[k] ?? 0) / games) * 100)}% of games` : '');
  const battles = (s.combatWins ?? 0) + (s.combatLosses ?? 0);
  const heroes = HEROES.map((h) => ({ h, plays: s[`heroPlay:${h.id}`] ?? 0, wins: s[`heroWin:${h.id}`] ?? 0 })).filter((x) => x.plays).sort((a, b) => b.plays - a.plays || b.wins - a.wins);
  const tribes = ALL_TRIBES.map((t) => ({ t, wins: s[`tribeWin:${t}`] ?? 0 })).filter((x) => x.wins);
  return `<h3 class="ach-group">Games</h3><div class="st-grid">
      ${box('Games played', n('games'))}${box('1st places', n('firsts'), pct('firsts'))}${box('Top 3 finishes', n('top3'), pct('top3'))}
      ${box('Average place', avg, places.length ? `over ${places.length} rated game${places.length === 1 ? '' : 's'}` : '')}
      ${box('Rating', String(r.rating), `peak ${r.peak}`)}
    </div>
    <h3 class="ach-group">Battles</h3><div class="st-grid">
      ${box('Battles won', n('combatWins'), battles ? `${Math.round(((s.combatWins ?? 0) / battles) * 100)}% of battles` : '')}${box('Battles lost', n('combatLosses'))}${box('Damage dealt', n('damage'))}
    </div>
    <h3 class="ach-group">In the Tavern</h3><div class="st-grid">
      ${box('Units bought', n('bought'))}${box('Units played', n('played'))}${box('Units sold', n('sold'))}${box('Spells cast', n('cast'))}
      ${box('Refreshes', n('rerolls'))}${box('Tavern upgrades', n('upgrades'))}${box('Freezes', n('freezes'))}${box('Golden units', n('triples'))}
      ${box('Discovers', n('discovers'))}${box('Trinkets', n('trinkets'))}${box('Hero Powers used', n('heroPowers'))}
    </div>
    <h3 class="ach-group">Heroes</h3>${heroes.length ? `<div class="st-heroes">${heroes.map(({ h, plays, wins }) => `<div class="st-hero">
      <span class="rp-hero" style="background-image:url('${heroArt(h.id)}')"></span><div><div class="st-hn">${esc(h.name)}</div>
      <div class="hint" style="padding:0;text-align:left">${plays} game${plays === 1 ? '' : 's'} · ${wins} win${wins === 1 ? '' : 's'}</div></div></div>`).join('')}</div>` : '<div class="hint">Finish a game to see your heroes here.</div>'}
    ${tribes.length ? `<h3 class="ach-group">Wins with 4+ of a faction</h3><div class="st-grid">${tribes.map(({ t, wins }) => box(TRIBE_NAMES[t], String(wins))).join('')}</div>` : ''}`;
}

export function achievementsHtml() {
  return statsPanelHtml('achievements', null, '');
}

function achievementsBody() {
  const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
  const body = groups.map((grp) => `<h3 class="ach-group">${esc(grp)}</h3><div class="ach-grid">${ACHIEVEMENTS.filter((a) => a.group === grp).map((a) => {
    const done = isUnlocked(a.id);
    const pr = progress(a);
    return `<div class="ach ${done ? 'done' : ''}">
      <div class="ach-icon">${done ? '🏆' : '🔒'}</div>
      <div class="ach-text"><div class="ach-name">${esc(a.name)}</div><div class="ach-desc">${esc(a.desc)}</div>
      ${a.stat && !done ? `<div class="ach-bar"><div style="width:${Math.round(pr * 100)}%"></div></div><div class="ach-num">${statValue(a).toLocaleString()} / ${a.target!.toLocaleString()}</div>` : ''}</div>
    </div>`;
  }).join('')}</div>`).join('');
  return body;
}

export { def };
