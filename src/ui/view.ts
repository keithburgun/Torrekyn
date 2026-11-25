import artManifest from '../data/art.json';
import { store } from '../save/store';
import artV2 from '../data/artV2.json';
import { CARDS, def, effStats, TRIBE_NAMES } from '../engine/core';
import { EFFECTS, GEMS, gemLevel, scoutTier } from '../engine/effects';
import type { Keyword, Player, Unit, CombatFrameUnit } from '../engine/types';
import { unitCounter } from '../engine/fx';

export const BASE = import.meta.env.BASE_URL;
export const art = (path: string) => BASE + path;
/**
 * Art style: "illustrated" (Keith's art from Spellstorm, Gem Wizards Tactics and Dragon Bridge, public/art/v2,
 * built by tools/build_art.py) or "classic" (the original generated placeholder art, public/art/cards|heroes).
 */
export type ArtStyle = 'illustrated' | 'classic';
let artStyle: ArtStyle = 'illustrated';
export const getArtStyle = () => artStyle;
/** read the setting (startup, and after a cloud save) */
export function reloadArtStyle() { artStyle = store.get('torrekin-art') === 'classic' ? 'classic' : 'illustrated'; }
reloadArtStyle();
export function setArtStyle(s: ArtStyle) {
  artStyle = s;
  store.set('torrekin-art', s);
}
const V2 = artV2 as Record<string, string>;
export const cardArt = (id: string) => art((artStyle === 'illustrated' && V2[`card:${id}`]) || ((artManifest as Record<string, string>)[id] ?? `art/cards/${id}.svg`));
export const heroArt = (id: string | undefined) => art((artStyle === 'illustrated' && id && V2[`hero:${id}`]) || `art/heroes/${id ?? 'unknown'}.svg`);

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const KW_ICON: Record<Keyword, [string, string]> = {
  taunt: ['🛡', 'Taunt'],
  divineShield: ['✦', 'Bubble'],
  reborn: ['☥', 'Reborn'],
  venomous: ['☠', 'Doomstrike'],
  poisonous: ['☣', 'Poisonous'],
  windfury: ['〰', 'Twinstrike'],
};

export const KEYWORD_HELP: Record<string, string> = {
  Taunt: 'Enemies must attack this first.',
  'Bubble': 'The first damage this takes is ignored.',
  Reborn: 'Comes back with 1 Health the first time it dies.',
  Doomstrike: 'Destroys any unit it damages (once).',
  Poisonous: 'Destroys any unit it damages (every time).',
  Twinstrike: 'Attacks twice.',
  Arrive: 'Happens when you play it from your hand.',
  Deathrattle: 'Happens when it dies.',
  Rally: 'Happens whenever this attacks.',
  Avenge: 'Happens after the given number of friendly units die.',
  'Start of Combat': 'Happens before the first attack.',
  Discover: 'Choose one of three cards.',
  Merge: 'When you play this, you can drop it onto a unit it can Merge with: that unit gets its stats and keywords.',
};

export function abilityTags(cardId: string): string[] {
  const e = EFFECTS[cardId];
  const d = def(cardId);
  const tags: string[] = [];
  if (!e) return tags;
  if (e.battlecry) tags.push('Arrive');
  if (e.deathrattle) tags.push('Deathrattle');
  if (e.rally) tags.push('Rally');
  if (e.avenge) tags.push('Avenge');
  if (e.soc) tags.push('Start');
  if (e.endTurn) tags.push('End');
  if (e.startTurn) tags.push('Turn');
  if (e.onSell) tags.push('Sell');
  if (e.target === undefined && e.onPlay) tags.push('Play');
  if (e.target === 'alcove') tags.push('Merge');
  if (!tags.length && d.text && !/^((Taunt|Bubble|Reborn|Doomstrike|Poisonous)[.,]?\s*)+$/i.test(d.text)) tags.push('Passive');
  return tags;
}

/** short tribe names for the plate at the bottom of each card */
export const TRIBE_SHORT: Record<string, string> = {
  neverending: 'Neverending', azure: 'Azure', kindred: 'Kindred', brambor: 'Brambor', cloister: 'Cloister', alcove: 'Alcove', demons: 'Demons', neutral: 'Neutral',
};

export interface CardViewOpts {
  /** extra markup placed inside the card (e.g. a hint badge) */
  badge?: string;
  zone: string;
  idx: number;
  x: number;
  y: number;
  small?: boolean;
  large?: boolean;
  extraClass?: string;
  atk?: number;
  hp?: number;
  kw?: Keyword[];
  id?: number | string;
}

