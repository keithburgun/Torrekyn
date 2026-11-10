import { CONFIG, def, TRIBE_NAMES } from '../engine/core';
import { store } from '../save/store';
import { provider as cloudProvider, state as cloudState, statusText as cloudStatus, sync, syncNow, takeCombined } from '../save/sync';
import { friendly, supabase } from '../save/providers/supabase';
import { reloadAchievements } from './achievements';
import { reloadArtStyle } from './view';
import {
  buy, chooseDiscover, endTurn, maxGoldFor, move, needsTarget, newGame, play, reroll, selectHero, sell, sellValue, toggleFreeze, upgrade, validTargets, handLocked,
} from '../engine/game';
import { HEROES, buyCost, canUseHeroPower, heroDef, heroHealth, mainActive, pickTrinket, powerCost, powersOf, trinketDef, useHeroPower, type HeroDef } from '../engine/heroes';
import type { CombatResult, GameState, Player } from '../engine/types';
import { CombatPlayer, SPEEDS, speedSetting } from './combatView';
import { art, bigCardHtml, cardHtml, esc, getArtStyle, heroArt, setArtStyle, unitView, KEYWORD_HELP, KW_ICON, type ArtStyle } from './view';
import { clearSave, loadSave, save } from './save';
import { debugOn, setDebug } from './debug';
import { checkForUpdates, versionLabel } from './update';
import { isMuted, setMuted, sfx } from './sfx';
import { achievementsHtml, cardGridHtml, cardViewerHtml, filteredCards, tribesAnnounceHtml, type ViewerState } from './screens';
import { playTriple } from './ceremony';
import { placeBoardBg, placeHud } from './hud';
import { puff } from './fx';
import type { FxEvent } from '../engine/fx';
import { battleIntro, recruitWipe, fadeOut, fadeClear, fadeIn } from './transitions';
import { getRating, isProvisional, rateGame, seatRating } from './rating';
import { EXPERT_ELO, personaById } from '../engine/personas';
import { bump, evaluate, newGameStarted, noteGame, onUnlock, recordCombat, recordGameEnd, type AchievementDef } from './achievements';
import { currentLayout, getMode, LANDSCAPE, setMode, type Layout, type LayoutMode } from './layout';
import { ALL_TRIBES } from '../engine/core';

declare const __NO_UPDATES__: boolean;

type Zone = 'shop' | 'hand' | 'board';
interface Sel { zone: Zone; idx: number }
interface Press { zone: Zone; idx: number; x: number; y: number; el: HTMLElement; pointerId: number }
interface Targeting { kind: 'play'; handIdx: number; pos: number } // play a card that needs a target
interface HeroTargeting { kind: 'hero'; id: string; shop?: boolean }

// ---- layout: see layout.ts (landscape mirrors Battlegrounds on PC; portrait is for phones) ----
let L: Layout = LANDSCAPE;
const boardCardX = (i: number) => L.slotX(i) + (L.slotW - L.cardW) / 2;

function shopX(i: number, n: number) {
  const total = (n - 1) * L.shopStep + L.shopCardW;
  return L.cx - total / 2 + i * L.shopStep;
}
function handX(i: number, n: number) {
  const w = L.handCardW;
  const step = Math.min(w + 8, Math.floor((L.handWidth - w) / Math.max(1, n - 1)));
  const total = (n - 1) * step + w;
  return L.cx - total / 2 + i * step;
}
const ordinal = (n: number) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

/** Interface style: 'smooth' (rounded; the default) or 'pixel' (square pixel-art frames). A new storage key, so everyone starts on Smooth again. */
/** Pixel-drawn icons for the Tavern buttons (Keith's pixel art; each row is "x,y,width" runs), drawn solid black at any size */
const pixSvg = (w: number, h: number, runs: string) => `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${runs
  .trim().split(/\s+/).map((r) => { const [x, y, rw = '1'] = r.split(','); return `<rect x="${x}" y="${y}" width="${rw}" height="1"/>`; }).join('')}</svg>`;
const PIX_ICON = {
  up: pixSvg(11, 14, '5,0,1 4,1,3 3,2,5 2,3,7 1,4,9 0,5,11 0,6,11 0,7,11 3,8,5 3,9,5 3,10,5 3,11,5 3,12,5 3,13,5'),
  refresh: pixSvg(12, 14, '4,0,5 2,1,9 1,2,10 1,3,3 8,3,4 0,4,3 10,4,2 0,5,2 11,5,1 0,6,2 5,6,5 0,7,2 5,7,4 0,8,2 5,8,6 0,9,3 5,9,2 8,9,4 1,10,3 5,10,1 8,10,4 1,11,11 2,12,9 4,13,5'),
  freeze: pixSvg(14, 14, '7,0,1 7,1,1 2,2,2 6,2,2 10,2,2 2,3,2 6,3,2 10,3,2 4,4,6 4,5,2 7,5,3 0,6,6 9,6,3 2,7,3 8,7,6 4,8,3 8,8,2 4,9,6 2,10,2 6,10,2 10,10,2 2,11,2 6,11,2 10,11,2 6,12,1 6,13,1'),
};

function uiStyle(): 'pixel' | 'smooth' {
  return store.get('torrekin-ui2') === 'pixel' ? 'pixel' : 'smooth';
}

export class App {
  stage: HTMLElement;
  g: GameState | null = null;
  screen: 'title' | 'rules' | 'tribes' | 'hero' | 'shop' | 'combat' | 'over' = 'title';
  sel: Sel | null = null;
  hover: Sel | null = null;
  press: Press | null = null;
  dragging = false;
  ghost: HTMLElement | null = null;
  targeting: Targeting | HeroTargeting | null = null;
  inspect: number | null = null; // player id shown in rival modal
  options = false; // options window open
  /** the cloud-save sign-in window: which form, and any message to show */
  account: { msg: string; ok?: boolean; busy?: boolean } | null = null;
  viewer: ViewerState | null = null; // card viewer open
  achOpen = false; // achievements window open
  busy = false; // a ceremony is playing
  lastShopPos: { x: number; y: number } | null = null;
  showTribes = false; // tribes tooltip pinned open (tap on phones)
  /** phones have no hover: tapping your hero or a trinket opens this sheet instead of a tooltip */
  sheet: { kind: 'hero' } | { kind: 'trinket'; id: string } | null = null;
  /** your rating change in the game that just ended */
  lastRating: { before: number; after: number; delta: number } | null = null;
  seenBoards = new Map<number, CombatResult['frames'][number]['sides'][number]>();
  combat: CombatPlayer | null = null;

