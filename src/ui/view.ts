import artManifest from '../data/art.json';
import { store } from '../save/store';
import artV2 from '../data/artV2.json';
import { CARDS, def, effStats, TRIBE_NAMES } from '../engine/core';
import { EFFECTS, GEMS, gemLevel } from '../engine/effects';
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
  divineShield: ['✦', 'Divine Shield'],
  reborn: ['☥', 'Reborn'],
  venomous: ['☠', 'Venomous'],
  stealth: ['◐', 'Stealth'],
  windfury: ['〰', 'Windfury'],
};

export const KEYWORD_HELP: Record<string, string> = {
  Taunt: 'Enemies must attack this first.',
  'Divine Shield': 'The first damage this takes is ignored.',
  Reborn: 'Comes back with 1 Health the first time it dies.',
  Venomous: 'Destroys any unit it damages (once).',
  Stealth: "Can't be attacked until it attacks.",
  Windfury: 'Attacks twice.',
  Battlecry: 'Happens when you play it from your hand.',
  Deathrattle: 'Happens when it dies.',
  Rally: 'Happens whenever this attacks.',
  Avenge: 'Happens after the given number of friendly units die.',
  'Start of Combat': 'Happens before the first attack.',
  Discover: 'Choose one of three cards.',
  Slot: 'Board positions keep their bonuses. Whoever stands in a slot gets them.',
};

export function abilityTags(cardId: string): string[] {
  const e = EFFECTS[cardId];
  const d = def(cardId);
  const tags: string[] = [];
  if (!e) return tags;
  if (e.battlecry) tags.push('Battlecry');
  if (e.deathrattle || cardId === 'golden_light') tags.push('Deathrattle');
  if (e.rally) tags.push('Rally');
  if (e.avenge) tags.push('Avenge');
  if (e.soc) tags.push('Start');
  if (e.endTurn) tags.push('End');
  if (e.startTurn) tags.push('Turn');
  if (e.onSell) tags.push('Sell');
  if (e.target === undefined && e.onPlay) tags.push('Play');
  if (!tags.length && d.text && !/^((Taunt|Divine Shield|Reborn|Venomous|Stealth)[.,]?\s*)+$/i.test(d.text)) tags.push('Passive');
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
  const cls = ['card', `t-${d.tribe}`, u.golden ? 'golden' : '', o.small ? 'small' : '', o.large ? 'large' : '', ...kw.map((k) => `kw-${k}`), u.mem?.locked ? 'locked' : '', o.extraClass ?? ''].join(' ');
  const baseAtk = d.atk * (u.golden ? 2 : 1);
  const baseHp = d.hp * (u.golden ? 2 : 1);
  const icons = kw.filter((k) => k !== 'taunt' && k !== 'divineShield').map((k) => `<span title="${KW_ICON[k][1]}">${KW_ICON[k][0]}</span>`).join('');
  const tags = abilityTags(u.cardId).slice(0, 2).map((t) => `<i>${t}</i>`).join('');
  return `<div class="${cls}" data-zone="${o.zone}" data-idx="${o.idx}" ${o.id !== undefined ? `data-id="${o.id}"` : ''} style="left:${o.x}px;top:${o.y}px">
  <div class="face"></div>
  <div class="art" style="background-image:url('${cardArt(u.cardId)}')"></div>${kw.includes('stealth') ? '<div class="smoke"></div>' : ''}
  <div class="tier">${'★'.repeat(d.tier)}</div>
  <div class="kws">${icons}</div>
  <div class="abil">${tags}</div>
  <div class="name">${esc(d.name)}</div>
  <div class="tribe-plate ${(TRIBE_SHORT[d.tribe] ?? d.tribe).length > 8 ? 'long' : ''}">${TRIBE_SHORT[d.tribe] ?? d.tribe}</div>${o.badge ?? ''}
  ${(() => { const c = (u as { note?: string }).note ?? (u.mem && (o.zone === "board" || o.zone === "combat") ? unitCounter(u as Unit) : null); return c ? `<div class="counter">${c}</div>` : ''; })()}
  <div class="stat atk ${atk > baseAtk ? 'buffed' : ''}">${atk}</div>
  <div class="stat hp ${hp > baseHp ? 'buffed' : hp < baseHp ? 'hurt' : ''}">${hp}</div>
</div>`;
}

