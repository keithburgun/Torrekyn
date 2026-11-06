import artManifest from '../data/art.json';
import { def, effStats, TRIBE_NAMES } from '../engine/core';
import { EFFECTS } from '../engine/effects';
import type { Keyword, Player, Unit, CombatFrameUnit } from '../engine/types';

export const BASE = import.meta.env.BASE_URL;
export const art = (path: string) => BASE + path;
export const cardArt = (id: string) => art((artManifest as Record<string, string>)[id] ?? `art/cards/${id}.svg`);
export const heroArt = (id: string | undefined) => art(`art/heroes/${id ?? 'unknown'}.svg`);

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const KW_ICON: Record<Keyword, [string, string]> = {
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

export interface CardViewOpts {
  zone: string;
  idx: number;
  x: number;
  y: number;
  small?: boolean;
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
  const cls = ['card', `t-${d.tribe}`, u.golden ? 'golden' : '', o.small ? 'small' : '', ...kw.map((k) => `kw-${k}`), u.mem?.locked ? 'locked' : '', o.extraClass ?? ''].join(' ');
  const baseAtk = d.atk * (u.golden ? 2 : 1);
  const baseHp = d.hp * (u.golden ? 2 : 1);
  const icons = kw.filter((k) => k !== 'taunt' && k !== 'divineShield').map((k) => `<span title="${KW_ICON[k][1]}">${KW_ICON[k][0]}</span>`).join('');
  const tags = abilityTags(u.cardId).slice(0, 2).map((t) => `<i>${t}</i>`).join('');
  return `<div class="${cls}" data-zone="${o.zone}" data-idx="${o.idx}" ${o.id !== undefined ? `data-id="${o.id}"` : ''} style="left:${o.x}px;top:${o.y}px">
  <div class="art" style="background-image:url('${cardArt(u.cardId)}')"></div>
  <div class="tier">${'★'.repeat(d.tier)}</div>
  <div class="kws">${icons}</div>
  <div class="abil">${tags}</div>
  <div class="name">${esc(d.name)}</div>
  <div class="stat atk ${atk > baseAtk ? 'buffed' : ''}">${atk}</div>
  <div class="stat hp ${hp > baseHp ? 'buffed' : hp < baseHp ? 'hurt' : ''}">${hp}</div>
</div>`;
}

export function formatText(text: string): string {
  let t = esc(text);
  t = t.replace(/(Battlecry|Deathrattle|Rally|Avenge ?\(\d+\)|Start of (Combat|Battle|Turn)|End of (the )?[Tt]urn|At the end of the turn|Divine Shield|Taunt|Reborn|Venomous|Stealth|Discover|Quest|Windfury)/g, '<b>$1</b>');
  return t;
}

export function bigCardHtml(u: { cardId: string; golden: boolean; atk: number; hp: number; kw: Keyword[] }, extra = ''): string {
  const d = def(u.cardId);
  const text = u.golden ? d.goldenText : d.text;
  const kwExtra = u.kw.filter((k) => !d.keywords.includes(k)).map((k) => KW_ICON[k][1]);
  const full = [text, kwExtra.length ? `<i>Has ${kwExtra.join(', ')}.</i>` : ''].filter(Boolean).join(' ');
  return `<div class="bigcard t-${d.tribe} ${u.golden ? 'golden' : ''} ${extra}">
  <div class="art" style="background-image:url('${cardArt(u.cardId)}')"></div>
  <div class="tier">Tier ${d.tier}</div>
  <div class="name">${u.golden ? 'Golden ' : ''}${esc(d.name)}</div>
  <div class="tribe">${esc(TRIBE_NAMES[d.tribe] ?? d.tribe)}${d.token ? ' · Token' : ''}</div>
  <div class="text">${full ? formatText(text) + (kwExtra.length ? `<br><i>Also has ${kwExtra.join(', ')}.</i>` : '') : '<i>No ability.</i>'}</div>
  <div class="stat atk">${u.atk}</div>
  <div class="stat hp">${u.hp}</div>
</div>`;
}

export function unitView(p: Player, u: Unit, zone: 'board' | 'hand' | 'shop', i: number) {
  const st = effStats(p, u, zone, i);
  return { ...u, atk: st.atk, hp: st.hp, kw: st.kw };
}

export function frameUnitView(u: CombatFrameUnit) {
  return { cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp, kw: u.kw };
}
