import { CONFIG, def, TRIBE_NAMES } from '../engine/core';
import {
  buy, chooseDiscover, endTurn, move, needsTarget, newGame, play, reroll, selectHero, sell, sellValue, toggleFreeze, upgrade, validTargets,
} from '../engine/game';
import { HEROES, buyCost, canUseHeroPower, heroDef, pickTrinket, trinketDef, useHeroPower } from '../engine/heroes';
import type { CombatResult, GameState, Player } from '../engine/types';
import { CombatPlayer } from './combatView';
import { art, bigCardHtml, cardHtml, esc, heroArt, unitView, KEYWORD_HELP } from './view';
import { clearSave, loadSave, save } from './save';
import { APP_VERSION, checkForUpdates } from './update';
import { isMuted, setMuted, sfx } from './sfx';
import { currentLayout, getMode, LANDSCAPE, setMode, type Layout, type LayoutMode } from './layout';
import { ALL_TRIBES } from '../engine/core';

declare const __ARTIFACT__: boolean;

type Zone = 'shop' | 'hand' | 'board';
interface Sel { zone: Zone; idx: number }
interface Press { zone: Zone; idx: number; x: number; y: number; el: HTMLElement; pointerId: number }
interface Targeting { kind: 'play'; handIdx: number; pos: number } // play a card that needs a target
interface HeroTargeting { kind: 'hero' }

// ---- layout: see layout.ts (landscape mirrors Battlegrounds on PC; portrait is for phones) ----
let L: Layout = LANDSCAPE;
const boardCardX = (i: number) => L.slotX(i) + (L.slotW - L.cardW) / 2;