export function formatText(text: string): string {
  let t = esc(text);
  t = t.replace(/(Battlecry|Deathrattle|Rally|Avenge ?\(\d+\)|Start of (Combat|Battle|Turn)|End of (the )?[Tt]urn|At the end of the turn|Divine Shield|Taunt|Reborn|Venomous|Stealth|Discover|Quest|Windfury)/g, '<b>$1</b>');
  return t;
}

export function bigCardHtml(u: { cardId: string; golden: boolean; atk: number; hp: number; kw: Keyword[]; mem?: Record<string, number> }, extra = ''): string {
  const d = def(u.cardId);
  let text = u.golden ? d.goldenText : d.text;
  // the Pumpkin lists the Deathrattles it has collected
  const gained = Object.keys(u.mem ?? {}).filter((k) => k.startsWith('dr_')).map((k) => def(k.slice(3)).name);
  if (gained.length) text += ` Deathrattles: ${gained.join(', ')}.`;
  const kwExtra = u.kw.filter((k) => !d.keywords.includes(k)).map((k) => KW_ICON[k][1]);
  return `<div class="bigcard t-${d.tribe} ${u.golden ? 'golden' : ''} ${extra}">
  <div class="art" style="background-image:url('${cardArt(u.cardId)}')"></div>
  <div class="tier">Tier ${d.tier}</div>
  <div class="name">${u.golden ? 'Golden ' : ''}${esc(d.name)}</div>
  <div class="tribe"><span>${esc(TRIBE_NAMES[d.tribe] ?? d.tribe)}${d.token ? ' · Token' : ''}</span></div>
  <div class="text"><div>${text ? formatText(text) : kwExtra.length ? '' : '<i>No ability.</i>'}${kwExtra.length ? `${text ? '<br>' : ''}<i>Also has ${kwExtra.join(', ')}.</i>` : ''}</div></div>
  <div class="stat atk">${u.atk}</div>
  <div class="stat hp">${u.hp}</div>
</div>`;
}

export function unitView(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop', i: number) {
  const st = effStats(p, u, zone, i);
  return { ...u, atk: st.atk, hp: st.hp, kw: st.kw, note: gemNote(p, u) };
}

/** an improved Gem shows what it gives now */
function gemNote(p: Player, u: Unit): string | undefined {
  if (!GEMS.includes(u.cardId)) return undefined;
  const l = gemLevel(p, u.cardId);
  if (!l) return undefined;
  const m = u.golden ? 2 : 1;
  switch (u.cardId) {
    case 'purple_gem': return `+${1 + l}/+${1 + l}`;
    case 'tourmaline': return `+${(10 + 2 * l) * m} Health`;
    case 'pink_gem': return `${(1 + l) * m} units`;
    case 'green_gem': return `+${2 + l} Attack`;
    case 'red_gem': return `+${(3 + l) * m}`;
    case 'ancient_name_brambor': return `+${(4 + l) * m} Health`;
  }
  return undefined;
}

export function frameUnitView(u: CombatFrameUnit) {
  return { cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp, kw: u.kw };
}

/**
 * Load every card and hero picture in the background from the title screen, so they're ready before a card
 * first appears (on itch.io pictures that only started loading when the card was drawn sometimes stayed blank).
 * Each picture gets a few tries; one that still fails is reported (DEBUG MODE shows it on screen).
 */
export function preloadArt() {
  if (typeof Image === 'undefined') return;
  const urls = [...new Set([...CARDS.map((c) => cardArt(c.id)), ...Object.keys(V2).filter((k) => k.startsWith('hero:')).map((k) => heroArt(k.slice(5)))])];
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