export function cardHtml(u: { cardId: string; golden: boolean; atk: number; hp: number; kw: Keyword[]; mem?: Record<string, number> }, o: CardViewOpts): string {
  const d = def(u.cardId);
  const atk = o.atk ?? u.atk;
  const hp = o.hp ?? u.hp;
  const kw = o.kw ?? u.kw;
  const cls = ['card', `t-${d.tribe}`, d.allTribes ? 't-all' : '', u.golden ? 'golden' : '', o.small ? 'small' : '', o.large ? 'large' : '', ...kw.map((k) => `kw-${k}`), u.mem?.locked ? 'locked' : '', o.extraClass ?? ''].join(' ');
  const baseAtk = d.atk * (u.golden ? 2 : 1);
  const baseHp = d.hp * (u.golden ? 2 : 1);
  const icons = kw.filter((k) => k !== 'taunt' && k !== 'divineShield').map((k) => `<span class="kw-${k}" title="${KW_ICON[k][1]}">${KW_ICON[k][0]}</span>`).join('');
  // Golden cards say so (a gold chip beside the first ability tag)
  const tags = (u.golden ? '<i class="gold">Golden</i>' : '') + abilityTags(u.cardId).slice(0, u.golden ? 1 : 2).map((t) => `<i>${t}</i>`).join('');
  return `<div class="${cls}" data-zone="${o.zone}" data-idx="${o.idx}" ${o.id !== undefined ? `data-id="${o.id}"` : ''} style="left:${o.x}px;top:${o.y}px">
  <div class="face"></div>
  <div class="art" style="background-image:url('${cardArt(u.cardId)}')"></div>
  <div class="tier">${'★'.repeat(d.tier)}</div>
  <div class="kws">${icons}</div>
  <div class="abil">${tags}</div>
  <div class="name">${esc(d.name)}</div>
  <div class="tribe-plate ${(TRIBE_SHORT[d.tribe] ?? d.tribe).length > 8 && !d.allTribes ? 'long' : ''}">${d.allTribes ? 'ALL' : TRIBE_SHORT[d.tribe] ?? d.tribe}</div>${o.badge ?? ''}
  ${(u as { avenge?: string }).avenge ? `<div class="avenge-count" title="Avenge: friendly units died / needed"><i>⚔</i>${(u as { avenge?: string }).avenge}</div>` : ''}
  ${(() => { const c = (u as { note?: string }).note ?? (u.mem && (o.zone === "board" || o.zone === "combat" || o.zone === "hand") ? unitCounter(u as Unit) : null); return c ? `<div class="counter">${c}</div>` : ''; })()}
  <div class="stat atk ${atk !== baseAtk ? 'buffed' : ''}" data-base="${baseAtk}" data-v="${atk}" ${statInner(atk)}</div>
  <div class="stat hp ${hp > baseHp ? 'buffed' : hp < baseHp ? 'hurt' : ''}" data-base="${baseHp}" data-v="${hp}" ${statInner(hp)}</div>
</div>`;
}

/** a stat as shown on a card: up to 999 as is, then 1.2k / 12.9k (rounded down, so it never overstates), 123k, 1.2M */
export function fmtStat(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a < 1000) return String(n);
  const short = (v: number, unit: string) => sign + (v < 100 ? String(Math.floor(v * 10) / 10) : String(Math.floor(v))) + unit;
  return a < 1e6 ? short(a / 1000, 'k') : short(a / 1e6, 'M');
}

/** the end of a stat badge's opening tag and its number; longer numbers (data-n) are drawn smaller to fit the badge */
function statInner(v: number) {
  const t = fmtStat(v);
  return `data-n="${t.length}"><span>${t}</span>`;
}

/** change a card's shown stat (keeps the exact number in data-v for later arithmetic) */
export function setStat(el: Element, v: number) {
  const t = fmtStat(v);
  (el as HTMLElement).dataset.v = String(v);
  (el as HTMLElement).dataset.n = String(t.length);
  el.innerHTML = `<span>${t}</span>`;
}
export const statOf = (el: Element) => Number((el as HTMLElement).dataset.v ?? el.textContent);

export function formatText(text: string): string {
  let t = esc(text);
  t = t.replace(/(Arrive|Deathrattle|Rally|Avenge ?\(\d+\)|Start of (Combat|Turn)|End of Turn|Bubble|Taunt|Reborn|Doomstrike|Poisonous|Discover|Quest|Twinstrike|Merge)/g, '<b>$1</b>');
  return t;
}

// ---- cards a card's text names (Bulldozer → Red Gem): shown beside it when it's zoomed in ----
const NAME_ID = new Map<string, string>();
let NAME_RE: RegExp | null = null;
/** cards whose text names another card without saying its name exactly */
const ALSO: Record<string, string[]> = { left_twinbot: ['right_twinbot'], right_twinbot: ['left_twinbot'] };