function shopX(i: number, n: number) {
  const total = (n - 1) * L.shopStep + L.cardW;
  return L.cx - total / 2 + i * L.shopStep;
}
function handX(i: number, n: number) {
  const step = Math.min(128, Math.floor((L.handWidth - 120) / Math.max(1, n - 1)));
  const total = (n - 1) * step + 120;
  return L.cx - total / 2 + i * step;
}
const ordinal = (n: number) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export class App {
  stage: HTMLElement;
  g: GameState | null = null;
  screen: 'title' | 'rules' | 'hero' | 'shop' | 'combat' | 'over' = 'title';
  sel: Sel | null = null;
  hover: Sel | null = null;
  press: Press | null = null;
  dragging = false;
  ghost: HTMLElement | null = null;
  marker: HTMLElement | null = null;
  targeting: Targeting | HeroTargeting | null = null;
  inspect: number | null = null; // player id shown in rival modal
  options = false; // options window open
  showTribes = false; // tribes tooltip pinned open (tap on phones)
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
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.targeting = null; this.sel = null; this.render(); }
    });
    this.render();
  }

  get me(): Player { return this.g!.players[0]; }

  // ---------------- rendering ----------------
  render() {
    L = currentLayout();
    this.stage.classList.toggle('portrait', L.portrait);
    this.stage.classList.toggle('menu-bg', this.screen === 'title' || this.screen === 'rules' || this.screen === 'hero');
    this.stage.style.backgroundImage = `url('${art(this.stage.classList.contains('menu-bg') ? 'art/menu.svg' : 'art/board.svg')}')`;
    if (this.screen === 'combat') return; // combat view owns the stage
    let html = '';
    if (this.screen === 'title') html = this.titleHtml();
    else if (this.screen === 'rules') html = this.rulesHtml();
    else if (this.screen === 'hero') html = this.heroSelectHtml();
    else if (this.screen === 'shop') html = this.shopHtml();
    else if (this.screen === 'over') html = this.shopHtml() + this.overHtml();
    if (this.options) html += this.optionsHtml();
    this.stage.innerHTML = html;
    if (this.screen === 'shop') this.shopFeedback();
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
        el.style.setProperty('--life', '550ms');
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
      <div class="menu">
        ${canContinue ? `<button class="btn big primary" data-act="continue">Continue (Round ${saved!.round})</button>` : ''}
        <button class="btn big ${canContinue ? '' : 'primary'}" data-act="new">New Game</button>
        <button class="btn big" data-act="rules">How to Play</button>
        <button class="btn big" data-act="options">Options</button>
      </div>
    </div>
    <div class="version">v${APP_VERSION}${__ARTIFACT__ ? '' : ' · <a href="#" data-act="check-update" style="color:inherit">Check for updates</a>'}</div>`;
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
    const tribes = this.g!.tribes.map((t) => TRIBE_NAMES[t]).join(' · ');
    return `<div class="modal" style="background:rgba(255,255,255,.08)">
      <h2>Choose Your Hero</h2>
      <div class="hint" style="font-size:17px">Tribes this game: ${esc(tribes)}</div>
      <div class="choices pairs">${offer.map((id) => {
        const h = heroDef(id)!;
        return `<div class="choice herocard" data-act="hero-pick" data-id="${id}">
          <div class="hero-portrait" style="background-image:url('${heroArt(h.id)}')"></div>
          <div class="hn">${esc(h.name)}</div>
          <div class="pc" style="font-size:14px;margin-top:-8px;text-align:center">${esc(h.title)}</div>
          <div class="pw">${esc(h.power)} ${h.passive ? '<span class="pc">(Passive)</span>' : `<span class="pc">(${h.cost} gold)</span>`}</div>
          <div class="pt">${esc(h.text)}</div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }

  leaderboardHtml() {
    const g = this.g!;
    const order = [...g.players].sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.health - a.health || a.placement - b.placement);
    const rows = order.map((p) => {
      const h = heroDef(p.hero);
      const next = this.me.nextOpponent === p.id;
      const pct = Math.max(0, Math.min(100, (p.health / CONFIG.startHealth) * 100));
      return `<div class="row ${p.human ? 'me' : ''} ${next ? 'next' : ''} ${p.alive ? '' : 'dead'}" data-act="inspect" data-id="${p.id}">
        <div class="avatar" style="background-image:url('${heroArt(p.hero)}')"></div>
        <div class="meta">
          <div class="nm">${esc(p.name)}</div>
          <div class="hero-nm">${esc((p.human ? h?.name : h?.title) ?? '')}</div>
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
    p.shop.forEach((u, i) => {
      const sel = this.sel?.zone === 'shop' && this.sel.idx === i ? 'selected' : '';
      const v = unitView(p, u, 'shop', i);
      h += cardHtml(v, { zone: 'shop', idx: i, x: shopX(i, p.shop.length), y: L.shopY, small: L.small, extraClass: `${sel} ${p.gold < buyCost(p) ? 'unaffordable' : ''} ${p.frozen ? 'frozen' : ''}` });
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
      h += cardHtml(unitView(p, u, 'hand', i), { zone: 'hand', idx: i, x: handX(i, p.hand.length), y: L.handY, small: true, extraClass: `in-hand ${sel}`, id: u.uid });
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
    return `
      <div class="tavern-btn upgrade ${upCost === null || p.gold < upCost ? 'off' : ''}" data-act="upgrade" style="left:${L.cx - 175}px;top:${L.tavernY + 14}px" title="Upgrade the Tavern">
        <div class="tb-icon">⬆</div>${upCost === null ? '' : `<div class="tb-cost">${upCost}</div>`}
        <div class="tb-label">${upCost === null ? 'Max Tier' : 'Upgrade'}</div>
      </div>
      <div class="tavern-keeper" style="left:${L.cx - 66}px;top:${L.tavernY}px">
        <div class="tk-portrait" style="background-image:url('${heroArt('tavern')}')"></div>
        <div class="tk-num">${p.tier}</div>
        <div class="tk-tier">${'★'.repeat(p.tier)}</div>
        <div class="tk-label">Tavern · Tier ${p.tier}</div>
      </div>
      <div class="tavern-btn refresh ${p.gold < CONFIG.rerollCost ? 'off' : ''}" data-act="reroll" style="left:${L.cx + 87}px;top:${L.tavernY + 14}px" title="Refresh the Tavern">
        <div class="tb-icon">↻</div><div class="tb-cost">${CONFIG.rerollCost}</div><div class="tb-label">Refresh</div>
      </div>
      <div class="tavern-btn freeze ${p.frozen ? 'on' : ''}" data-act="freeze" style="left:${L.cx + 187}px;top:${L.tavernY + 14}px" title="Freeze the Tavern">
        <div class="tb-icon">❄</div><div class="tb-label">${p.frozen ? 'Frozen' : 'Freeze'}</div>
      </div>`;
  }

  /** Bottom centre: your hero, hero power to the right, trinkets to the left. */
  heroAreaHtml() {
    const p = this.me;
    const hd = heroDef(p.hero);
    const canPower = !!hd && canUseHeroPower(this.g!, p);
    const state = !hd ? '' : hd.passive ? 'passive' : canPower ? 'ready' : 'spent';
    let h = `<div class="my-hero ${state}" ${hd && !hd.passive ? 'data-act="hero-power"' : ''} style="left:${L.cx - 70}px;top:${L.heroY - 70}px">
      <div class="hero-portrait" style="background-image:url('${heroArt(p.hero)}')"><div class="hp">${p.health}</div></div>
      ${hd && !hd.passive ? `<div class="tb-cost">${hd.cost}</div>` : ''}
      ${hd ? `<div class="tip"><b>${esc(hd.power)}</b>${hd.passive ? ' (Passive)' : ` (${hd.cost} gold)`}<br>${esc(hd.text)}${hd.passive ? '' : `<br><i>${p.heroUsed ? 'Used this turn.' : 'Click your hero to use it.'}</i>`}</div>` : ''}
    </div>`;
    p.trinkets.forEach((t, i) => {
      const td = trinketDef(t);
      h += `<div class="trinket-orb ${td.greater ? 'greater' : ''}" style="left:${L.cx - 150 - i * 70}px;top:${L.heroY - 30}px">
        <div class="tip"><b>${esc(td.name)}</b><br>${esc(td.text)}</div></div>`;
    });
    const quests = p.quests.filter((q) => q.have < q.need);
    if (quests.length) {
      h += `<div class="quest-chip" style="left:${L.portrait ? L.cx + 90 : L.cx - 140 - p.trinkets.length * 70 - 120}px;top:${L.portrait ? L.heroY + 40 : L.heroY - 16}px">${quests.map((q) => `${q.kind === 'bill' ? 'Demons' : 'Kindred'} ${q.have}/${q.need}`).join('<br>')}</div>`;
    }
    return h;
  }

  /** Right edge: End Turn in the middle, gold at the bottom right, menu gear in the corner. */
  rightSideHtml() {
    const p = this.me;
    const max = Math.min(CONFIG.maxGold, 2 + this.g!.round) + p.maxGoldBonus;
    const pips = Array.from({ length: Math.min(max, 12) }, (_, i) => `<span class="pip ${i < p.gold ? 'full' : ''}"></span>`).join('');
    return `
      <div class="turn-label" style="left:${L.endTurn.x + 6}px;top:${L.endTurn.y - 30}px">Turn ${this.g!.round}</div>
      <button class="end-turn" data-act="end-turn" style="left:${L.endTurn.x}px;top:${L.endTurn.y}px">End Turn</button>
      <div class="gold-bar" style="left:${L.gold.x}px;top:${L.gold.y}px">
        <div class="gold-display"><span class="coin"></span>${p.gold}<span class="gmax">/${max}</span></div>
        <div class="pips">${pips}</div>
        ${p.goldNextTurn ? `<div class="hint" style="padding:0">+${p.goldNextTurn} gold next turn</div>` : ''}
      </div>
      <button class="gear" data-act="options" style="left:${L.gear.x}px;top:${L.gear.y}px" title="Options">⚙</button>
      ${this.tribesHtml()}`;
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
      if (s.zone === 'shop') actions = `<button class="btn primary" data-act="buy" ${p.gold < buyCost(p) ? 'disabled' : ''}>Buy <span class="cost">${buyCost(p)}<span class="coin"></span></span></button>`;
      if (s.zone === 'hand') actions = `<button class="btn primary" data-act="play" ${p.board.length >= CONFIG.boardSize ? 'disabled' : ''}>Play</button>`;
      if (s.zone === 'board') actions = `<button class="btn" data-act="left" ${s.idx === 0 || u.mem.locked ? 'disabled' : ''}>◀</button>
        <button class="btn primary" data-act="sell" ${u.mem.locked ? 'disabled' : ''}>Sell <span class="cost">+${sellValue(u, p)}<span class="coin"></span></span></button>
        <button class="btn" data-act="right" ${s.idx >= p.board.length - 1 || u.mem.locked ? 'disabled' : ''}>▶</button>`;
    }
    // place it beside the card (above it for cards in hand)
    const W = 210;
    const H = 300 + (actions ? 54 : 0);
    let x: number;
    let y: number;
    if (L.popover === 'dock') {
      // portrait: a fixed detail area under the hand
      x = L.cx - W / 2;
      y = L.dockY;
    } else if (s.zone === 'hand') {
      x = handX(s.idx, p.hand.length) + 60 - W / 2;
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

  discoverHtml() {
    const d = this.me.discovers[0];
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
      <div class="hint" style="font-size:17px">Choose one to buy. You have ${p.gold} gold. (Placeholder trinkets.)</div>
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
    const seen = this.seenBoards.get(p.id);
    const cards = seen?.length
      ? seen.map((u, i) => cardHtml({ cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp, kw: u.kw }, { zone: 'none', idx: i, x: 0, y: 0, small: true }).replace('position:absolute', '').replace(/style="left:0px;top:0px"/, 'style="position:relative"')).join('')
      : '<div class="hint">You have not fought this player yet.</div>';
    return `<div class="modal" data-act="close-inspect">
      <div class="panel inspect-panel" style="padding:24px 30px;display:flex;flex-direction:column;gap:14px;align-items:center;min-width:700px">
        <div style="display:flex;gap:18px;align-items:center">
          <div class="hero-portrait" style="width:96px;height:96px;background-image:url('${heroArt(p.hero)}')"><div class="hp">${p.health}</div></div>
          <div><div style="font-family:var(--display);font-size:26px">${esc(p.name)}</div>
          <div class="hint" style="padding:0;text-align:left">${esc(h?.title ?? '')}<br>${esc(h?.power ?? '')}: ${esc(h?.text ?? '')}<br>Tavern Tier ${p.tier}${p.trinkets.length ? ' · Trinkets: ' + p.trinkets.map((t) => trinketDef(t).name).join(', ') : ''}</div></div>
        </div>
        <div class="hint">Army when you last fought:</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${cards}</div>
        <button class="btn" data-act="close-inspect">Close</button>
      </div></div>`;
  }

  overHtml() {
    const p = this.me;
    const place = p.placement || 1;
    return `<div class="modal"><h2>${place === 1 ? 'Victory!' : `You finished ${ordinal(place)}`}</h2>
      <div class="hint" style="font-size:18px">Rounds survived: ${this.g!.round}</div>
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
    if (this.g) save(this.g);
    this.render();
  }

  result(r: { ok: boolean; reason?: string }, sound?: () => void) {
    if (r.ok) sound?.();
    if (!r.ok && r.reason) this.toast(r.reason);
  }

  newGame() {
    this.seen = null;
    this.g = newGame((Math.random() * 2 ** 31) | 0);
    this.sel = null;
    this.targeting = null;
    this.seenBoards.clear();
    this.screen = 'hero';
    this.commit();
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
    this.result(play(this.g!, p, handIdx, pos), sfx.deploy);
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
      return this.render();
    }
    const meSide = mine.a === 0 ? 0 : 1;
    const oppId = meSide === 0 ? (mine.b === -1 ? mine.ghostOf! : mine.b) : mine.a;
    if (mine.frames[0]) this.seenBoards.set(oppId, mine.frames[0].sides[1 - meSide]);
    this.screen = 'combat';
    this.combat = new CombatPlayer(this.stage, g, mine, meSide, round, () => {
      this.combat = null;
      this.screen = g.phase === 'over' ? 'over' : 'shop';
      this.render();
    });
    this.combat.play();
  }

  // ---------------- input ----------------
  onClick(e: MouseEvent) {
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
      case 'check-update': e.preventDefault(); checkForUpdates(true); break;
      case 'hero-pick': selectHero(g!, el.dataset.id!); this.screen = 'shop'; this.commit(); break;
      case 'upgrade': this.result(upgrade(g!, p!), sfx.upgrade); this.commit(); break;
      case 'reroll': this.result(reroll(g!, p!), sfx.refresh); this.sel = null; this.commit(); break;
      case 'freeze': toggleFreeze(p!); sfx.click(); this.commit(); break;
      case 'end-turn': sfx.click(); this.endTurn(); break;
      case 'buy': if (this.sel) { this.result(buy(g!, p!, this.sel.idx), sfx.buy); this.sel = null; this.commit(); } break;
      case 'play': if (this.sel) this.doPlay(this.sel.idx, p!.board.length); break;
      case 'sell': if (this.sel) { this.result(sell(g!, p!, this.sel.idx), sfx.sell); this.sel = null; this.commit(); } break;
      case 'left': case 'right': if (this.sel) {
        const to = this.sel.idx + (act === 'left' ? -1 : 1);
        const r = move(p!, this.sel.idx, to);
        if (r.ok) this.sel = { zone: 'board', idx: to };
        this.result(r);
        this.commit();
      } break;
      case 'discover': chooseDiscover(g!, p!, Number(el.dataset.idx)); sfx.buy(); this.commit(); break;
      case 'trinket': if (!pickTrinket(g!, p!, el.dataset.id!)) this.toast('Not enough gold'); else sfx.upgrade(); this.commit(); break;
      case 'trinket-skip': pickTrinket(g!, p!, null); this.commit(); break;
      case 'hero-power': {
        const h = heroDef(p!.hero);
        if (!h || h.passive) break;
        if (!canUseHeroPower(g!, p!)) { this.toast(p!.heroUsed ? 'Already used this turn' : 'Not enough gold'); break; }
        if (h.target) {
          if (!p!.board.length) { this.toast('You need a unit in your army'); break; }
          this.targeting = { kind: 'hero' };
          this.render();
        } else { if (useHeroPower(g!, p!)) sfx.power(); this.commit(); }
        break;
      }
      case 'no-target': if (this.targeting?.kind === 'play') {
        const t = this.targeting;
        this.targeting = null;
        this.result(play(g!, p!, t.handIdx, t.pos), sfx.deploy);
        this.commit();
      } break;
      case 'cancel-target': this.targeting = null; this.render(); break;
      case 'inspect': this.inspect = Number(el.dataset.id); this.render(); break;
      case 'close-inspect': this.inspect = null; this.render(); break;
    }
  }

  onHover(e: MouseEvent) {
    if (this.screen !== 'shop' || this.dragging || this.sel) return;
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
    if (this.screen !== 'shop' || e.button > 0) return;
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

  boardIndexAt(x: number, excludeIdx = -1) {
    const n = this.me.board.length;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      if (i === excludeIdx) continue;
      if (x > L.slotX(i) + L.slotW / 2) idx++;
    }
    return idx;
  }

  updateMarker(pt: { x: number; y: number }) {
    const showBoard = pt.y > L.boardTop && pt.y < L.boardBottom && (this.press!.zone === 'hand' || this.press!.zone === 'board');
    if (!showBoard) {
      this.marker?.remove();
      this.marker = null;
      return;
    }
    if (!this.marker) {
      this.marker = document.createElement('div');
      this.marker.className = 'insert-marker';
      this.stage.appendChild(this.marker);
    }
    const idx = this.boardIndexAt(pt.x, this.press!.zone === 'board' ? this.press!.idx : -1);
    this.marker.style.left = `${L.slotX(idx) - 5}px`;
    this.marker.style.top = `${L.boardY - 3}px`;
    this.marker.style.height = `${L.cardH + 10}px`;
  }

  cancelDrag() {
    this.ghost?.remove();
    this.marker?.remove();
    this.ghost = null;
    this.marker = null;
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
          this.result(play(g, p, t.handIdx, t.pos, u.uid), sfx.deploy);
        } else {
          this.targeting = null;
          if (useHeroPower(g, p, u)) sfx.power();
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
      if (pt.y > L.shopDrop) this.result(buy(g, p, press.idx), sfx.buy);
    } else if (press.zone === 'hand') {
      if (pt.y > L.boardTop && pt.y < L.boardBottom) {
        this.doPlay(press.idx, this.boardIndexAt(pt.x));
        return;
      }
    } else if (press.zone === 'board') {
      if (pt.y < L.shopDrop) this.result(sell(g, p, press.idx), sfx.sell);
      else if (pt.y < L.boardBottom) this.result(move(p, press.idx, this.boardIndexAt(pt.x, press.idx)), sfx.click);
    }
    this.sel = null;
    this.commit();
  }
}