  constructor(stage: HTMLElement) {
    this.stage = stage;
    // a fault in a drag mustn't fail silently (the card would just snap back): show it, and reset the drag
    const safe = (f: (e: PointerEvent) => void) => (e: PointerEvent) => {
      try { f(e); } catch (err) { this.cancelDrag(); this.reportError(err); }
    };
    stage.addEventListener('pointerdown', safe((e) => this.onDown(e)));
    window.addEventListener('pointermove', safe((e) => this.onMove(e)));
    window.addEventListener('pointerup', safe((e) => this.onUp(e)));
    // the browser took the pointer away mid-drag (e.g. it started scrolling the page around the game):
    // drop the card where it was last seen instead of throwing the drag away
    window.addEventListener('pointercancel', safe((e) => {
      if (this.dragging && this.press && e.pointerId === this.press.pointerId && this.lastPt) this.drop(this.lastPt);
      else this.cancelDrag();
    }));
    stage.addEventListener('click', (e) => this.onClick(e));
    stage.addEventListener('mouseover', (e) => this.onHover(e));
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id !== 'cv-search' || !this.viewer) return;
      this.viewer.q = t.value;
      const grid = stage.querySelector('#cv-grid');
      if (grid) grid.innerHTML = cardGridHtml(this.viewer, this.g);
      const c = stage.querySelector('#cv-count');
      if (c) c.textContent = `${filteredCards(this.viewer, this.g).length} cards`;
    });
    onUnlock((a) => this.achievementToast(a));
    // cloud saves: don't swap the game being played underneath you; redraw when progress arrives from elsewhere
    sync.setBusyKeys(() => (this.g && (this.screen === 'shop' || this.screen === 'combat') ? ['torrekin-save'] : []));
    sync.onApplied(() => {
      reloadAchievements();
      reloadArtStyle();
      if (this.screen !== 'combat' && !this.account) this.render();
      if (takeCombined()) this.toast('Your progress here was combined with your account.');
    });
    sync.onStatus(() => {
      const el = this.stage.querySelector('#cloud-status');
      if (el) el.textContent = cloudStatus();
      else if (this.options && !this.account) this.render();
    });
    sync.start();
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
      if (e.key === 'Escape') { this.sheet = null; this.targeting = null; this.sel = null; this.viewer = null; this.achOpen = false; this.render(); }
    });
    this.render();
  }

  get me(): Player { return this.g!.players[0]; }

  // ---------------- rendering ----------------
  /** the screen the stage last showed (to fade in a new one) */
  private shownScreen: string | null = null;
  /** the next screen change is already covered by a transition: no fade-in */
  private noFade = false;

  render() {
    L = currentLayout();
    this.stage.classList.toggle('portrait', L.portrait);
    this.stage.classList.toggle('tall', !!L.tall);
    this.stage.classList.toggle('pix', uiStyle() === 'pixel');
    this.stage.classList.toggle('menu-bg', this.screen === 'title' || this.screen === 'rules' || this.screen === 'hero' || this.screen === 'tribes');
    // one night-sky backdrop for every screen, drawn once, very large and blurred (styles.css #stage::before)
    // made absolute: a url() inside a CSS variable is read relative to the stylesheet that uses it (assets/), not the page
    this.stage.style.setProperty('--bg', `url('${new URL(art('art/bg.png'), document.baseURI).href}')`);
    this.stage.style.setProperty('--trinket-art', `url('${new URL(art('art/trinket.png'), document.baseURI).href}')`);
    placeBoardBg(this.stage, L, null);
    if (this.screen === 'combat') return; // combat view owns the stage
    // a new screen fades in quickly (shop and battle also fade out first; see afterEndTurn / startCombat)
    if (this.shownScreen !== this.screen) {
      if (this.shownScreen !== null && !this.noFade) fadeIn(this.stage);
      this.shownScreen = this.screen;
    }
    this.noFade = false;
    let html = '';
    if (this.screen === 'title') html = this.titleHtml();
    else if (this.screen === 'rules') html = this.rulesHtml();
    else if (this.screen === 'hero') html = this.heroSelectHtml();
    else if (this.screen === 'tribes') html = tribesAnnounceHtml(this.g!);
    else if (this.screen === 'shop') html = this.shopHtml();
    else if (this.screen === 'over') html = this.shopHtml() + this.overHtml();
    if (this.options) html += this.optionsHtml();
    if (this.account) html += this.accountHtml();
    if (this.viewer) html += cardViewerHtml(this.viewer, this.g);
    if (this.achOpen) html += achievementsHtml();
    const before = this.cardCentres();
    // messages on screen survive the redraw (a failed buy is followed straight away by one, which used to wipe
    // its "Not enough gold" / "Your hand is full" message, so the card just seemed to snap back)
    const toasts = [...this.stage.querySelectorAll('.toast')];
    this.stage.innerHTML = html;
    for (const t of toasts) this.stage.appendChild(t);
    placeHud(this.stage, L);
    this.slideCards(before);
    if (this.screen === 'shop') this.shopFeedback();
    if (this.screen === 'shop' && this.targeting) this.drawArrow();
  }

  // ---------------- targeting arrow ----------------
  /** last pointer position in stage pixels, so the arrow survives a re-render */
  private aimPt: { x: number; y: number } | null = null;

  /** where the arrow starts: the card being played (sitting in the slot it was dropped on) or your hero */
  private arrowSource(): { x: number; y: number } | null {
    const t = this.targeting;
    if (!t) return null;
    const el = (t.kind === 'play'
      ? this.stage.querySelector('.card.placing')
      : this.stage.querySelector('.my-hero')) as HTMLElement | null;
    if (!el) return null;
    const c = this.centre(el);
    return { x: c.x, y: c.y - (t.kind === 'play' ? c.h * 0.25 : 0) };
  }

  /** the valid target under a stage point, if any */
  private targetAt(pt: { x: number; y: number }): HTMLElement | null {
    for (const el of this.stage.querySelectorAll<HTMLElement>('.card.targetable')) {
      const x = parseFloat(el.style.left);
      const y = parseFloat(el.style.top);
      if (pt.x >= x - 6 && pt.x <= x + el.offsetWidth + 6 && pt.y >= y - 6 && pt.y <= y + el.offsetHeight + 6) return el;
    }
    return null;
  }

  /**
   * A curved arrow from the card (or hero) to the pointer, like Hearthstone's: it bends up and over,
   * its dashes flow toward the tip, and it snaps onto a valid target and turns gold when you're on one.
   */
  drawArrow(pt?: { x: number; y: number }) {
    if (pt) this.aimPt = pt;
    let svg = this.stage.querySelector('svg.aim-arrow') as SVGSVGElement | null;
    const src = this.arrowSource();
    if (!this.targeting || !src) { svg?.remove(); return; }
    let to = this.aimPt;
    if (!to) {
      // no pointer yet (phones): point at the first target
      const first = this.stage.querySelector('.card.targetable') as HTMLElement | null;
      to = first ? this.centre(first) : { x: src.x, y: src.y - 200 };
    }
    this.stage.querySelectorAll('.card.aimed').forEach((e) => e.classList.remove('aimed'));
    const hit = this.targetAt(to);
    if (hit) { hit.classList.add('aimed'); to = this.centre(hit); }
    const W = L.W;
    const H = this.stage.offsetHeight || 900;
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('aim-arrow');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = `<defs><filter id="aimGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <path class="aim-under"/><path class="aim-line"/><g class="aim-head"><path d="M -26 -24 L 18 0 L -26 24 L -14 0 Z"/></g><circle class="aim-ring" r="0"/>`;
      this.stage.appendChild(svg);
    }
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.classList.toggle('locked', !!hit);
    // a bend that rises with distance, always bulging upward
    const dx = to.x - src.x;
    const dy = to.y - src.y;
    const dist = Math.hypot(dx, dy);
    const lift = Math.min(260, 60 + dist * 0.35);
    const c = { x: src.x + dx * 0.5 - dx * 0.15, y: Math.min(src.y, to.y) - lift };
    // stop the line short of the tip so the head sits on it
    const ang = Math.atan2(to.y - c.y, to.x - c.x);
    const tip = { x: to.x - Math.cos(ang) * 6, y: to.y - Math.sin(ang) * 6 };
    const back = L.portrait ? 30 : 20;
    const end = { x: tip.x - Math.cos(ang) * back, y: tip.y - Math.sin(ang) * back };
    const d = `M ${src.x} ${src.y} Q ${c.x} ${c.y} ${end.x} ${end.y}`;
    svg.querySelector('.aim-under')!.setAttribute('d', d);
    svg.querySelector('.aim-line')!.setAttribute('d', d);
    svg.querySelector('.aim-head')!.setAttribute('transform', `translate(${tip.x} ${tip.y}) rotate(${(ang * 180) / Math.PI})${L.portrait ? ' scale(1.5)' : ''}`);
    const ring = svg.querySelector('.aim-ring')!;
    ring.setAttribute('cx', String(to.x));
    ring.setAttribute('cy', String(to.y));
    ring.setAttribute('r', hit ? String(Math.max(hit.offsetWidth, hit.offsetHeight) * 0.42) : '0');
  }

  /** Where each unit's card is on screen (its centre in stage pixels), keyed by unit id. */
  private cardCentres() {
    const m = new Map<string, { x: number; y: number; zone: string }>();
    const sr = this.stage.getBoundingClientRect();
    const k = sr.width / (this.stage.offsetWidth || 1);
    for (const el of this.stage.querySelectorAll<HTMLElement>('.card[data-id]')) {
      if (el.classList.contains('ghost') || !['shop', 'hand', 'board'].includes(el.dataset.zone ?? '')) continue;
      const r = el.getBoundingClientRect();
      m.set(el.dataset.id!, { x: (r.left + r.width / 2 - sr.left) / k, y: (r.top + r.height / 2 - sr.top) / k, zone: el.dataset.zone ?? '' });
    }
    return m;
  }

  /** After a redraw, cards that changed place slide there from where they were (instead of jumping). */
  private slideCards(before: Map<string, { x: number; y: number; zone: string }>) {
    if (!before.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of this.stage.querySelectorAll<HTMLElement>('.card[data-id]')) {
      const old = before.get(el.dataset.id!);
      const zone = el.dataset.zone ?? '';
      // played from hand onto the army: that one appears in a puff where it lands instead
      if (!old || (old.zone === 'hand' && zone === 'board')) continue;
      const dx = old.x - (parseFloat(el.style.left) + el.offsetWidth / 2);
      const dy = old.y - (parseFloat(el.style.top) + el.offsetHeight / 2);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 300, easing: 'cubic-bezier(.3, .85, .35, 1)' });
    }
  }

  /** Last seen stats of your units, so changes can be animated after each action. */
  private seen: { units: Map<number, { atk: number; hp: number; zone: string }>; slots: string[] } | null = null;

  private shopFeedback() {
    const p = this.me;
    const units = new Map<number, { atk: number; hp: number; zone: string }>();
    p.board.forEach((u, i) => { const v = unitView(p, u, 'board', i); units.set(u.uid, { atk: v.atk, hp: v.hp, zone: 'board' }); });
    p.hand.forEach((u, i) => { const v = unitView(p, u, 'hand', i); units.set(u.uid, { atk: v.atk, hp: v.hp, zone: 'hand' }); });
    const slots = p.slots.map((s) => `${s.atk}/${s.hp}/${s.kw.join(',')}`);
    const prev = this.seen;
    this.seen = { units, slots };
    if (!prev) return;
    for (const [uid, now] of units) {
      const el = this.stage.querySelector(`.card[data-id="${uid}"]`) as HTMLElement | null;
      if (!el || this.fxSkip.has(uid)) continue;
      const before = prev.units.get(uid);
      if (!before || (before.zone !== now.zone && now.zone === 'board')) {
        el.classList.add('summon-in');
        el.style.setProperty('--life', '650ms');
        if (now.zone === 'board') puff(this.stage, parseFloat(el.style.left) + el.offsetWidth / 2, parseFloat(el.style.top) + el.offsetHeight / 2, 650);
        continue;
      }
      const da = now.atk - before.atk;
      const dh = now.hp - before.hp;
      if (da > 0 || dh > 0) {
        el.classList.add('buff-flash');
        const f = document.createElement('div');
        f.className = 'float-num buff';
        f.textContent = `+${Math.max(0, da)}/+${Math.max(0, dh)}`;
        f.style.left = `${parseFloat(el.style.left) + el.offsetWidth / 2}px`;
        f.style.top = `${parseFloat(el.style.top) + 40}px`;
        this.stage.appendChild(f);
        setTimeout(() => f.remove(), 1000);
      }
    }
    slots.forEach((sl, i) => {
      if (sl !== prev.slots[i]) this.stage.querySelector(`.slot-plate[data-slot="${i}"]`)?.classList.add('flash');
    });
  }

  titleHtml() {
    const saved = loadSave();
    const canContinue = saved && saved.phase !== 'over';
    return `<div class="title-wrap">
      <h1 class="logo"><img src="${art('art/logo.png')}" alt="Torrekin" draggable="false"></h1>
      <div class="menu">
        ${canContinue ? `<button class="btn big primary" data-act="continue">Continue (Round ${saved!.round})</button>` : ''}
        <div class="new-row"><button class="btn big ${canContinue ? '' : 'primary'}" data-act="new">New Game</button>${this.ratingBadge()}</div>
        <button class="btn big" data-act="rules">How to Play</button>
        <button class="btn big" data-act="achievements">Achievements</button>
        <button class="btn big" data-act="options">Options</button>
      </div>
    </div>
    <div class="version">${versionLabel()}${__NO_UPDATES__ ? '' : ' · <a href="#" data-act="check-update" style="color:inherit">Check for updates</a>'}</div>`;
  }

  ratingBadge() {
    const r = getRating();
    return `<div class="rating-badge" title="Your rating. The Expert bot is ${EXPERT_ELO}. ${isProvisional(r) ? `Provisional: ${r.games}/10 games played.` : `${r.games} games, best ${r.peak}.`}">
      <span class="rb-label">Rating</span><span class="rb-num">${r.rating}</span></div>`;
  }

  rulesHtml() {
    const kws = Object.entries(KEYWORD_HELP).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>');
    return `<div class="title-wrap"><div class="panel rules">
      <h3>The Goal</h3>
      Six players draft armies of units and battle automatically each round. Everyone starts at about ${CONFIG.startHealth} Health (stronger heroes start with less).
      Lose a battle and you take 2 damage for each of the winner's surviving units. If time runs out with both armies still standing, both players take damage that way.
      Be the last one standing.
      <h3>Your Turn</h3>
      Buy units from the Tavern for ${CONFIG.buyCost} gold, then play them from your hand into your army (up to ${CONFIG.boardSize}).
      Sell units for ${CONFIG.sellValue} gold. Refresh the Tavern for ${CONFIG.rerollCost}. Freeze it to keep the same units next turn.
      Upgrade your Tavern to find stronger units (Tier 1 to ${CONFIG.maxTier}). Gold refills each turn and grows by 1, up to ${CONFIG.maxGold}.
      <h3>Slots</h3>
      Your army stands in 7 slots. Some cards improve a slot instead of a unit. Slot bonuses stay with the slot, so whoever stands there gets them. Drag units to rearrange.
      <h3>Golden Units</h3>
      Collect three copies of a unit and they combine into a Golden version with double stats and a stronger ability. Playing it lets you Discover a unit from one tier higher.
      <h3>Heroes and Trinkets</h3>
      Pick a hero at the start. Each has a Hero Power: some cost gold to use once per turn, others are always on.
      On turn 6 and turn 9 you can buy a Trinket, a permanent bonus.
      <h3>Combat</h3>
      The army with more units attacks first. Units attack from left to right, each hitting a random enemy (Taunt units first).
      <h3>Keywords</h3>${kws}
      <div style="text-align:center;margin-top:18px"><button class="btn" data-act="title">Back</button></div>
    </div></div>`;
  }

  heroSelectHtml() {
    const offer = this.me.heroOffer ?? HEROES.slice(0, 4).map((h) => h.id);
    const tribes = this.g!.tribes.map((t) => TRIBE_NAMES[t]).join(' · ') + `  (${7 - CONFIG.tribesPerGame} tribes banned)`;
    return `<div class="modal" style="background:rgba(255,255,255,.08)">
      <h2>Choose Your Hero</h2>
      <div class="hint lead">Tribes this game: ${esc(tribes)}</div>
      <div class="choices pairs">${offer.map((id) => {
        const h = heroDef(id)!;
        return `<div class="choice herocard" data-act="hero-pick" data-id="${id}">
          <div class="hero-portrait" style="background-image:url('${heroArt(h.id)}')"><div class="hp">${heroHealth(h.id)}</div></div>
          <div class="hn">${esc(h.name)}</div>
          <div class="pc htitle" style="font-size:14px;margin-top:-8px;text-align:center">${esc(h.title)}</div>
          <div class="pw">${esc(h.power)} ${h.passive ? '<span class="pc">(Passive)</span>' : `<span class="pc">(${h.costFn ? `starts at ${h.costFn(this.g!, this.me!)} gold` : `${h.cost} gold`})</span>`}</div>
          <div class="pt">${esc(h.text)}</div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }

  leaderboardHtml() {
    const g = this.g!;
    const order = [...g.players].sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.health - a.health || a.placement - b.placement);
    if (L.portrait) {
      // phones: just a portrait, a health bar and the number; tap a player for the details
      const chips = order.map((p) => {
        const next = this.me.nextOpponent === p.id;
        const pct = Math.max(0, Math.min(100, (p.health / heroHealth(p.hero)) * 100));
        return `<button class="pchip ${p.human ? 'me' : ''} ${next ? 'next' : ''} ${p.alive ? '' : 'dead'}" data-act="inspect" data-id="${p.id}" aria-label="${esc(p.name)}, ${p.health} Health">
          <div class="avatar" style="background-image:url('${heroArt(p.hero)}')">${next ? '<span class="tag">NEXT</span>' : ''}${p.human ? '<span class="tag you">YOU</span>' : ''}${!p.alive ? `<span class="place">${ordinal(p.placement)}</span>` : ''}</div>
          <div class="hpbar"><div style="width:${pct}%"></div></div>
          <div class="hpn">${Math.max(0, p.health)}</div>
        </button>`;
      }).join('');
      const b = L.leader;
      return `<div class="abs pstrip" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">${chips}</div>`;
    }
    const rows = order.map((p) => {
      const h = heroDef(p.hero);
      const next = this.me.nextOpponent === p.id;
      const pct = Math.max(0, Math.min(100, (p.health / heroHealth(p.hero)) * 100));
      return `<div class="row ${p.human ? 'me' : ''} ${next ? 'next' : ''} ${p.alive ? '' : 'dead'}" data-act="inspect" data-id="${p.id}">
        <div class="avatar" style="background-image:url('${heroArt(p.hero)}')"></div>
        <div class="meta">
          <div class="nm">${esc(p.name)}</div>
          <div class="hero-nm">${esc(h?.name ?? '')}${p.human ? '' : ` · ${seatRating(this.g!, p.id)}`}</div>
          <div class="hpbar"><div style="width:${pct}%"></div></div>
          <div class="nums"><span class="lhp"><i class="hp-dot"></i>${Math.max(0, p.health)}</span><span>★ ${p.tier}</span>${p.alive && (p.streak ?? 0) >= 2 ? `<span class="streak" title="${p.streak} wins in a row">🔥${p.streak}</span>` : ''}</div>
        </div>
        ${next ? '<div class="tag">NEXT</div>' : ''}
        <div class="lb-hist">${this.historyHtml(p)}</div>
        ${!p.alive ? `<div class="place">${ordinal(p.placement)}</div>` : ''}
      </div>`;
    }).join('');
    const ghostNext = this.me.nextOpponent === -1 ? '<div class="hint" style="margin-top:4px">Next: a ghost</div>' : '';
    const b = L.leader;
    return `<div class="abs panel leader ${b.horizontal ? 'horizontal' : ''}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">${rows}${b.horizontal ? '' : ghostNext}</div>`;
  }

  shopHtml() {
    const p = this.me;
    const tgt = this.targeting;
    const targetUids = tgt?.kind === 'play'
      ? new Set(validTargets(p, p.hand[tgt.handIdx]?.cardId ?? '').map((u) => u.uid))
      : tgt?.kind === 'hero' ? new Set((tgt.shop ? p.shop : p.board).map((u) => u.uid)) : null;
    let h = this.leaderboardHtml();
    h += this.tavernBarHtml();
    // copies you already own (hand + army, not Golden; locked ones count too): 1 = shimmer, 2 = one buy away
    const owned = new Map<string, number>();
    for (const u of [...p.hand, ...p.board]) if (!u.golden) owned.set(u.cardId, (owned.get(u.cardId) ?? 0) + 1);
    p.shop.forEach((u, i) => {
      const sel = this.sel?.zone === 'shop' && this.sel.idx === i ? 'selected' : '';
      const v = unitView(p, u, 'shop', i);
      const have = owned.get(u.cardId) ?? 0;
      const hint = have >= 2 ? 'triple-hint' : have === 1 ? 'pair-hint' : '';
      h += cardHtml(v, { zone: 'shop', idx: i, id: u.uid, x: shopX(i, p.shop.length), y: L.shopY, small: L.small && !L.shopBig, large: L.shopBig, extraClass: `${sel} ${hint} ${p.gold < buyCost(p, u.cardId) ? 'unaffordable' : ''} ${p.frozen ? 'frozen' : ''} ${targetUids?.has(u.uid) ? 'targetable' : ''}`,
        badge: have >= 2 ? '<div class="trip-tag">TRIPLE!</div>' : '' });
    });
    const skipping = p.heroMem.skipRound === this.g!.round;
    if (!p.shop.length) h += `<div class="hint abs" style="left:${L.cx - 240}px;top:${L.shopY + 70}px;width:480px">${skipping ? 'You skip your first turn. The Tavern opens next turn.' : 'The Tavern is empty. Refresh for new units.'}</div>`;
    // army slots
    for (let i = 0; i < CONFIG.boardSize; i++) {
      const s = p.slots[i];
      const bonus = [s.atk || s.hp ? `${s.atk >= 0 ? '+' : ''}${s.atk}/${s.hp >= 0 ? '+' : ''}${s.hp}` : '', ...s.kw.map((k) => ({ taunt: 'Taunt', divineShield: 'Shield', reborn: 'Reborn', venomous: 'Venom', poisonous: 'Poison', windfury: 'Windfury' })[k])].filter(Boolean).join(' · ');
      const buffed = s.atk || s.hp || s.kw.length;
      h += `<div class="slot-plate ${buffed ? 'buffed' : ''}" data-slot="${i}" style="left:${L.slotX(i)}px;top:${L.slotTop}px;width:${L.slotW}px;height:${L.slotH}px"><div class="bonus ${s.atk < 0 || s.hp < 0 ? 'neg' : ''}">${bonus || `Slot ${i + 1}`}</div></div>`;
    }
    // cards gained while the hand was full wait here until there's room
    if (p.overflow?.length) h += `<div class="overflow-pill abs" style="left:${L.cx - 160}px;top:${L.handY - 34}px;width:320px">Hand full · ${p.overflow.length} more card${p.overflow.length > 1 ? 's' : ''} waiting for room</div>`;
    // a unit being played with a targeted Battlecry stays in the slot it was dropped on while you aim
    const placing = tgt?.kind === 'play' && p.hand[tgt.handIdx] ? tgt : null;
    p.board.forEach((u, i) => {
      const sel = this.sel?.zone === 'board' && this.sel.idx === i ? 'selected' : '';
      const tg = targetUids?.has(u.uid) ? 'targetable' : '';
      const at = placing && i >= placing.pos ? i + 1 : i;
      h += cardHtml(unitView(p, u, 'board', i), { zone: 'board', idx: i, x: boardCardX(at), y: L.boardY, small: L.small, extraClass: `${sel} ${tg}`, id: u.uid });
    });
    if (placing) {
      const u = p.hand[placing.handIdx];
      h += cardHtml(unitView(p, u, 'hand', placing.handIdx), { zone: 'placing', idx: placing.handIdx, x: boardCardX(Math.min(placing.pos, p.board.length)), y: L.boardY, small: L.small, extraClass: 'placing' });
    }
    h += this.heroAreaHtml();
    // hand: along the bottom edge, cards rise when hovered
    p.hand.forEach((u, i) => {
      if (placing && i === placing.handIdx) return;
      const sel = this.sel?.zone === 'hand' && this.sel.idx === i ? 'selected' : '';
      const waiting = handLocked(p, u) ? `hand-locked unlock-${u.mem.unlockTier}` : '';
      h += cardHtml(unitView(p, u, 'hand', i), { zone: 'hand', idx: i, x: handX(i, p.hand.length), y: L.handY, small: !L.shopBig, large: L.shopBig, extraClass: `in-hand ${sel} ${waiting}`, id: u.uid });
    });
    h += this.rightSideHtml();
    h += `<div id="popover">${this.popoverHtml()}</div>`;
    if (tgt) {
      h += `<div class="abs panel target-bar" style="left:${L.targetBar.x}px;top:${L.targetBar.y}px;width:${L.targetBar.w}px">
        <span>${tgt.kind === 'hero' ? (tgt.shop ? 'Choose a unit in the Tavern to load' : 'Choose a unit for your Hero Power') : `Choose a target for ${esc(def(p.hand[tgt.handIdx]?.cardId ?? 'skel').name)}`}</span>
        ${tgt.kind === 'play' ? '<button class="btn" data-act="no-target">No target</button>' : ''}
        <button class="btn" data-act="cancel-target">Cancel</button></div>`;
    }
    if (p.discovers.length) h += this.discoverHtml();
    else if (p.trinketOffer) h += this.trinketHtml();
    if (this.inspect !== null) h += this.inspectHtml();
    return h;
  }

  /** Top of the screen, as in Battlegrounds: Upgrade — Tavern — Refresh, Freeze. */
  tavernBarHtml() {
    const p = this.me;
    const upCost = p.tier >= CONFIG.maxTier ? null : p.upgradeCost;
    const t = L.phone?.tavern;
    const at = (cx: number, landX: number) => (t ? `left:${cx - t.btn / 2}px;top:${t.btnTop}px` : `left:${landX}px;top:${L.tavernY + 14}px`);
    return `
      <div class="tavern-btn upgrade ${upCost === null || p.gold < upCost ? 'off' : ''}" data-act="upgrade" style="${at(t?.up ?? 0, L.cx - 175)}" title="Upgrade the Tavern">
        <div class="tb-icon">${PIX_ICON.up}</div>${upCost === null ? '' : `<div class="tb-cost">${upCost}</div>`}
        <div class="tb-label">${upCost === null ? 'Max Tier' : 'Upgrade'}</div>
      </div>
      <div class="tavern-keeper" style="left:${t ? L.cx - t.kp / 2 : L.cx - 66}px;top:${L.tavernY}px">
        <div class="tk-portrait"></div>
        <div class="tk-num"><small>Tier</small><span>${p.tier}</span></div>
        <div class="tk-tier">${'★'.repeat(p.tier)}</div>
        <div class="tk-label">Tavern · Tier ${p.tier}</div>
      </div>
      <div class="tavern-btn refresh ${p.gold < CONFIG.rerollCost ? 'off' : ''}" data-act="reroll" style="${at(t?.refresh ?? 0, L.cx + 87)}" title="Refresh the Tavern">
        <div class="tb-icon">${PIX_ICON.refresh}</div><div class="tb-cost">${CONFIG.rerollCost}</div><div class="tb-label">Refresh</div>
      </div>
      <div class="tavern-btn freeze ${p.frozen ? 'on' : ''}" data-act="freeze" style="${at(t?.freeze ?? 0, L.cx + 187)}" title="Freeze the Tavern">
        <div class="tb-icon">${PIX_ICON.freeze}</div><div class="tb-label">${p.frozen ? 'Frozen' : 'Freeze'}</div>
      </div>`;
  }

  /** One hero power's state for display: label suffix and whether it can be used now. */
  powerStatus(h: HeroDef): { ready: boolean; note: string } {
    const g = this.g!;
    const p = this.me;
    const prog = h.progress?.(g, p) ?? null;
    if (h.passive) return { ready: false, note: prog ?? '' };
    if (p.usedPowers.includes(h.id)) return { ready: false, note: 'Used' };
    const lock = h.locked?.(g, p);
    if (lock) return { ready: false, note: lock };
    if (p.gold < powerCost(g, p, h)) return { ready: false, note: prog ?? '' };
    return { ready: canUseHeroPower(g, p, h.id), note: prog ?? '' };
  }

  /** a counter badge on your hero (e.g. "2/5"); turns gold once the power is switched on */
  heroCountHtml() {
    const g = this.g!;
    const p = this.me;
    for (const h of powersOf(p)) {
      const t = h.progress?.(g, p);
      if (!t) continue;
      const on = t === 'Active';
      return `<div class="hero-count ${on ? 'on' : ''}" title="${esc(h.power)}">${on ? '★ Active' : esc(t)}</div>`;
    }
    return '';
  }

  /** Bottom centre: your hero (it carries your Hero Powers), trinkets beside it. */
  heroAreaHtml() {
    const g = this.g!;
    const p = this.me;
    const powers = powersOf(p);
    const main = mainActive(p);
    const canPower = powers.some((h) => !h.passive && canUseHeroPower(g, p, h.id));
    const powered = powers.some((h) => h.progress?.(g, p) === 'Active');
    const state = `${!powers.length ? '' : !main ? 'passive' : canPower ? 'ready' : 'spent'}${powered ? ' powered' : ''}`;
    const costBadge = main ? `<div class="tb-cost">${powerCost(g, p, main)}</div>` : '';
    const ph = L.phone;
    if (ph) {
      // phones: tapping the hero opens a sheet with the powers and Use buttons (there is no hover)
      const hs = ph.heroSize;
      let out = `<button class="my-hero ${state}" data-act="hero-info" aria-label="Your hero powers" style="left:${L.cx - hs / 2}px;top:${L.heroY - hs / 2}px;width:${hs}px;height:${hs}px">
        <div class="hero-portrait" style="width:${hs}px;height:${hs}px;background-image:url('${heroArt(p.hero)}')"><div class="hp">${p.health}</div></div>
        ${costBadge}${this.heroCountHtml()}
      </button>`;
      if (powers.length) {
        const one = powers[0];
        const st = this.powerStatus(one);
        const label = powers.length > 1 ? `${powers.length} Hero Powers${canPower ? ' · Tap' : ''}` : `${one.power}${st.ready ? ' · Tap' : st.note ? ` · ${st.note}` : ''}`;
        out += `<button class="power-pill ${state}" data-act="hero-info" style="left:${L.cx - 170}px;top:${ph.pillY}px;width:340px">${esc(label)}</button>`;
      }
      p.trinkets.forEach((tid, i) => {
        const td = trinketDef(tid);
        out += `<button class="trinket-orb ${td.greater ? 'greater' : ''}" data-act="trinket-info" data-id="${tid}" aria-label="${esc(td.name)}" style="left:${ph.trinket.x}px;top:${ph.trinket.y + i * ph.trinket.step}px;width:${ph.trinket.size}px;height:${ph.trinket.size}px"></button>`;
      });
      const qs = p.quests.filter((q) => q.have < q.need);
      if (qs.length) out += `<div class="quest-chip" style="left:${ph.quest.x}px;top:${ph.quest.y}px;width:${ph.quest.w}px">${qs.map((q) => `${q.kind === 'bill' ? 'Demons' : 'Kindred'} ${q.have}/${q.need}`).join(' · ')}</div>`;
      return out;
    }
    // PC: hover for the tooltip; click uses your one active power, or opens the list when you have several
    const act = powers.length > 1 ? 'data-act="hero-info"' : main ? `data-act="hero-power" data-id="${main.id}"` : '';
    const tipRows = powers.map((h) => {
      const st = this.powerStatus(h);
      return `<div class="tip-power"><b>${esc(h.power)}</b> ${h.passive ? '(Passive)' : `(${powerCost(g, p, h)} gold)`}${st.note ? ` · <i>${esc(st.note)}</i>` : ''}<br>${esc(h.text)}</div>`;
    }).join('');
    const hint = powers.length > 1 ? 'Click your hero to choose a power.' : main ? (p.usedPowers.includes(main.id) ? 'Used this turn.' : 'Click your hero to use it.') : '';
    let h = `<div class="my-hero ${state}" ${act} style="left:${L.cx - 70}px;top:${L.heroY - 70}px">
      <div class="hero-portrait" style="background-image:url('${heroArt(p.hero)}')"><div class="hp">${p.health}</div></div>
      ${costBadge}${this.heroCountHtml()}
      ${powers.length ? `<div class="tip">${tipRows}${hint ? `<i>${hint}</i>` : ''}</div>` : ''}
    </div>`;
    p.trinkets.forEach((t, i) => {
      const td = trinketDef(t);
      h += `<div class="trinket-orb ${td.greater ? 'greater' : ''}" style="left:${L.cx - 150 - i * 70}px;top:${L.heroY - 30}px">
        <div class="tip"><b>${esc(td.name)}</b><br>${esc(td.text)}${td.progress ? `<br><i>${esc(td.progress(p))}</i>` : ""}</div></div>`;
    });
    const quests = p.quests.filter((q) => q.have < q.need);
    if (quests.length) {
      h += `<div class="quest-chip" style="left:${L.cx - 140 - p.trinkets.length * 70 - 120}px;top:${L.heroY - 16}px">${quests.map((q) => `${q.kind === 'bill' ? 'Demons' : 'Kindred'} ${q.have}/${q.need}`).join('<br>')}</div>`;
    }
    return h;
  }

  /** Right edge: End Turn in the middle, gold at the bottom right, menu gear in the corner. */
  rightSideHtml() {
    const p = this.me;
    const max = maxGoldFor(this.g!, p);
    const pips = Array.from({ length: Math.min(max, 12) }, (_, i) => `<span class="pip ${i < p.gold ? 'full' : ''}"></span>`).join('');
    const ph = L.phone;
    return `
      <div class="turn-label" style="${ph ? `left:${ph.turnLabel.x}px;top:${ph.turnLabel.y}px;width:${ph.turnLabel.w}px` : `left:${L.endTurn.x + 6}px;top:${L.endTurn.y - 30}px`}">Turn ${this.g!.round}</div>
      <button class="end-turn" data-act="end-turn" style="left:${L.endTurn.x}px;top:${L.endTurn.y}px${ph ? `;width:${ph.endTurnW}px` : ''}">Begin Battle</button>
      <div class="gold-bar" style="left:${L.gold.x}px;top:${L.gold.y}px">
        <div class="gold-display"><span class="coin"></span>${p.gold}<span class="gmax">/${max}</span></div>
        <div class="pips">${pips}</div>
        ${p.goldNextTurn ? `<div class="hint" style="padding:0">+${p.goldNextTurn} gold next turn</div>` : ''}
      </div>
      <button class="gear" data-act="options" style="left:${L.gear.x}px;top:${L.gear.y}px;width:${L.gear.size}px;height:${L.gear.size}px;font-size:${Math.round(L.gear.size * 0.5)}px" title="Options">⚙</button>
      ${this.tribesHtml()}
      <button class="btn cards-btn" data-act="cards" style="left:${L.cardsBtn.x}px;top:${L.cardsBtn.y}px${ph ? `;width:${ph.cardsW - 104}px` : ''}">📖 Cards</button>
      <button class="btn undo-btn" data-act="undo" ${this.canUndo() ? '' : 'disabled'} title="Undo (Ctrl+Z). Anything that showed you something new, like a Refresh or a random effect, can't be undone." aria-label="Undo"
        style="${ph ? `left:${L.cardsBtn.x + ph.cardsW - 92}px;top:${L.cardsBtn.y}px;width:92px` : `left:${L.cardsBtn.x}px;top:${L.cardsBtn.y + 56}px`}">${ph ? '↶' : '↶ Undo'}</button>
      ${this.sheet ? this.sheetHtml() : ''}`;
  }

  /** Hover (or tap) to see which tribes are in this match. */
  tribesHtml() {
    const g = this.g!;
    const b = L.tribes;
    const dots = g.tribes.map((t) => `<span class="tdot t-${t}"></span>`).join('');
    const rows = ALL_TRIBES.map((t) => {
      const on = g.tribes.includes(t);
      return `<div class="trow ${on ? 'on' : 'off'}"><span class="tdot t-${t}"></span>${esc(TRIBE_NAMES[t])}<span class="tstate">${on ? 'In' : 'Out'}</span></div>`;
    }).join('');
    return `<div class="tribes-chip ${this.showTribes ? 'open' : ''}" data-act="tribes" style="left:${b.x}px;top:${b.y}px;width:${b.w}px">
      <span class="tlabel">Tribes</span><span class="tdots">${dots}</span>
      <div class="tribes-tip"><b>Tribes this game</b>${rows}<div class="trow on"><span class="tdot t-neutral"></span>Neutral<span class="tstate">Always</span></div></div>
    </div>`;
  }

  optionsHtml() {
    const mode = getMode();
    const speed = speedSetting();
    const seg = (act: string, items: [string, string][], cur: string, key = 'mode') => `<div class="seg">${items.map(([v, label]) =>
      `<button class="btn ${cur === v ? 'on' : ''}" data-act="${act}" data-${key}="${v}">${label}</button>`).join('')}</div>`;
    return `<div class="modal" style="z-index:80"><div class="panel options">
      <h2 style="font-size:34px">Options</h2>
      <div class="opt-row"><span>Screen layout</span>${seg('layout', [['auto', 'Auto'], ['landscape', 'Landscape'], ['portrait', 'Portrait']], mode)}</div>
      <div class="hint" style="margin-top:-8px">Auto picks portrait when the window is taller than it is wide.</div>
      <div class="opt-row"><span>Sound</span>${seg('sound', [['on', 'On'], ['off', 'Off']], isMuted() ? 'off' : 'on')}</div>
      ${this.cloudRowHtml()}
      <div class="opt-row"><span>Interface</span>${seg('ui-style', [['smooth', 'Smooth'], ['pixel', 'Pixel']], uiStyle())}</div>
      <div class="opt-row"><span>Card art</span>${seg('art-style', [['illustrated', 'Illustrated'], ['classic', 'Classic']], getArtStyle())}</div>
      <div class="opt-row"><span>Battle speed</span>${seg('speed', SPEEDS.map((s) => [String(s.v), s.label]), String(speed), 'v')}</div>
      <div class="opt-row"><span>Debug mode (errors on screen)</span>${seg('debug', [['on', 'On'], ['off', 'Off']], debugOn() ? 'on' : 'off')}</div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button class="btn" data-act="cards">Card Viewer</button>
        <button class="btn" data-act="achievements">Achievements</button>
      </div>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
        <button class="btn big primary" data-act="close-options">Done</button>
        ${this.screen === 'shop' ? '<button class="btn big" data-act="menu">Quit to Title</button>' : ''}
      </div>
    </div></div>`;
  }

  /** Options: cloud save status, sign in / out */
  cloudRowHtml() {
    const p = cloudProvider();
    const st = cloudState();
    if (!p || st === 'off') return '';
    if (p.kind === 'platform') {
      return `<div class="opt-row"><span>Cloud save</span><div class="cloud-info"><b>${esc(p.label)}</b> · <span id="cloud-status">${esc(cloudStatus())}</span></div></div>`;
    }
    if (st === 'signedOut') {
      return `<div class="opt-row"><span>Cloud save</span><button class="btn" data-act="account">Sign in</button></div>
        <div class="hint" style="margin-top:-8px">Sign in to keep your rating, achievements and game on all your devices. Spellstorm accounts work here too.</div>`;
    }
    return `<div class="opt-row"><span>Cloud save</span><div class="cloud-info">${esc(supabase.email() ?? '')}<br><span id="cloud-status" class="cloud-st">${esc(cloudStatus())}</span></div></div>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:-6px"><button class="btn" data-act="sync-now">Sync now</button><button class="btn" data-act="sign-out">Sign out</button></div>`;
  }

  /** the sign-in window (email + password; the same accounts as Spellstorm) */
  accountHtml() {
    const a = this.account!;
    return `<div class="modal" style="z-index:90"><form class="panel account" data-form="account" onsubmit="return false">
      <h2 style="font-size:30px">Cloud save</h2>
      <p class="hint">Sign in or create an account to keep your progress in sync on all your devices. If you play Spellstorm, use that account.</p>
      <label>Email<input id="acc-email" type="email" autocomplete="email" required></label>
      <label>Password<input id="acc-pw" type="password" autocomplete="current-password" minlength="6"></label>
      <div class="acc-msg ${a.ok ? 'ok' : ''}" id="acc-msg">${esc(a.msg)}</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="btn big primary" data-act="acc-signin" ${a.busy ? 'disabled' : ''}>Sign in</button>
        <button class="btn big" data-act="acc-create" ${a.busy ? 'disabled' : ''}>Create account</button>
      </div>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:6px">
        <button class="btn" data-act="acc-forgot" ${a.busy ? 'disabled' : ''}>Forgot password</button>
        <button class="btn" data-act="acc-close">Cancel</button>
      </div>
    </form></div>`;
  }

  private async accountAction(kind: 'signin' | 'create' | 'forgot') {
    const email = (this.stage.querySelector('#acc-email') as HTMLInputElement | null)?.value.trim() ?? '';
    const pw = (this.stage.querySelector('#acc-pw') as HTMLInputElement | null)?.value ?? '';
    const msg = (t: string, ok = false) => {
      if (!this.account) return;
      this.account = { msg: t, ok, busy: false };
      const m = this.stage.querySelector('#acc-msg');
      if (m) { m.textContent = t; m.classList.toggle('ok', ok); }
      this.stage.querySelectorAll<HTMLButtonElement>('[data-form="account"] button').forEach((b) => { b.disabled = false; });
    };
    if (!email.includes('@')) return msg('Enter your email address.');
    if (kind !== 'forgot' && pw.length < 6) return msg('Passwords need at least 6 characters.');
    this.stage.querySelectorAll<HTMLButtonElement>('[data-form="account"] button:not([data-act="acc-close"])').forEach((b) => { b.disabled = true; });
    try {
      if (kind === 'forgot') {
        await supabase.resetPassword(email);
        return msg('If that email has an account, a reset link is on its way.', true);
      }
      const r = await supabase.signIn(email, pw, kind === 'create');
      if (r === 'confirmEmail') return msg('Account created. Check your email to confirm it, then sign in here.', true);
      this.account = null;
      this.render();
      await sync.signedIn();
      this.toast(cloudState() === 'error' ? cloudStatus() : 'Signed in. Your progress is saved to the cloud.');
      this.render();
    } catch (e) {
      msg(friendly(e));
    }
  }

  /** when the current card was selected (see justSelected) */
  private selAt = 0;
  private justSelected() { return performance.now() - this.selAt < 450; }

  /** The enlarged card shown next to a hovered or selected card (with actions when selected). */
  popoverHtml() {
    const p = this.me;
    const s = this.sel ?? (this.targeting && L.popover !== "stack" ? null : this.hover);
    // while aiming, the enlarged card would sit on top of the targets
    if (!s) return '';
    const list = s.zone === 'shop' ? p.shop : s.zone === 'hand' ? p.hand : p.board;
    const u = list[s.idx];
    if (!u) return '';
    const v = unitView(p, u, s.zone, s.idx);
    let actions = '';
    if (this.sel) {
      if (s.zone === 'shop') actions = `<button class="btn primary" data-act="buy" ${p.gold < buyCost(p, u.cardId) ? 'disabled' : ''}>Buy <span class="cost">${buyCost(p, u.cardId)}<span class="coin"></span></span></button>`;
      if (s.zone === 'hand') actions = handLocked(p, u)
        ? `<button class="btn" disabled>Unlocks at Tier ${u.mem.unlockTier}</button>`
        : `<button class="btn primary" data-act="play" ${p.board.length >= CONFIG.boardSize ? 'disabled' : ''}>Play</button>`;
      if (s.zone === 'board') actions = `<button class="btn" data-act="left" ${s.idx === 0 || u.mem.locked ? 'disabled' : ''}>◀</button>
        <button class="btn primary" data-act="sell" ${u.mem.locked ? 'disabled' : ''}>Sell <span class="cost">+${sellValue(u, p)}<span class="coin"></span></span></button>
        <button class="btn" data-act="right" ${s.idx >= p.board.length - 1 || u.mem.locked ? 'disabled' : ''}>▶</button>`;
    }
    // place it beside the card (above it for cards in hand)
    // phones get a much bigger card (zoomed in CSS) and big buttons; numbers here match styles.css
    // twice the old size: 236x340 card zoomed 1.78 (landscape) or 2.6 (phones)
    const W = L.portrait ? 614 : 420;
    const H = L.portrait ? 884 + (actions ? 118 : 0) : 605 + (actions ? 54 : 0);
    let x: number;
    let y: number;
    let actionsTop = false;
    if (L.popover === 'stack') {
      // portrait: shop cards show it over the army, army cards over the shop, hand cards above the hand
      const cx = s.zone === 'shop' ? shopX(s.idx, p.shop.length) + L.shopCardW / 2
        : s.zone === 'hand' ? handX(s.idx, p.hand.length) + L.handCardW / 2 : L.slotX(s.idx) + L.slotW / 2;
      x = Math.max(8, Math.min(L.W - W - 8, cx - W / 2));
      y = s.zone === 'shop' ? L.shopY + L.shopCardH + 14 : s.zone === 'board' ? L.slotTop - H - 6 : L.handY - H - 12;
      y = Math.max(8, Math.min(L.H - H - 8, y));
      // if there isn't room above the card, the big card covers it: then the buttons go on top of the
      // big card (far from your finger) instead of at its bottom, right where you just tapped
      const cardTop = s.zone === 'board' ? L.slotTop : s.zone === 'hand' ? L.handY : -1;
      if (actions && cardTop >= 0 && y + H > cardTop) actionsTop = true;
    } else if (s.zone === 'hand') {
      x = handX(s.idx, p.hand.length) + L.handCardW / 2 - W / 2;
      y = L.handY - H - 40;
    } else {
      const cx = s.zone === 'shop' ? shopX(s.idx, p.shop.length) : boardCardX(s.idx);
      const cy = s.zone === 'shop' ? L.shopY : L.boardY;
      x = cx + L.cardW + W + 16 < L.W - 200 ? cx + L.cardW + 12 : cx - W - 12;
      y = cy - 50;
    }
    if (L.popover === 'beside') {
      x = Math.max(220, Math.min(L.W - 210 - W, x));
    }
    y = Math.max(8, Math.min(L.H - 10 - H, y));
    return `<div class="popover ${actions ? 'interactive' : ''} ${actionsTop ? 'actions-top' : ''} ${actions && this.justSelected() ? 'arming' : ''}" style="left:${x}px;top:${y}px;width:${W}px">
      <div class="pop-card">${bigCardHtml(v, '', this.me)}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
  }

  /** Phones: details for your hero power or a trinket, with a big Use button where it applies. */
  sheetHtml() {
    const p = this.me;
    const s = this.sheet!;
    let title = '';
    let sub = '';
    let body = '';
    let action = '';
    if (s.kind === 'hero') {
      // every power you have, each with its own Use button
      const blocks = powersOf(p).map((hd) => {
        const st = this.powerStatus(hd);
        const cost = powerCost(this.g!, p, hd);
        const use = hd.passive ? '' : `<button class="btn big primary" data-act="hero-power" data-id="${hd.id}" ${st.ready ? '' : 'disabled'}>${p.usedPowers.includes(hd.id) ? 'Used this turn' : `Use <span class="cost">${cost}<span class="coin"></span></span>`}</button>`;
        return `<div class="sheet-power"><div class="sheet-title">${esc(hd.power)}</div>
          <div class="sheet-sub">${esc(hd.name)} · ${hd.passive ? 'Passive' : `${cost} gold, once per turn`}${st.note ? ` · ${esc(st.note)}` : ''}</div>
          <div class="sheet-body">${esc(hd.text)}</div>${use ? `<div class="sheet-actions">${use}</div>` : ''}</div>`;
      }).join('');
      return `<div class="modal sheet-wrap" data-act="sheet-close"><div class="panel sheet">${blocks}
        <div class="sheet-actions"><button class="btn big" data-act="sheet-close">Close</button></div></div></div>`;
    } else {
      const td = trinketDef(s.id);
      title = td.name;
      sub = td.greater ? 'Greater Trinket' : 'Lesser Trinket';
      body = td.text + (td.progress ? ` (${td.progress(this.me)})` : "");
    }
    return `<div class="modal sheet-wrap" data-act="sheet-close"><div class="panel sheet">
      <div class="sheet-title">${esc(title)}</div><div class="sheet-sub">${esc(sub)}</div>
      <div class="sheet-body">${esc(body)}</div>
      <div class="sheet-actions">${action}<button class="btn big" data-act="sheet-close">Close</button></div>
    </div></div>`;
  }

  discoverHtml() {
    const d = this.me.discovers[0];
    if (d.powers) {
      return `<div class="modal"><h2>${esc(d.reason)}</h2><div class="choices pairs">${d.options.map((id, i) => {
        const h = heroDef(id)!;
        return `<div class="choice herocard" data-act="discover" data-idx="${i}">
          <div class="hero-portrait" style="background-image:url('${heroArt(h.id)}')"></div>
          <div class="hn">${esc(h.power)}</div>
          <div class="pw"><span class="pc">${esc(h.name)} · ${h.passive ? 'Passive' : `${powerCost(this.g!, this.me, h)} gold`}</span></div>
          <div class="pt">${esc(h.text)}</div>
        </div>`;
      }).join('')}</div></div>`;
    }
    return `<div class="modal"><h2>${esc(d.reason)}</h2><div class="choices">${d.options.map((id, i) => {
      const dd = def(id);
      const m = d.golden ? 2 : 1;
      return `<div class="choice" data-act="discover" data-idx="${i}">${bigCardHtml({ cardId: id, golden: !!d.golden, atk: dd.atk * m, hp: dd.hp * m, kw: [...dd.keywords] }, '', this.me)}</div>`;
    }).join('')}</div></div>`;
  }

  trinketHtml() {
    const p = this.me;
    const offer = p.trinketOffer!;
    const greater = trinketDef(offer[0]).greater;
    return `<div class="modal"><h2>${greater ? 'Greater' : 'Lesser'} Trinket</h2>
      <div class="hint lead">Choose one to buy. You have ${p.gold} gold. (Placeholder trinkets.)</div>
      <div class="choices pairs">${offer.map((id) => {
        const t = trinketDef(id);
        return `<div class="choice trinketcard ${t.greater ? 'greater' : ''} ${t.cost > p.gold ? 'cant' : ''}" data-act="trinket" data-id="${id}">
          <div class="gem"></div><div class="tn">${esc(t.name)}</div><div class="tt">${esc(t.text)}</div>
          <div class="pc" style="font-family:var(--display);color:#e6a10f;font-size:18px">${t.cost} <span class="coin"></span></div></div>`;
      }).join('')}</div>
      <button class="btn" data-act="trinket-skip">Skip</button></div>`;
  }

  /** a player's last 3 battles: round, opponent, result and damage */
  historyHtml(p: Player) {
    const recent = (p.history ?? []).slice(-3).reverse();
    if (!recent.length) return '<div class="lh-title">No battles yet</div>';
    const g = this.g!;
    const rows = recent.map((h) => {
      const o = g.players[h.vs];
      const who = o ? `${o.human ? 'You' : esc(o.name)}${h.ghost ? ' (ghost)' : ''}` : 'a ghost';
      const res = h.result === 'win' ? `<b class="w">Won</b> vs ${who}` : h.result === 'loss' ? `<b class="l">Lost</b> to ${who}` : `<b class="d">Draw</b> with ${who}`;
      const dmg = h.result === 'win' ? ` · dealt ${h.dmg}` : h.result === 'loss' || h.dmg ? ` · took ${h.dmg}` : '';
      return `<div class="lh-row"><span class="lh-r">R${h.round}</span>${res}<span class="lh-d">${dmg}</span></div>`;
    }).join('');
    return `<div class="lh-title">Last ${recent.length === 1 ? 'battle' : `${recent.length} battles`}</div>${rows}`;
  }

  inspectHtml() {
    const p = this.g!.players[this.inspect!];
    const h = heroDef(p.hero);
    const per = personaById(p.persona);
    const seen = this.seenBoards.get(p.id);
    const cards = seen?.length
      ? seen.map((u, i) => cardHtml({ cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp, kw: u.kw }, { zone: 'none', idx: i, x: 0, y: 0, small: true }).replace('position:absolute', '').replace(/style="left:0px;top:0px"/, 'style="position:relative"')).join('')
      : '<div class="hint">You have not fought this player yet.</div>';
    return `<div class="modal" data-act="close-inspect">
      <div class="panel inspect-panel" style="padding:24px 30px;display:flex;flex-direction:column;gap:14px;align-items:center;min-width:700px">
        <div style="display:flex;gap:18px;align-items:center">
          <div class="hero-portrait" style="width:96px;height:96px;background-image:url('${heroArt(p.hero)}')"><div class="hp">${p.health}</div></div>
          <div><div class="ip-name" style="font-family:var(--display);font-size:26px">${esc(p.name)}${per ? ` <span class="ip-rating">${seatRating(this.g!, p.id)}</span>` : ''}</div>
          ${per ? `<div class="ip-style">“${esc(per.style)}”</div>` : ''}
          <div class="hint" style="padding:0;text-align:left">Playing <b>${esc(h?.name ?? '')}</b>, ${esc(h?.title ?? '')}<br>${powersOf(p).map((x) => `${esc(x.power)}: ${esc(x.text)}`).join('<br>')}<br>Tavern Tier ${p.tier}${p.trinkets.length ? ' · Trinkets: ' + p.trinkets.map((t) => trinketDef(t).name).join(', ') : ''}</div></div>
        </div>
        <div class="ip-hist">${this.historyHtml(p)}</div>
        <div class="hint">Army when you last fought:</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${cards}</div>
        <button class="btn" data-act="close-inspect">Close</button>
      </div></div>`;
  }

  /** The game is over for you: achievements and your rating (once per game). */
  gameEnded(g: GameState) {
    recordGameEnd(g);
    const c = rateGame(g);
    if (c) { this.lastRating = c; save(g); }
  }

  overHtml() {
    const p = this.me;
    const place = p.placement || 1;
    const c = this.lastRating;
    const rating = c ? `<div class="rating-change ${c.delta >= 0 ? 'up' : 'down'}">
        <span class="rc-label">Rating</span><span class="rc-from">${c.before}</span><span class="rc-arrow">→</span><span class="rc-to">${c.after}</span>
        <span class="rc-delta">${c.delta >= 0 ? '+' : ''}${c.delta}</span></div>` : '';
    // top 4 is a win
    return `<div class="modal"><h2>${place <= 4 ? 'Victory!' : 'Defeat'}</h2>
      <div class="hint lead" style="font-size:26px">You finished ${ordinal(place)}</div>
      ${rating}
      <div class="hint lead">Rounds survived: ${this.g!.round}</div>
      <div style="display:flex;gap:14px"><button class="btn big primary" data-act="new">Play Again</button><button class="btn big" data-act="title">Title</button></div></div>`;
  }

  updateDetail() {
    const el = this.stage.querySelector('#popover');
    if (el) el.innerHTML = this.popoverHtml();
  }

  toast(msg: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    this.stage.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  // ---------------- state changes ----------------
  commit() {
    if (!this.g) return this.render();
    save(this.g);
    const events = this.screen === 'shop' ? (this.me.tripleEvents?.splice(0) ?? []) : [];
    const fx = this.screen === 'shop' ? this.takeFx() : [];
    this.trackUndo();
    // remember where the copies were before they disappear from the screen
    const where = new Map<number, { x: number; y: number }>();
    for (const e of events) for (const uid of e.uids) {
      const el = this.stage.querySelector(`.card[data-id="${uid}"]`) as HTMLElement | null;
      if (el) where.set(uid, { x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
    }
    // units that effect playback animates itself are left alone by the generic feedback
    this.fxSkip = new Set(fx.flatMap((e) => [...e.buffs.map((b) => b.uid), ...e.gains, ...e.summons]));
    for (const e of events) this.fxSkip.delete(e.goldenUid);
    this.render();
    this.fxSkip = new Set();
    if (events.length) {
      bump('triples', events.length);
      noteGame('triple', this.g);
    }
    if (fx.length || events.length) {
      // shop effects don't lock the shop (keep buying while they play); triples still do
      // new cards wait hidden for their moment (e.g. behind the Recruit transition)
      for (const e of fx) for (const uid of [...e.gains, ...e.summons]) {
        const el = this.stage.querySelector(`.card[data-id="${uid}"]`) as HTMLElement | null;
        if (el) el.style.visibility = 'hidden';
      }
      const gate = this.fxGate;
      void (async () => {
        await gate;
        if (fx.length) await this.playFx(fx.filter((e) => !events.some((t) => e.gains.includes(t.goldenUid) && e.gains.length === 1)), false);
        if (events.length) await this.celebrate(events, where);
      })();
    }
    evaluate(this.g);
  }

  /** Freezing the shop: frost sweeps over every shop card and snowflakes drift down off them */
  private freezeFx() {
    const cards = [...this.stage.querySelectorAll<HTMLElement>('.card[data-zone="shop"]')];
    cards.forEach((el, i) => {
      const ice = document.createElement('div');
      ice.className = 'freeze-sheet';
      ice.style.animationDelay = `${i * 70}ms`;
      el.appendChild(ice);
      setTimeout(() => ice.remove(), 1400 + i * 70);
      const x = parseFloat(el.style.left);
      const y = parseFloat(el.style.top);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      for (let k = 0; k < 9; k++) {
        const f = document.createElement('div');
        f.className = 'snowflake';
        f.textContent = k % 3 ? '❄' : '•';
        f.style.left = `${x + 10 + Math.random() * (w - 20)}px`;
        f.style.top = `${y + h * (0.55 + Math.random() * 0.4)}px`;
        f.style.setProperty('--dx', `${(Math.random() - 0.5) * 50}px`);
        f.style.setProperty('--dy', `${70 + Math.random() * 80}px`);
        f.style.setProperty('--rot', `${(Math.random() - 0.5) * 360}deg`);
        f.style.fontSize = `${12 + Math.random() * 14}px`;
        f.style.animationDelay = `${i * 70 + 250 + Math.random() * 500}ms`;
        this.stage.appendChild(f);
        setTimeout(() => f.remove(), 2400);
      }
    });
  }

  // ---------------- undo ----------------
  /** saved states you can go back to this turn, newest last */
  private undoStack: string[] = [];
  private undoAt: { json: string; rng: number; round: number } | null = null;

  /**
   * Called on every change in the shop. A change that drew a random number (rerolls, random targets,
   * Discovers, random cards) showed you something new, so everything before it is locked in;
   * anything else (playing a card with a fixed target, moving, selling, freezing) can be undone.
   */
  private trackUndo() {
    const g = this.g;
    if (!g || g.phase !== 'shop' || this.screen !== 'shop') { this.undoStack = []; this.undoAt = null; return; }
    const json = JSON.stringify(g);
    const prev = this.undoAt;
    if (!prev || prev.round !== g.round || prev.rng !== g.rng) this.undoStack = [];
    else if (prev.json !== json) { this.undoStack.push(prev.json); if (this.undoStack.length > 40) this.undoStack.shift(); }
    this.undoAt = { json, rng: g.rng, round: g.round };
  }

  canUndo() { return this.undoStack.length > 0 && this.screen === 'shop' && !this.busy; }

  undo() {
    if (!this.canUndo()) return;
    const json = this.undoStack.pop()!;
    const g = JSON.parse(json) as GameState;
    this.g = g;
    this.undoAt = { json, rng: g.rng, round: g.round };
    this.sel = null;
    this.targeting = null;
    this.sheet = null;
    this.pendingFx = [];
    save(g);
    sfx.click();
    this.render();
  }

  /** effect events still to show: carried over from end of turn (after battle) plus anything new */
  private pendingFx: FxEvent[] = [];
  /** effect playback waits for this (the Recruit transition) */
  private fxGate: Promise<void> = Promise.resolve();
  private fxSkip = new Set<number>();
  private fxHurry = false;
  private takeFx(): FxEvent[] {
    const out = [...this.pendingFx, ...(this.me.fx?.splice(0) ?? [])];
    this.pendingFx = [];
    return out;
  }

  /** stage-coordinate centre of an element positioned on the stage */
  private centre(el: HTMLElement) {
    return { x: parseFloat(el.style.left) + el.offsetWidth / 2, y: parseFloat(el.style.top) + el.offsetHeight / 2, h: el.offsetHeight };
  }

  /**
   * Show effects happening, one after another: the card (or your hero) that does it lights up with a
   * label, glowing orbs fly to what it buffs, cards it gives you fly into your hand, gold and counters
   * pop. `stale`: the screen still shows the shop from before the battle (end-of-turn effects), so
   * numbers are updated by hand and new cards fly toward the hand without landing.
   */
  async playFx(events: FxEvent[], stale: boolean) {
    if (!events.length) return;
    this.fxHurry = false;
    const hurry = () => { this.fxHurry = true; };
    this.stage.addEventListener('pointerdown', hurry);
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, this.fxHurry ? ms * 0.2 : ms));
    const card = (uid: number) => this.stage.querySelector(`.card[data-id="${uid}"]:not(.ghost)`) as HTMLElement | null;
    // new cards stay hidden until they arrive
    for (const e of events) for (const uid of [...e.gains, ...e.summons]) { const el = card(uid); if (el) el.style.visibility = 'hidden'; }
    try {
      if (stale) {
        // end of turn: say so, then go through the effects one by one
        const ban = document.createElement('div');
        ban.className = 'eot-banner';
        ban.textContent = 'End of Turn';
        ban.style.left = `${L.cx}px`;
        ban.style.top = `${L.slotTop - 70}px`;
        this.stage.appendChild(ban);
        setTimeout(() => ban.remove(), 1100);
        await wait(650);
      }
      for (const e of events) {
        const heroEl = e.hero ? (this.stage.querySelector('.my-hero') as HTMLElement | null) : null;
        const srcEl = heroEl ?? (e.src !== undefined ? card(e.src) : null);
        const src = srcEl ? this.centre(srcEl) : { x: L.cx, y: L.slotTop - 30, h: 0 };
        const counter = e.counters.find((c) => (e.hero ? c.key === 'hero' : c.key === `u${e.src}`)) ?? e.counters.find((c) => c.key === 'quest');
        // 1. the source lights up and says what it's doing
        srcEl?.classList.remove('fx-src');
        void srcEl?.offsetWidth;
        srcEl?.classList.add('fx-src');
        const lab = document.createElement('div');
        lab.className = 'fx-label';
        const short = (t: string) => { const one = t.split(' · ').find((x) => x.startsWith(e.name)) ?? t.split(' · ').pop() ?? t; return one.startsWith(e.name) ? one.slice(e.name.length).trim() : one; };
        lab.innerHTML = `<b>${esc(e.name)}</b>${counter ? `<span class="fx-count">${esc(short(counter.text))}</span>` : `<span>${esc(e.label)}</span>`}`;
        lab.style.left = `${src.x}px`;
        lab.style.top = `${src.y - src.h / 2 - 8}px`;
        this.stage.appendChild(lab);
        for (const c of e.counters) this.popCounter(c.key, c.text, stale, !e.hero);
        sfx.click();
        await wait(300);
        // 2. orbs fly to each target; buffs, new units and new cards land
        let longest = 0;
        const targets: { uid: number; kind: 'buff' | 'gain' | 'summon'; b?: FxEvent['buffs'][number] }[] = [
          ...e.buffs.map((b) => ({ uid: b.uid, kind: 'buff' as const, b })), ...e.summons.map((uid) => ({ uid, kind: 'summon' as const })), ...e.gains.map((uid) => ({ uid, kind: 'gain' as const })),
        ];
        targets.forEach((t, i) => {
          const el = card(t.uid);
          const dur = this.fxHurry ? 120 : t.kind === 'gain' ? 520 : 340;
          const delay = (this.fxHurry ? 20 : 70) * i;
          longest = Math.max(longest, dur + delay);
          if (t.kind === 'gain') { this.flyCard(t.uid, src, el, dur, delay, stale); return; }
          if (!el) return;
          const to = this.centre(el);
          this.orb(src, to, dur, delay);
          setTimeout(() => {
            if (t.kind === 'summon') {
              el.style.visibility = '';
              el.classList.add('summon-in');
              puff(this.stage, to.x, to.y, 650);
              sfx.puff();
              return;
            }
            const b = t.b!;
            el.classList.remove('buff-flash');
            void el.offsetWidth;
            el.classList.add('buff-flash');
            const parts = [b.atk || b.hp ? `${b.atk >= 0 ? '+' : ''}${b.atk}/${b.hp >= 0 ? '+' : ''}${b.hp}` : '', ...b.kw.map((k) => KW_ICON[k as keyof typeof KW_ICON]?.[1] ?? k)].filter(Boolean);
            this.floatText(to.x, to.y - to.h / 2 + 30, parts.join(' '), b.atk < 0 || b.hp < 0 ? 'down' : 'buff');
            if (stale) {
              const a = el.querySelector('.stat.atk'); const h = el.querySelector('.stat.hp');
              if (a) a.textContent = String(Number(a.textContent) + b.atk);
              if (h) h.textContent = String(Number(h.textContent) + b.hp);
            }
            sfx.zap();
          }, dur + delay);
        });
        if (e.gold || e.goldNext) {
          const g = this.stage.querySelector('.gold-display') as HTMLElement | null;
          const at = g ? { x: parseFloat((g.parentElement as HTMLElement).style.left) + 60, y: parseFloat((g.parentElement as HTMLElement).style.top) } : { x: L.cx, y: L.heroY };
          if (e.gold) this.floatText(at.x, at.y, `${e.gold > 0 ? '+' : ''}${e.gold} gold`, 'gold');
          if (e.goldNext) this.floatText(at.x, at.y + 34, `+${e.goldNext} gold next turn`, 'gold');
          g?.classList.remove('count-pop'); void g?.offsetWidth; g?.classList.add('count-pop');
          sfx.buy();
        }
        await wait(Math.max(longest, 150) + (stale ? 520 : 280));
        srcEl?.classList.remove('fx-src');
        // each effect finishes before the next starts
        lab.classList.add('out');
        setTimeout(() => lab.remove(), 250);
        await wait(stale ? 140 : 60);
      }
    } finally {
      this.stage.removeEventListener('pointerdown', hurry);
      for (const e of events) for (const uid of [...e.gains, ...e.summons]) { const el = card(uid); if (el) el.style.visibility = ''; }
    }
  }

  private orb(from: { x: number; y: number }, to: { x: number; y: number }, dur: number, delay: number) {
    const o = document.createElement('div');
    o.className = 'fx-orb';
    o.style.left = `${from.x}px`;
    o.style.top = `${from.y}px`;
    this.stage.appendChild(o);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 60 };
    o.animate([
      { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${mid.x - from.x}px), calc(-50% + ${mid.y - from.y}px)) scale(1.1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.8)`, opacity: 1 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.4, 0, .4, 1)', fill: 'both' }).finished.then(() => o.remove()).catch(() => o.remove());
  }

  /** a gained card flies from the source into your hand */
  private flyCard(uid: number, from: { x: number; y: number }, el: HTMLElement | null, dur: number, delay: number, stale: boolean) {
    const u = this.me.hand.find((x) => x.uid === uid);
    if (!u) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHtml(unitView(this.me, u, 'hand', 0), { zone: 'fx', idx: 0, x: 0, y: 0, small: !(L.handCardW > L.cardW), large: L.handCardW > L.cardW });
    const fly = tmp.firstElementChild as HTMLElement;
    fly.classList.add('fx-gain-fly');
    this.stage.appendChild(fly);
    const w = fly.offsetWidth;
    const h = fly.offsetHeight;
    const to = el ? this.centre(el) : { x: L.cx, y: L.handY + h / 2, h };
    fly.style.left = `${to.x - w / 2}px`;
    fly.style.top = `${to.y - h / 2}px`;
    fly.animate([
      { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(0.25) rotate(-12deg)`, opacity: 0 },
      { transform: `translate(${(from.x - to.x) * 0.4}px, ${(from.y - to.y) * 0.4 - 80}px) scale(1.15) rotate(4deg)`, opacity: 1, offset: 0.55 },
      { transform: 'none', opacity: stale ? 0 : 1 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.3, .7, .3, 1)', fill: 'both' }).finished.then(() => {
      fly.remove();
      if (el) {
        el.style.visibility = '';
        el.classList.remove('buff-flash'); void el.offsetWidth; el.classList.add('buff-flash');
      }
    }).catch(() => fly.remove());
    setTimeout(() => { this.floatText(to.x, to.y - h / 2, '+1 card', 'card'); sfx.deploy(); }, dur + delay - 60);
  }

  private floatText(x: number, y: number, text: string, kind: 'buff' | 'down' | 'gold' | 'card') {
    if (!text) return;
    const f = document.createElement('div');
    f.className = `float-num fx-float ${kind}`;
    f.textContent = text;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    this.stage.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }

  /** a counter ticked up: pop it (and make your hero glow for hero counters) */
  private popCounter(key: string, text: string, stale: boolean, label = false) {
    const els: HTMLElement[] = [];
    if (key === 'hero') {
      const hero = this.stage.querySelector('.my-hero') as HTMLElement | null;
      if (hero) {
        hero.classList.remove('fx-glow'); void hero.offsetWidth; hero.classList.add('fx-glow');
        if (label) {
          // something else moved your hero's counter: say so over the hero too
          const c = this.centre(hero);
          const lab = document.createElement('div');
          lab.className = 'fx-label';
          lab.innerHTML = `<span class="fx-count">${esc(text)}</span>`;
          lab.style.left = `${c.x}px`;
          lab.style.top = `${c.y - c.h / 2 - 8}px`;
          this.stage.appendChild(lab);
          setTimeout(() => lab.remove(), this.fxHurry ? 400 : 1500);
        }
      }
      this.stage.querySelectorAll<HTMLElement>('.hero-count, .power-pill').forEach((e) => els.push(e));
      if (stale) {
        const short = text.split(' · ')[0].replace(/^.*? (?=\S+$)/, '');
        this.stage.querySelectorAll<HTMLElement>('.hero-count').forEach((e) => { e.textContent = short === 'Active' ? '★ Active' : short; e.classList.toggle('on', short === 'Active'); });
      }
    } else if (key === 'quest') {
      this.stage.querySelectorAll<HTMLElement>('.quest-chip').forEach((e) => els.push(e));
    } else {
      const c = this.stage.querySelector(`.card[data-id="${key.slice(1)}"] .counter`) as HTMLElement | null;
      if (c) { if (stale) c.textContent = text; els.push(c); }
    }
    for (const e of els) { e.classList.remove('count-pop'); void e.offsetWidth; e.classList.add('count-pop'); }
  }

  /** Play the triple ceremony for each triple, one after another. */
  async celebrate(events: { cardId: string; uids: number[]; goldenUid: number }[], where: Map<number, { x: number; y: number }>) {
    this.busy = true;
    save(this.g!);
    for (const e of events) {
      const fallback = this.lastShopPos ?? { x: L.cx - L.cardW / 2, y: L.shopY };
      const sources = e.uids.map((uid, i) => where.get(uid) ?? { x: fallback.x + (i - 1) * 30, y: fallback.y });
      const golden = this.me.hand.find((u) => u.uid === e.goldenUid);
      const view = golden ? unitView(this.me, golden, 'hand', 0) : { cardId: e.cardId, golden: true, atk: def(e.cardId).atk * 2, hp: def(e.cardId).hp * 2, kw: [...def(e.cardId).keywords] };
      const handEl = this.stage.querySelector(`.card[data-id="${e.goldenUid}"]`) as HTMLElement | null;
      await playTriple(this.stage, L, e.cardId, sources, view, handEl, this.me.tier);
    }
    this.busy = false;
  }

  /** achievements waiting to be shown; popups appear one at a time so they never pile up over the screen */
  private achQueue: AchievementDef[] = [];
  private achShowing = false;

  achievementToast(a: AchievementDef) {
    this.achQueue.push(a);
    if (!this.achShowing) this.nextAchievementToast();
  }

  private nextAchievementToast() {
    const a = this.achQueue.shift();
    if (!a) { this.achShowing = false; return; }
    this.achShowing = true;
    sfx.achievement();
    const holder = document.getElementById('ach-toasts') ?? (() => {
      const d = document.createElement('div');
      d.id = 'ach-toasts';
      document.body.appendChild(d);
      return d;
    })();
    // keep the popup inside the game canvas: under the mute button on PC, over the top strip on phones
    const r = this.stage.getBoundingClientRect();
    const scale = r.width / L.W;
    holder.style.right = `${Math.max(8, window.innerWidth - r.right + 12 * scale)}px`;
    holder.style.top = `${r.top + (L.portrait ? 12 : L.mute.y + L.mute.size + 70) * scale}px`;
    holder.style.maxWidth = `${Math.max(200, r.width - (L.portrait ? 120 : 24) * scale)}px`;
    const t = document.createElement('div');
    t.className = 'ach-toast';
    t.innerHTML = `<div class="ach-icon">🏆</div><div><div class="at-label">Achievement unlocked${this.achQueue.length ? ` · ${this.achQueue.length} more` : ''}</div><div class="at-name">${esc(a.name)}</div><div class="at-desc">${esc(a.desc)}</div></div>`;
    t.addEventListener('click', () => t.classList.add('out'));
    holder.appendChild(t);
    const life = this.achQueue.length ? 2200 : 3400;
    setTimeout(() => t.classList.add('out'), life);
    setTimeout(() => { t.remove(); this.nextAchievementToast(); }, life + 500);
  }

  result(r: { ok: boolean; reason?: string }, sound?: () => void, stat?: string) {
    if (r.ok) sound?.();
    if (r.ok && stat) bump(stat);
    if (!r.ok && r.reason) this.toast(r.reason);
  }

  newGame() {
    this.seen = null;
    this.lastRating = null;
    this.g = newGame((Math.random() * 2 ** 31) | 0, 'You', undefined, { rating: getRating().rating });
    this.sel = null;
    this.targeting = null;
    this.seenBoards.clear();
    newGameStarted();
    this.screen = 'tribes';
    this.commit();
    // sounds timed with the announcement animation
    const inN = this.g.tribes.length;
    for (let i = 0; i < inN; i++) setTimeout(() => this.screen === 'tribes' && sfx.reveal(), 260 + i * 220);
    for (let i = 0; i < 7 - inN; i++) setTimeout(() => this.screen === 'tribes' && sfx.ban(), 1300 + i * 260);
  }

  /** Pick up a game handed over by a live page update (Claude artifact). */
  resume(g: GameState) {
    this.g = g;
    this.undoStack = [];
    this.undoAt = null;
    for (const pl of g.players) pl.fx = [];
    this.screen = g.phase === 'hero' ? 'hero' : g.phase === 'over' ? 'over' : 'shop';
    this.render();
  }

  continueGame() {
    const g = loadSave();
    if (!g) return this.newGame();
    this.g = g;
    this.screen = g.phase === 'hero' ? 'hero' : g.phase === 'over' ? 'over' : 'shop';
    this.render();
  }

  doPlay(handIdx: number, pos: number) {
    const p = this.me;
    const u = p.hand[handIdx];
    if (!u) return;
    if (p.board.length >= CONFIG.boardSize) return this.toast('Your army is full');
    if (needsTarget(u.cardId) && validTargets(p, u.cardId).length) {
      this.targeting = { kind: 'play', handIdx, pos };
      this.aimPt = null;
      this.sel = null;
      this.render();
      return;
    }
    this.result(play(this.g!, p, handIdx, pos), sfx.deploy, 'played');
    this.sel = null;
    this.commit();
  }

  endTurn() {
    const p = this.me;
    if (p.discovers.length) return this.toast('Choose a card first');
    if (p.trinketOffer) return this.render();
    this.sel = null;
    this.targeting = null;
    const g = this.g!;
    const round = g.round;
    const results = endTurn(g);
    save(g);
    // end-of-turn effects play on the shop before the battle; the rest wait until you're back
    const all = p.fx?.splice(0) ?? [];
    const endFx = all.filter((e) => e.phase === 'end');
    this.pendingFx.push(...all.filter((e) => e.phase !== 'end'));
    if (endFx.length) {
      this.busy = true;
      void this.playFx(endFx, true).then(() => { this.busy = false; this.afterEndTurn(results, round); });
      return;
    }
    this.afterEndTurn(results, round);
  }

  private afterEndTurn(results: CombatResult[], round: number) {
    const g = this.g!;
    const p = this.me;
    const mine = results.find((r) => r.a === 0 || r.b === 0);
    if (!mine) {
      this.screen = g.phase === 'over' ? 'over' : 'shop';
      if (g.phase === 'over') this.gameEnded(g);
      return this.commit();
    }
    const meSide = mine.a === 0 ? 0 : 1;
    const oppId = meSide === 0 ? (mine.b === -1 ? mine.ghostOf! : mine.b) : mine.a;
    if (mine.frames[0]) this.seenBoards.set(oppId, mine.frames[0].sides[1 - meSide]);
    const opp = g.players[oppId];
    // health shown on the intro is from before this battle's damage
    const before = (pl: Player) => pl.health + (mine.winner !== -1 && (mine.winner === 0 ? mine.b : mine.a) === pl.id ? mine.damage : 0);
    this.busy = true;
    // the shop fades out, then the battle intro plays over it
    void fadeOut(this.stage).then(() => battleIntro(this.stage, { hero: p.hero, name: p.name, health: before(p) }, { hero: opp.hero, name: opp.name, health: before(opp), sub: `${heroDef(opp.hero)?.name ?? ''}${opp.persona ? ` · ${seatRating(g, opp.id)}` : ''}` }, round, mine.b === -1, () => {
      this.screen = 'combat';
      this.shownScreen = 'combat';
      fadeClear(this.stage);
      this.startCombat(mine, meSide, round);
    })).then(() => {
      this.busy = false;
      this.combat?.play();
    });
  }

  private startCombat(mine: CombatResult, meSide: 0 | 1, round: number) {
    const g = this.g!;
    this.combat = new CombatPlayer(this.stage, g, mine, meSide, round, () => {
      this.combat = null;
      const toShop = () => {
        this.screen = g.phase === 'over' ? 'over' : 'shop';
        const last = mine.frames[mine.frames.length - 1];
        recordCombat(g, {
          won: mine.winner === meSide, lost: mine.winner === 1 - meSide, tie: mine.winner === -1, damage: mine.damage,
          myUnits: mine.frames[0]?.sides[meSide].length ?? 0, oppUnits: mine.frames[0]?.sides[1 - meSide].length ?? 0,
          survivors: last?.sides[meSide].length ?? 0, ghost: mine.b === -1,
        });
        if (g.phase === 'over') this.gameEnded(g);
        this.commit();
      };
      if (g.phase === 'over') void fadeOut(this.stage).then(toShop); // fades back in on the results screen
      else {
        this.busy = true;
        let open!: () => void;
        this.fxGate = new Promise<void>((r) => { open = r; });
        // the battle fades out, then the Recruit sweep brings in the shop
        void fadeOut(this.stage).then(() => recruitWipe(this.stage, g.round, () => { this.noFade = true; fadeClear(this.stage); toShop(); })).then(() => { this.busy = false; open(); this.fxGate = Promise.resolve(); });
      }
    });
  }

  // ---------------- input ----------------
  onClick(e: MouseEvent) {
    if (this.busy) return;
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el) {
      // clicking anywhere else closes the enlarged card
      const t = e.target as HTMLElement;
      if (this.sel && !t.closest('#popover, .card, .sheet')) { this.sel = null; this.render(); }
      return;
    }
    const act = el.dataset.act!;
    if ((el as HTMLButtonElement).disabled) return;
    const g = this.g;
    const p = g ? this.me : null;
    switch (act) {
      case 'new': clearSave(); this.newGame(); break;
      case 'continue': this.continueGame(); break;
      case 'rules': this.screen = 'rules'; this.render(); break;
      case 'title': this.screen = 'title'; this.render(); break;
      case 'menu': this.options = false; this.screen = 'title'; this.render(); break;
      case 'options': this.options = true; this.render(); break;
      case 'close-options': this.options = false; this.render(); break;
      case 'account': this.account = { msg: '' }; this.render(); (this.stage.querySelector('#acc-email') as HTMLInputElement | null)?.focus(); break;
      case 'acc-close': this.account = null; this.render(); break;
      case 'acc-signin': void this.accountAction('signin'); break;
      case 'acc-create': void this.accountAction('create'); break;
      case 'acc-forgot': void this.accountAction('forgot'); break;
      case 'sync-now': void syncNow(); break;
      case 'sign-out': void sync.signOut().then(() => { this.toast('Signed out. Your progress stays on this device.'); this.render(); }); break;
      case 'layout': setMode(el.dataset.mode as LayoutMode); break;
      case 'sound': setMuted(el.dataset.mode === 'off'); this.render(); break;
      case 'debug': setDebug(el.dataset.mode === 'on'); this.render(); break;
      case 'art-style': setArtStyle(el.dataset.mode as ArtStyle); this.render(); break;
      case 'ui-style': store.set('torrekin-ui2', el.dataset.mode!); this.render(); break;
      case 'speed': store.set('torrekin-speed', el.dataset.v!); this.render(); break;
      case 'tribes': this.showTribes = !this.showTribes; this.render(); break;
      case 'to-hero': sfx.click(); this.screen = 'hero'; this.render(); break;
      case 'cards': this.options = false; this.viewer = { fromGame: this.screen === 'shop' && !!this.g, onlyMatch: this.screen === 'shop', tribe: '', tier: 0, ability: '', golden: false, q: '' }; this.render(); break;
      case 'cv-close': this.viewer = null; this.render(); break;
      case 'cv-tribe': if (this.viewer) { this.viewer.tribe = el.dataset.v!; this.render(); } break;
      case 'cv-tier': if (this.viewer) { this.viewer.tier = Number(el.dataset.v); this.render(); } break;
      case 'cv-ab': if (this.viewer) { this.viewer.ability = el.dataset.v!; this.render(); } break;
      case 'cv-golden': if (this.viewer) { this.viewer.golden = (el as HTMLInputElement).checked; this.render(); } break;
      case 'cv-match': if (this.viewer) { this.viewer.onlyMatch = (el as HTMLInputElement).checked; this.render(); } break;
      case 'achievements': this.options = false; this.achOpen = true; this.render(); break;
      case 'ach-close': this.achOpen = false; this.render(); break;
      case 'check-update': e.preventDefault(); checkForUpdates(true); break;
      case 'hero-pick': selectHero(g!, el.dataset.id!); this.screen = 'shop'; this.commit(); break;
      case 'undo': this.undo(); break;
      case 'upgrade': this.result(upgrade(g!, p!), sfx.upgrade, 'upgrades'); this.commit(); break;
      case 'reroll': this.result(reroll(g!, p!), sfx.refresh, 'rerolls'); this.sel = null; this.commit(); break;
      case 'freeze': toggleFreeze(p!); sfx.click(); if (p!.frozen) bump('freezes'); this.commit(); if (p!.frozen) this.freezeFx(); break;
      case 'end-turn': sfx.click(); this.endTurn(); break;
      // the Buy / Play / Sell buttons ignore taps in the first moments after a card is selected,
      // so the tap that opened the card (or a quick double-tap) can't land on them by accident
      case 'buy': if (this.sel && !this.justSelected()) { this.lastShopPos = { x: shopX(this.sel.idx, p!.shop.length), y: L.shopY }; this.result(buy(g!, p!, this.sel.idx), sfx.buy, 'bought'); this.sel = null; this.commit(); } break;
      case 'play': if (this.sel && !this.justSelected()) this.doPlay(this.sel.idx, p!.board.length); break;
      case 'sell': if (this.sel && !this.justSelected()) { this.result(sell(g!, p!, this.sel.idx), sfx.sell, 'sold'); this.sel = null; this.commit(); } break;
      case 'left': case 'right': if (this.sel) {
        const to = this.sel.idx + (act === 'left' ? -1 : 1);
        const r = move(p!, this.sel.idx, to);
        if (r.ok) this.sel = { zone: 'board', idx: to };
        this.result(r);
        this.commit();
      } break;
      case 'discover': chooseDiscover(g!, p!, Number(el.dataset.idx)); sfx.buy(); bump('discovers'); noteGame('discover'); this.commit(); break;
      case 'trinket': if (!pickTrinket(g!, p!, el.dataset.id!)) this.toast('Not enough gold'); else { sfx.upgrade(); bump('trinkets'); } this.commit(); break;
      case 'trinket-skip': pickTrinket(g!, p!, null); this.commit(); break;
      case 'hero-info': this.sel = null; this.sheet = { kind: 'hero' }; sfx.click(); this.render(); break;
      case 'trinket-info': this.sel = null; this.sheet = { kind: 'trinket', id: el.dataset.id! }; sfx.click(); this.render(); break;
      case 'sheet-close': if (e.target === el || el.tagName === 'BUTTON') { this.sheet = null; this.render(); } break;
      case 'hero-power': {
        this.sheet = null;
        const h = el.dataset.id ? heroDef(el.dataset.id) : mainActive(p!);
        if (!h || h.passive) break;
        if (!canUseHeroPower(g!, p!, h.id)) {
          const st = this.powerStatus(h);
          this.toast(p!.usedPowers.includes(h.id) ? 'Already used this turn' : h.locked?.(g!, p!) ?? (p!.gold < powerCost(g!, p!, h) ? 'Not enough gold' : st.note || "Can't use that now"));
          this.render();
          break;
        }
        if (h.targetShop) {
          this.targeting = { kind: 'hero', id: h.id, shop: true };
          this.aimPt = null;
          this.render();
        } else if (h.target) {
          if (!p!.board.length) { this.toast('You need a unit in your army'); break; }
          this.targeting = { kind: 'hero', id: h.id };
          this.aimPt = null;
          this.render();
        } else { if (useHeroPower(g!, p!, undefined, h.id)) { sfx.power(); bump('heroPowers'); noteGame('heroPower'); } this.commit(); }
        break;
      }
      case 'no-target': if (this.targeting?.kind === 'play') {
        const t = this.targeting;
        this.targeting = null;
        this.result(play(g!, p!, t.handIdx, t.pos), sfx.deploy, 'played');
        this.commit();
      } break;
      case 'cancel-target': this.targeting = null; this.render(); break;
      case 'inspect': this.inspect = Number(el.dataset.id); this.render(); break;
      case 'close-inspect': this.inspect = null; this.render(); break;
    }
  }

  onHover(e: MouseEvent) {
    // phones have no hover (a tap would fire it too), so previews there only come from selecting a card
    if (this.screen !== 'shop' || this.dragging || this.sel || L.portrait) { if (L.portrait && this.hover) { this.hover = null; this.updateDetail(); } return; }
    const el = (e.target as HTMLElement).closest('.card[data-zone]') as HTMLElement | null;
    const next = el && ['shop', 'hand', 'board'].includes(el.dataset.zone!) ? { zone: el.dataset.zone as Zone, idx: Number(el.dataset.idx) } : null;
    if (JSON.stringify(next) === JSON.stringify(this.hover)) return;
    this.hover = next;
    this.updateDetail();
  }

  toStage(e: PointerEvent) {
    const r = this.stage.getBoundingClientRect();
    const scale = r.width / L.W;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  onDown(e: PointerEvent) {
    if (this.screen !== 'shop' || e.button > 0 || this.busy || this.viewer || this.achOpen || this.options) return;
    const el = (e.target as HTMLElement).closest('.card[data-zone]') as HTMLElement | null;
    if (!el) return;
    const zone = el.dataset.zone as Zone;
    if (!['shop', 'hand', 'board'].includes(zone)) return;
    const { x, y } = this.toStage(e);
    this.press = { zone, idx: Number(el.dataset.idx), x, y, el, pointerId: e.pointerId };
  }

  onMove(e: PointerEvent) {
    if (this.targeting && this.screen === 'shop') this.drawArrow(this.toStage(e));
    if (!this.press || e.pointerId !== this.press.pointerId) return;
    const pt = this.toStage(e);
    if (!this.dragging) {
      if (Math.hypot(pt.x - this.press.x, pt.y - this.press.y) < 10) return;
      if (this.targeting || this.me.discovers.length || this.me.trinketOffer) return;
      if (this.press.zone === 'board' && this.me.board[this.press.idx]?.mem.locked) return;
      this.dragging = true;
      // the enlarged card would cover the army while you drag
      this.hover = null;
      this.updateDetail();
      this.ghost = this.press.el.cloneNode(true) as HTMLElement;
      this.ghost.classList.add('ghost');
      this.ghost.classList.remove('selected');
      this.stage.appendChild(this.ghost);
      this.press.el.classList.add('dragging');
      // keep getting this pointer's events even if it leaves the game's frame (itch.io shows the game in a frame)
      try { this.stage.setPointerCapture(this.press.pointerId); } catch { /* not supported */ }
    }
    this.lastPt = pt;
    const w = this.press.el.offsetWidth;
    const hgt = this.press.el.offsetHeight;
    this.ghost!.style.left = `${pt.x - w / 2}px`;
    this.ghost!.style.top = `${pt.y - hgt / 2}px`;
    this.updateMarker(pt);
  }

  /** The board slot under x (0-6). */
  slotAt(x: number) {
    const step = L.slotX(1) - L.slotX(0);
    return Math.max(0, Math.min(CONFIG.boardSize - 1, Math.floor((x - L.slotX(0) + (step - L.slotW) / 2) / step)));
  }

  /**
   * Where a dragged unit would land. Units always fill slots from the left, so dropping on an empty slot
   * lands in the first empty one; dropping on a unit puts the new one there and slides the rest right.
   * Returns the index it would take, or -1 if it can't go anywhere.
   */
  dropIndex(x: number): number {
    const p = this.me;
    const k = this.slotAt(x);
    if (this.press!.zone === 'board') return Math.min(k, p.board.length - 1);
    if (p.board.length >= CONFIG.boardSize) return -1;
    return Math.min(k, p.board.length);
  }

  /** While dragging over the army: light up the slot it will take and slide the other units to show the result. */
  updateMarker(pt: { x: number; y: number }) {
    const zone = this.press!.zone;
    const over = pt.y > L.boardTop && pt.y < L.boardBottom && (zone === 'hand' || zone === 'board');
    const target = over ? this.dropIndex(pt.x) : -1;
    // the units' new order (as board indexes) if dropped here
    const n = this.me.board.length;
    const order = Array.from({ length: n }, (_, i) => i);
    if (target >= 0) {
      if (zone === 'board') { order.splice(this.press!.idx, 1); order.splice(target, 0, this.press!.idx); }
      else order.splice(target, 0, -1);
    }
    for (const el of this.stage.querySelectorAll<HTMLElement>('.card[data-zone="board"]:not(.ghost)')) {
      const i = Number(el.dataset.idx);
      const to = order.indexOf(i); // (the faded original of a dragged unit shows where it will land)
      el.classList.toggle('sliding', target >= 0 && to !== i);
      el.style.transform = target >= 0 && to !== i ? `translateX(${L.slotX(to) - L.slotX(i)}px)` : '';
    }
    this.stage.querySelectorAll('.slot-plate.drop-target').forEach((e) => e.classList.remove('drop-target'));
    if (target >= 0) this.stage.querySelector(`.slot-plate[data-slot="${target}"]`)?.classList.add('drop-target');
    this.stage.classList.toggle('board-full-drag', over && target < 0);
  }

  cancelDrag() {
    this.ghost?.remove();
    this.ghost = null;
    for (const el of this.stage.querySelectorAll<HTMLElement>('.card[data-zone="board"]:not(.ghost)')) { el.style.transform = ''; el.classList.remove('sliding'); }
    this.stage.querySelectorAll('.slot-plate.drop-target').forEach((e) => e.classList.remove('drop-target'));
    this.stage.classList.remove('board-full-drag');
    this.press?.el.classList.remove('dragging');
    this.press = null;
    this.dragging = false;
  }

  /** shown on screen (and in the console) so a player can tell us what went wrong */
  private lastError = 0;
  reportError(err: unknown) {
    console.error('[torrekin]', err);
    if (Date.now() - this.lastError < 3000) return;
    this.lastError = Date.now();
    const msg = err instanceof Error ? err.message : String(err ?? 'unknown');
    this.toast(`Something went wrong: ${msg.slice(0, 120)}`);
  }

  private lastPt: { x: number; y: number } | null = null;

  /** finish a drag at a stage point (as if released there) */
  drop(pt: { x: number; y: number }) {
    const press = this.press!;
    this.finish(press, pt, true);
  }

  onUp(e: PointerEvent) {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    this.finish(press, this.toStage(e), this.dragging);
  }

  private finish(press: Press, pt: { x: number; y: number }, wasDrag: boolean) {
    this.lastPt = null;
    this.cancelDrag();
    const g = this.g!;
    const p = this.me;
    if (!wasDrag) {
      // a tap: targeting or selection
      // a Hero Power aimed at the Tavern (Doom Bauble)
      if (this.targeting?.kind === 'hero' && this.targeting.shop) {
        if (press.zone !== 'shop') return;
        const t = this.targeting;
        this.targeting = null;
        if (useHeroPower(g, p, p.shop[press.idx], t.id)) { sfx.power(); bump('heroPowers'); noteGame('heroPower'); }
        this.commit();
        return;
      }
      if (this.targeting && press.zone === 'board') {
        const u = p.board[press.idx];
        const t = this.targeting;
        if (t.kind === 'play') {
          if (!validTargets(p, p.hand[t.handIdx].cardId).includes(u)) return;
          this.targeting = null;
          this.result(play(g, p, t.handIdx, t.pos, u.uid), sfx.deploy, 'played');
        } else {
          this.targeting = null;
          if (useHeroPower(g, p, u, t.id)) { sfx.power(); bump('heroPowers'); noteGame('heroPower'); }
        }
        this.commit();
        return;
      }
      if (this.targeting) return;
      const same = this.sel && this.sel.zone === press.zone && this.sel.idx === press.idx;
      this.sel = same ? null : { zone: press.zone, idx: press.idx };
      this.selAt = performance.now();
      this.render();
      return;
    }
    // a drag
    if (press.zone === 'shop') {
      if (pt.y > L.shopDrop) { this.lastShopPos = { x: shopX(press.idx, p.shop.length), y: L.shopY }; this.result(buy(g, p, press.idx), sfx.buy, 'bought'); }
      else if (Math.hypot(pt.x - press.x, pt.y - press.y) > 80) this.toast('Drag it down onto your army to buy it (or tap it, then Buy)');
    } else if (press.zone === 'hand') {
      if (pt.y > L.boardTop && pt.y < L.boardBottom) {
        this.press = press; // dropIndex reads the zone being dragged
        const to = this.dropIndex(pt.x);
        this.press = null;
        this.doPlay(press.idx, to < 0 ? p.board.length : to);
        return;
      }
    } else if (press.zone === 'board') {
      if (pt.y < L.shopDrop) this.result(sell(g, p, press.idx), sfx.sell, 'sold');
      else if (pt.y < L.boardBottom) {
        this.press = press;
        const to = this.dropIndex(pt.x);
        this.press = null;
        this.result(move(p, press.idx, to), sfx.click);
      }
    }
    this.sel = null;
    this.commit();
  }
}