/** the cards this card's text refers to (at most 2), e.g. Bulldozer → Red Gem, Planter → Potato Gem */
export function relatedCards(cardId: string): string[] {
  if (!NAME_RE) {
    for (const c of CARDS) NAME_ID.set(c.name.toLowerCase(), c.id);
    const names = [...NAME_ID.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    NAME_RE = new RegExp(`\\b(${names.join('|')})(s|es)?\\b`, 'gi');
  }
  const d = def(cardId);
  // keyword phrases first ("Bubble" is not the Shield card)
  const text = `${d.text} ${d.goldenText}`.replace(/Bubble/gi, '');
  const out: string[] = [...(ALSO[cardId] ?? [])];
  for (const m of text.matchAll(NAME_RE)) {
    const id = NAME_ID.get(m[1].toLowerCase());
    if (id && id !== cardId && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 2);
}

/** a related card, as shown beside a zoomed one (its base stats) */
/**
 * A card named by another card's text, as that card makes it: Golden when the (Golden) card's text says
 * "Golden <name>" (Golden Owl Summoner → Golden Owl).
 */
/**
 * A card you're being offered (a Discover, a unit a card would give you), with the stats it will have once it's yours:
 * its base stats plus what your game so far adds (War Mech's Deathrattles, Owls summoned, faction Attack buffs, ...).
 */
export function offeredUnit(id: string, golden: boolean, p?: Player) {
  const d = def(id);
  const m = golden ? 2 : 1;
  const u = { uid: -1, cardId: id, golden, atk: d.atk * m, hp: d.hp * m, kw: [...d.keywords], mem: {} };
  if (!p) return u;
  const st = effStats(p, u, 'hand');
  return { ...u, atk: st.atk, hp: st.hp, kw: st.kw };
}

export function relatedCardHtml(id: string, p?: Player, from?: { cardId: string; golden: boolean }): string {
  const d = def(id);
  const golden = !!from?.golden && new RegExp(`\\bGolden ${d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(def(from.cardId).goldenText);
  return bigCardHtml(offeredUnit(id, golden, p), '', p);
}

export function bigCardHtml(u: { cardId: string; golden: boolean; atk: number; hp: number; kw: Keyword[]; mem?: Record<string, number> }, extra = '', p?: Player): string {
  const d = def(u.cardId);
  let text = u.golden ? d.goldenText : d.text;
  if (p) text = gemText(p, u.cardId, u.golden, text);
  // the Pumpkin lists the Deathrattles it has collected
  const gained = Object.keys(u.mem ?? {}).filter((k) => k.startsWith('dr_')).map((k) => def(k.slice(3)).name);
  if (gained.length) text += ` Deathrattles: ${gained.join(', ')}.`;
  if (u.cardId === 'scout' && (u.mem?.age ?? 0) > 0) text = text.replace(/Tier 1 unit/, `Tier ${scoutTier(u)} unit`);
  if (u.cardId === 'larva' && u.mem?.done) text += ' (Done!)';
  if (u.cardId === 'intern') text += ` (Sells for ${1 + (u.mem?.sellBonus ?? 0)} Gold)`;
  const kwExtra = u.kw.filter((k) => !d.keywords.includes(k)).map((k) => KW_ICON[k][1]);
  const bA = d.atk * (u.golden ? 2 : 1), bH = d.hp * (u.golden ? 2 : 1);
  return `<div class="bigcard t-${d.tribe} ${d.allTribes ? 't-all' : ''} ${u.golden ? 'golden' : ''} ${extra}">
  <div class="art" style="background-image:url('${cardArt(u.cardId)}')"></div>
  <div class="tier" title="Tier ${d.tier}">${'★'.repeat(d.tier)}</div>
  <div class="name">${u.golden ? 'Golden ' : ''}${esc(d.name)}</div>
  <div class="tribe"><span>${d.allTribes ? 'All Factions' : esc(TRIBE_NAMES[d.tribe] ?? d.tribe)}${d.token ? ' · Token' : ''}</span></div>
  <div class="text"><div>${text ? formatText(text) : kwExtra.length ? '' : '<i>No ability.</i>'}${kwExtra.length ? `${text ? '<br>' : ''}<i class="kw-extra">${kwExtra.join(', ')}</i>` : ''}</div></div>
  <div class="stat atk ${u.atk !== bA ? 'buffed' : ''}" ${statInner(u.atk)}</div>
  <div class="stat hp ${u.hp > bH ? 'buffed' : u.hp < bH ? 'hurt' : ''}" ${statInner(u.hp)}</div>
</div>`;
}

export function unitView(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop', i: number) {
  const st = effStats(p, u, zone, i);
  return { ...u, atk: st.atk, hp: st.hp, kw: st.kw, note: gemNote(p, u) };
}

/** an improved Gem's ability text, with the numbers it gives now */
export function gemText(p: Player, cardId: string, golden: boolean, text: string): string {
  // Banners: every Banner you've played adds +1 (Golden +2) to the ones after it
  if ((cardId === 'silver_banner' || cardId === 'gold_banner') && p.bannerBonus) {
    const m = golden ? 2 : 1;
    const n = (3 + p.bannerBonus) * m;
    return `${text.replace(/\+\d+ (Attack|Health)/, `+${n} $1`)} (Improved ${p.bannerBonus === 1 ? 'once' : `${p.bannerBonus} times`}.)`;
  }
  if (!GEMS.includes(cardId)) return text;
  const l = gemLevel(p, cardId);
  if (!l) return text;
  const m = golden ? 2 : 1;
  let t = text;
  switch (cardId) {
    case 'purple_gem': t = t.replace(/\+\d+\/\+\d+/, `+${(1 + l) * m}/+${(1 + l) * m}`); break;
    case 'tourmaline': t = t.replace(/\+\d+ Health/, `+${(8 + 2 * l) * m} Health`); break;
    case 'pink_gem': t = t.replace(/\+\d+\/\+\d+/g, `+${(1 + l) * m}/+${(1 + l) * m}`); break;
    case 'green_gem': t = t.replace(/\+\d+ Attack/, `+${(3 + l) * m} Attack`); break;
    case 'white_gem': t = t.replace(/\+\d+\/\+\d+/, `+${(4 + l) * m}/+${(4 + l) * m}`); break;
    case 'red_gem': t = t.replace(/\+\d+ Attack/, `+${(3 + l) * m} Attack`); break;
    case 'ancient_name_brambor': t = t.replace(/\+\d+ Health/, `+${(2 + l) * m} Health`); break;
  }
  return `${t} (Improved ${l === 1 ? 'once' : `${l} times`}.)`;
}

/** an improved Gem shows what it gives now */
function gemNote(p: Player, u: Unit): string | undefined {
  if (!GEMS.includes(u.cardId)) return undefined;
  const l = gemLevel(p, u.cardId);
  if (!l) return undefined;
  const m = u.golden ? 2 : 1;
  switch (u.cardId) {
    case 'purple_gem': return `+${(1 + l) * m}/+${(1 + l) * m}`;
    case 'tourmaline': return `+${(8 + 2 * l) * m} Health`;
    case 'pink_gem': return `+${(1 + l) * m}/+${(1 + l) * m}`;
    case 'green_gem': return `+${(3 + l) * m} Attack`;
    case 'white_gem': return `+${(4 + l) * m}/+${(4 + l) * m}`;
    case 'red_gem': return `+${(3 + l) * m} Atk`;
    case 'ancient_name_brambor': return `+${(2 + l) * m} Health`;
  }
  return undefined;
}

export function frameUnitView(u: CombatFrameUnit) {
  const av = EFFECTS[u.cardId]?.avenge;
  return { cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp, kw: u.kw, ...(av && u.avenge !== undefined ? { avenge: `${u.avenge}/${av[u.golden ? 1 : 0]}` } : {}), ...(u.rattle ? { note: 'Rattler' } : {}), ...(u.sellBonus ? { mem: { sellBonus: u.sellBonus } } : {}) };
}

/**
 * Load every card and hero picture in the background from the title screen, so they're ready before a card
 * first appears (on itch.io pictures that only started loading when the card was drawn sometimes stayed blank).
 * Each picture gets a few tries; one that still fails is reported (DEBUG MODE shows it on screen).
 */
export function preloadArt() {
  if (typeof Image === 'undefined') return;
  const urls = [...new Set([...CARDS.filter((c) => !c.hidden).map((c) => cardArt(c.id)), ...Object.keys(V2).filter((k) => k.startsWith('hero:')).map((k) => heroArt(k.slice(5)))])];
  const keep: HTMLImageElement[] = []; // held so the browser keeps them decoded and cached
  let next = 0;
  const load = (url: string, tries: number) => new Promise<void>((done) => {
    const im = new Image();
    im.onload = () => { keep.push(im); done(); };
    im.onerror = () => {
      if (tries > 1) setTimeout(() => void load(url, tries - 1).then(done), 1500);
      else { console.error(`Card art failed to load: ${url.split('/').slice(-2).join('/')}`); done(); }
    };
    im.src = url;
  });
  const worker = async () => { while (next < urls.length) await load(urls[next++], 3); };
  for (let i = 0; i < 6; i++) void worker();
}
