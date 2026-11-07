import { CONFIG, def, TRIBE_NAMES } from '../engine/core';
import {
  buy, chooseDiscover, endTurn, move, needsTarget, newGame, play, reroll, selectHero, sell, sellValue, toggleFreeze, upgrade, validTargets,
} from '../engine/game';
import { HEROES, buyCost, canUseHeroPower, heroDef, mainActive, pickTrinket, powerCost, powersOf, trinketDef, useHeroPower, type HeroDef } from '../engine/heroes';
import type { CombatResult, GameState, Player } from '../engine/types';
import { CombatPlayer } from './combatView';
import { art, bigCardHtml, cardHtml, esc, heroArt, unitView, KEYWORD_HELP } from './view';
import { clearSave, loadSave, save } from './save';
import { APP_VERSION, checkForUpdates } from './update';
import { isMuted, setMuted, sfx } from './sfx';
import { achievementsHtml, cardGridHtml, cardViewerHtml, filteredCards, tribesAnnounceHtml, type ViewerState } from './screens';
import { playTriple } from './ceremony';
import { placeBoardBg, placeHud } from './hud';
import { puff } from './fx';
import { battleIntro, recruitWipe } from './transitions';
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
interface HeroTargeting { kind: 'hero'; id: string }

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
    stage.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => this.cancelDrag());
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
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.sheet = null; this.targeting = null; this.sel = null; this.viewer = null; this.achOpen = false; this.render(); }
    });
    this.render();
  }

  get me(): Player { return this.g!.players[0]; }

  // ---------------- rendering ----------------
  render() {
    L = currentLayout();
    this.stage.classList.toggle('portrait', L.portrait);
    this.stage.classList.toggle('tall', !!L.tall);
    this.stage.classList.toggle('menu-bg', this.screen === 'title' || this.screen === 'rules' || this.screen === 'hero' || this.screen === 'tribes');
    this.stage.style.backgroundImage = `url('${art(this.stage.classList.contains('menu-bg') ? 'art/menu.svg' : 'art/board.svg')}')`;
    placeBoardBg(this.stage, L, null);
    if (this.screen === 'combat') return; // combat view owns the stage
    let html = '';
    if (this.screen === 'title') html = this.titleHtml();
    else if (this.screen === 'rules') html = this.rulesHtml();
    else if (this.screen === 'hero') html = this.heroSelectHtml();
    else if (this.screen === 'tribes') html = tribesAnnounceHtml(this.g!);
    else if (this.screen === 'shop') html = this.shopHtml();
    else if (this.screen === 'over') html = this.shopHtml() + this.overHtml();
    if (this.options) html += this.optionsHtml();
    if (this.viewer) html += cardViewerHtml(this.viewer, this.g);
    if (this.achOpen) html += achievementsHtml();
    const before = this.cardCentres();
    this.stage.innerHTML = html;
    placeHud(this.stage, L);
    this.slideCards(before);
    if (this.screen === 'shop') this.shopFeedback();
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
      if (!el) continue;
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
      <h1 class="logo">TORREKIN</h1>
      <div class="subtitle">An Autobattler</div>
      ${this.ratingBadge()}
      <div class="menu">
        ${canContinue ? `<button class="btn big primary" data-act="continue">Continue (Round ${saved!.round})</button>` : ''}
        <button class="btn big ${canContinue ? '' : 'primary'}" data-act="new">New Game</button>
        <button class="btn big" data-act="rules">How to Play</button>
        <button class="btn big" data-act="achievements">Achievements</button>
        <button class="btn big" data-act="options">Options</button>
      </div>
    </div>
    <div class="version">v${APP_VERSION}${__NO_UPDATES__ ? '' : ' · <a href="#" data-act="check-update" style="color:inherit">Check for updates</a>'}</div>`;
  }

  ratingBadge() {
    const r = getRating();
    return `<div class="rating-badge" title="Your rating. The Expert bot is ${EXPERT_ELO}.">
      <span class="rb-label">Rating</span><span class="rb-num">${r.rating}</span>
      <span class="rb-sub">${isProvisional(r) ? `Provisional · ${r.games}/10 games` : `${r.games} games · best ${r.peak}`}</span></div>`;
  }

  rulesHtml() {
    const kws = Object.entries(KEYWORD_HELP).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>');
    return `<div class="title-wrap"><div class="panel rules">
      <h3>The Goal</h3>
      Six players draft armies of units and battle automatically each round. Everyone starts at ${CONFIG.startHealth} Health.
      Lose a battle and you take damage equal to the winner's Tavern Tier plus the tiers of their surviving units, never more than ${CONFIG.damageCap}.
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
          <div class="hero-portrait" style="background-image:url('${heroArt(h.id)}')"></div>
          <div class="hn">${esc(h.name)}</div>
          <div class="pc htitle" style="font-size:14px;margin-top:-8px;text-align:center">${esc(h.title)}</div>
          <div class="pw">${esc(h.power)} ${h.passive ? '<span class="pc">(Passive)</span>' : `<span class="pc">(${h.costFn ? 'starts at 10 gold' : `${h.cost} gold`})</span>`}</div>
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
        const pct = Math.max(0, Math.min(100, (p.health / CONFIG.startHealth) * 100));
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
      const pct = Math.max(0, Math.min(100, (p.health / CONFIG.startHealth) * 100));
      return `<div class="row ${p.human ? 'me' : ''} ${next ? 'next' : ''} ${p.alive ? '' : 'dead'}" data-act="inspect" data-id="${p.id}">
        <div class="avatar" style="background-image:url('${heroArt(p.hero)}')"></div>
        <div class="meta">
          <div class="nm">${esc(p.name)}</div>
          <div class="hero-nm">${esc(h?.name ?? '')}${p.human ? '' : ` · ${seatRating(this.g!, p.id)}`}</div>
          <div class="hpbar"><div style="width:${pct}%"></div></div>
          <div class="nums"><span>❤ ${p.health}</span><span>★ ${p.tier}</span></div>
        </div>
        ${next ? '<div class="tag">NEXT</div>' : ''}
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
      : tgt?.kind === 'hero' ? new Set(p.board.map((u) => u.uid)) : null;
    let h = this.leaderboardHtml();
    h += this.tavernBarHtml();
    // copies you already own (hand + army, not Golden): 1 = shimmer, 2 = the triple is one buy away
    const owned = new Map<string, number>();
    for (const u of [...p.hand, ...p.board]) if (!u.golden) owned.set(u.cardId, (owned.get(u.cardId) ?? 0) + 1);
    p.shop.forEach((u, i) => {
      const sel = this.sel?.zone === 'shop' && this.sel.idx === i ? 'selected' : '';
      const v = unitView(p, u, 'shop', i);
      const have = owned.get(u.cardId) ?? 0;
      const hint = have >= 2 ? 'triple-hint' : have === 1 ? 'pair-hint' : '';
      h += cardHtml(v, { zone: 'shop', idx: i, id: u.uid, x: shopX(i, p.shop.length), y: L.shopY, small: L.small && !L.shopBig, large: L.shopBig, extraClass: `${sel} ${hint} ${p.gold < buyCost(p, u.cardId) ? 'unaffordable' : ''} ${p.frozen ? 'frozen' : ''}`,
        badge: have >= 2 ? '<div class="trip-tag">TRIPLE!</div>' : '' });
    });
    if (!p.shop.length) h += `<div class="hint abs" style="left:${L.cx - 240}px;top:${L.shopY + 70}px;width:480px">The Tavern is empty. Refresh for new units.</div>`;
    // army slots
    for (let i = 0; i < CONFIG.boardSize; i++) {
      const s = p.slots[i];
      const bonus = [s.atk || s.hp ? `${s.atk >= 0 ? '+' : ''}${s.atk}/${s.hp >= 0 ? '+' : ''}${s.hp}` : '', ...s.kw.map((k) => ({ taunt: 'Taunt', divineShield: 'Shield', reborn: 'Reborn', venomous: 'Venom', stealth: 'Stealth', windfury: 'Windfury' })[k])].filter(Boolean).join(' · ');
      const buffed = s.atk || s.hp || s.kw.length;
      h += `<div class="slot-plate ${buffed ? 'buffed' : ''}" data-slot="${i}" style="left:${L.slotX(i)}px;top:${L.slotTop}px;width:${L.slotW}px;height:${L.slotH}px"><div class="bonus ${s.atk < 0 || s.hp < 0 ? 'neg' : ''}">${bonus || `Slot ${i + 1}`}</div></div>`;
    }
    p.board.forEach((u, i) => {
      const sel = this.sel?.zone === 'board' && this.sel.idx === i ? 'selected' : '';
      const tg = targetUids?.has(u.uid) ? 'targetable' : '';
      h += cardHtml(unitView(p, u, 'board', i), { zone: 'board', idx: i, x: boardCardX(i), y: L.boardY, small: L.small, extraClass: `${sel} ${tg}`, id: u.uid });
    });
    h += this.heroAreaHtml();
    // hand: along the bottom edge, cards rise when hovered
    p.hand.forEach((u, i) => {
      const sel = this.sel?.zone === 'hand' && this.sel.idx === i ? 'selected' : '';
      h += cardHtml(unitView(p, u, 'hand', i), { zone: 'hand', idx: i, x: handX(i, p.hand.length), y: L.handY, small: !L.shopBig, large: L.shopBig, extraClass: `in-hand ${sel}`, id: u.uid });
    });
    h += this.rightSideHtml();
    h += `<div id="popover">${this.popoverHtml()}</div>`;
    if (tgt) {
      h += `<div class="abs panel target-bar" style="left:${L.targetBar.x}px;top:${L.targetBar.y}px;width:${L.targetBar.w}px">
        <span>${tgt.kind === 'hero' ? 'Choose a unit for your Hero Power' : `Choose a target for ${esc(def(p.hand[tgt.handIdx]?.cardId ?? 'skel').name)}`}</span>
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
        <div class="tb-icon">⬆</div>${upCost === null ? '' : `<div class="tb-cost">${upCost}</div>`}
        <div class="tb-label">${upCost === null ? 'Max Tier' : 'Upgrade'}</div>
      </div>
      <div class="tavern-keeper" style="left:${t ? L.cx - t.kp / 2 : L.cx - 66}px;top:${L.tavernY}px">
        <div class="tk-portrait" style="background-image:url('${heroArt('tavern')}')"></div>
        <div class="tk-num">${p.tier}</div>
        <div class="tk-tier">${'★'.repeat(p.tier)}</div>
        <div class="tk-label">Tavern · Tier ${p.tier}</div>
      </div>
      <div class="tavern-btn refresh ${p.gold < CONFIG.rerollCost ? 'off' : ''}" data-act="reroll" style="${at(t?.refresh ?? 0, L.cx + 87)}" title="Refresh the Tavern">
        <div class="tb-icon">↻</div><div class="tb-cost">${CONFIG.rerollCost}</div><div class="tb-label">Refresh</div>
      </div>
      <div class="tavern-btn freeze ${p.frozen ? 'on' : ''}" data-act="freeze" style="${at(t?.freeze ?? 0, L.cx + 187)}" title="Freeze the Tavern">
        <div class="tb-icon">❄</div><div class="tb-label">${p.frozen ? 'Frozen' : 'Freeze'}</div>
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

  /** Bottom centre: your hero (it carries your Hero Powers), trinkets beside it. */
  heroAreaHtml() {
    const g = this.g!;
    const p = this.me;
    const powers = powersOf(p);
    const main = mainActive(p);
    const canPower = powers.some((h) => !h.passive && canUseHeroPower(g, p, h.id));
    const state = !powers.length ? '' : !main ? 'passive' : canPower ? 'ready' : 'spent';
    const costBadge = main ? `<div class="tb-cost">${powerCost(g, p, main)}</div>` : '';
    const ph = L.phone;
    if (ph) {
      // phones: tapping the hero opens a sheet with the powers and Use buttons (there is no hover)
      const hs = ph.heroSize;
      let out = `<button class="my-hero ${state}" data-act="hero-info" aria-label="Your hero powers" style="left:${L.cx - hs / 2}px;top:${L.heroY - hs / 2}px;width:${hs}px;height:${hs}px">
        <div class="hero-portrait" style="width:${hs}px;height:${hs}px;background-image:url('${heroArt(p.hero)}')"><div class="hp">${p.health}</div></div>
        ${costBadge}
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
      ${costBadge}
      ${powers.length ? `<div class="tip">${tipRows}${hint ? `<i>${hint}</i>` : ''}</div>` : ''}
    </div>`;
    p.trinkets.forEach((t, i) => {
      const td = trinketDef(t);
      h += `<div class="trinket-orb ${td.greater ? 'greater' : ''}" style="left:${L.cx - 150 - i * 70}px;top:${L.heroY - 30}px">
        <div class="tip"><b>${esc(td.name)}</b><br>${esc(td.text)}</div></div>`;
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
    const max = Math.min(CONFIG.maxGold, 2 + this.g!.round) + p.maxGoldBonus;
    const pips = Array.from({ length: Math.min(max, 12) }, (_, i) => `<span class="pip ${i < p.gold ? 'full' : ''}"></span>`).join('');
    const ph = L.phone;
    return `
      <div class="turn-label" style="${ph ? `left:${ph.turnLabel.x}px;top:${ph.turnLabel.y}px;width:${ph.turnLabel.w}px` : `left:${L.endTurn.x + 6}px;top:${L.endTurn.y - 30}px`}">Turn ${this.g!.round}</div>
      <button class="end-turn" data-act="end-turn" style="left:${L.endTurn.x}px;top:${L.endTurn.y}px${ph ? `;width:${ph.endTurnW}px` : ''}">End Turn</button>
      <div class="gold-bar" style="left:${L.gold.x}px;top:${L.gold.y}px">
        <div class="gold-display"><span class="coin"></span>${p.gold}<span class="gmax">/${max}</span></div>
        <div class="pips">${pips}</div>
        ${p.goldNextTurn ? `<div class="hint" style="padding:0">+${p.goldNextTurn} gold next turn</div>` : ''}
      </div>
      <button class="gear" data-act="options" style="left:${L.gear.x}px;top:${L.gear.y}px;width:${L.gear.size}px;height:${L.gear.size}px;font-size:${Math.round(L.gear.size * 0.5)}px" title="Options">⚙</button>
      ${this.tribesHtml()}
      <button class="btn cards-btn" data-act="cards" style="left:${L.cardsBtn.x}px;top:${L.cardsBtn.y}px${ph ? `;width:${ph.cardsW}px` : ''}">📖 Cards</button>
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
    let speed = 1;
    try { speed = Number(localStorage.getItem('torrekin-speed')) || 1; } catch { /* ignore */ }
    const seg = (act: string, items: [string, string][], cur: string, key = 'mode') => `<div class="seg">${items.map(([v, label]) =>
      `<button class="btn ${cur === v ? 'on' : ''}" data-act="${act}" data-${key}="${v}">${label}</button>`).join('')}</div>`;
    return `<div class="modal" style="z-index:80"><div class="panel options">
      <h2 style="font-size:34px">Options</h2>
      <div class="opt-row"><span>Screen layout</span>${seg('layout', [['auto', 'Auto'], ['landscape', 'Landscape'], ['portrait', 'Portrait']], mode)}</div>
      <div class="hint" style="margin-top:-8px">Auto picks portrait when the window is taller than it is wide.</div>
      <div class="opt-row"><span>Sound</span>${seg('sound', [['on', 'On'], ['off', 'Off']], isMuted() ? 'off' : 'on')}</div>
      <div class="opt-row"><span>Battle speed</span>${seg('speed', [['1', '×1'], ['2', '×2'], ['4', '×4']], String(speed), 'v')}</div>
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

  /** The enlarged card shown next to a hovered or selected card (with actions when selected). */
  popoverHtml() {
    const p = this.me;
    const s = this.sel ?? this.hover;
    if (!s) return '';
    const list = s.zone === 'shop' ? p.shop : s.zone === 'hand' ? p.hand : p.board;
    const u = list[s.idx];
    if (!u) return '';
    const v = unitView(p, u, s.zone, s.idx);
    let actions = '';
    if (this.sel) {
      if (s.zone === 'shop') actions = `<button class="btn primary" data-act="buy" ${p.gold < buyCost(p, u.cardId) ? 'disabled' : ''}>Buy <span class="cost">${buyCost(p, u.cardId)}<span class="coin"></span></span></button>`;
      if (s.zone === 'hand') actions = `<button class="btn primary" data-act="play" ${p.board.length >= CONFIG.boardSize ? 'disabled' : ''}>Play</button>`;
      if (s.zone === 'board') actions = `<button class="btn" data-act="left" ${s.idx === 0 || u.mem.locked ? 'disabled' : ''}>◀</button>
        <button class="btn primary" data-act="sell" ${u.mem.locked ? 'disabled' : ''}>Sell <span class="cost">+${sellValue(u, p)}<span class="coin"></span></span></button>
        <button class="btn" data-act="right" ${s.idx >= p.board.length - 1 || u.mem.locked ? 'disabled' : ''}>▶</button>`;
    }
    // place it beside the card (above it for cards in hand)
    // phones get a much bigger card (zoomed in CSS) and big buttons; numbers here match styles.css
    const W = L.portrait ? 342 : 210;
    const H = L.portrait ? 493 + (actions ? 118 : 0) : 300 + (actions ? 54 : 0);
    let x: number;
    let y: number;
    if (L.popover === 'stack') {
      // portrait: shop cards show it over the army, army cards over the shop, hand cards above the hand
      const cx = s.zone === 'shop' ? shopX(s.idx, p.shop.length) + L.shopCardW / 2
        : s.zone === 'hand' ? handX(s.idx, p.hand.length) + L.handCardW / 2 : L.slotX(s.idx) + L.slotW / 2;
      x = Math.max(8, Math.min(L.W - W - 8, cx - W / 2));
      y = s.zone === 'shop' ? L.shopY + L.shopCardH + 14 : s.zone === 'board' ? L.slotTop - H - 6 : L.handY - H - 12;
      y = Math.max(8, Math.min(L.H - H - 8, y));
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
      y = Math.max(8, Math.min(L.H - 10 - H, y));
    }
    return `<div class="popover ${actions ? 'interactive' : ''}" style="left:${x}px;top:${y}px;width:${W}px">
      <div class="pop-card">${bigCardHtml(v)}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
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
      body = td.text;
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
      return `<div class="choice" data-act="discover" data-idx="${i}">${bigCardHtml({ cardId: id, golden: !!d.golden, atk: dd.atk * m, hp: dd.hp * m, kw: [...dd.keywords] })}</div>`;
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
    return `<div class="modal"><h2>${place === 1 ? 'Victory!' : `You finished ${ordinal(place)}`}</h2>
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
    // remember where the copies were before they disappear from the screen
    const where = new Map<number, { x: number; y: number }>();
    for (const e of events) for (const uid of e.uids) {
      const el = this.stage.querySelector(`.card[data-id="${uid}"]`) as HTMLElement | null;
      if (el) where.set(uid, { x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
    }
    this.render();
    if (events.length) {
      bump('triples', events.length);
      noteGame('triple', this.g);
      void this.celebrate(events, where);
    }
    evaluate(this.g);
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
    this.g = newGame((Math.random() * 2 ** 31) | 0);
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
    void battleIntro(this.stage, { hero: p.hero, name: p.name, health: before(p) }, { hero: opp.hero, name: opp.name, health: before(opp), sub: `${heroDef(opp.hero)?.name ?? ''}${opp.persona ? ` · ${seatRating(g, opp.id)}` : ''}` }, round, mine.b === -1, () => {
      this.screen = 'combat';
      this.startCombat(mine, meSide, round);
    }).then(() => {
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
      if (g.phase === 'over') toShop();
      else {
        this.busy = true;
        void recruitWipe(this.stage, g.round, toShop).then(() => { this.busy = false; });
      }
    });
  }

  // ---------------- input ----------------
  onClick(e: MouseEvent) {
    if (this.busy) return;
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el) return;
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
      case 'layout': setMode(el.dataset.mode as LayoutMode); break;
      case 'sound': setMuted(el.dataset.mode === 'off'); this.render(); break;
      case 'speed': try { localStorage.setItem('torrekin-speed', el.dataset.v!); } catch { /* ignore */ } this.render(); break;
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
      case 'upgrade': this.result(upgrade(g!, p!), sfx.upgrade, 'upgrades'); this.commit(); break;
      case 'reroll': this.result(reroll(g!, p!), sfx.refresh, 'rerolls'); this.sel = null; this.commit(); break;
      case 'freeze': toggleFreeze(p!); sfx.click(); if (p!.frozen) bump('freezes'); this.commit(); break;
      case 'end-turn': sfx.click(); this.endTurn(); break;
      case 'buy': if (this.sel) { this.lastShopPos = { x: shopX(this.sel.idx, p!.shop.length), y: L.shopY }; this.result(buy(g!, p!, this.sel.idx), sfx.buy, 'bought'); this.sel = null; this.commit(); } break;
      case 'play': if (this.sel) this.doPlay(this.sel.idx, p!.board.length); break;
      case 'sell': if (this.sel) { this.result(sell(g!, p!, this.sel.idx), sfx.sell, 'sold'); this.sel = null; this.commit(); } break;
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
        if (h.target) {
          if (!p!.board.length) { this.toast('You need a unit in your army'); break; }
          this.targeting = { kind: 'hero', id: h.id };
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
    }
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
    for (const el of this.stage.querySelectorAll<HTMLElement>('.card[data-zone="board"]')) {
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
    for (const el of this.stage.querySelectorAll<HTMLElement>('.card[data-zone="board"]')) { el.style.transform = ''; el.classList.remove('sliding'); }
    this.stage.querySelectorAll('.slot-plate.drop-target').forEach((e) => e.classList.remove('drop-target'));
    this.stage.classList.remove('board-full-drag');
    this.press?.el.classList.remove('dragging');
    this.press = null;
    this.dragging = false;
  }

  onUp(e: PointerEvent) {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    const pt = this.toStage(e);
    const wasDrag = this.dragging;
    this.cancelDrag();
    const g = this.g!;
    const p = this.me;
    if (!wasDrag) {
      // a tap: targeting or selection
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
      this.render();
      return;
    }
    // a drag
    if (press.zone === 'shop') {
      if (pt.y > L.shopDrop) { this.lastShopPos = { x: shopX(press.idx, p.shop.length), y: L.shopY }; this.result(buy(g, p, press.idx), sfx.buy, 'bought'); }
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
