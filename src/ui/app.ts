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

declare const __ARTIFACT__: boolean;

type Zone = 'shop' | 'hand' | 'board';
interface Sel { zone: Zone; idx: number }
interface Press { zone: Zone; idx: number; x: number; y: number; el: HTMLElement; pointerId: number }
interface Targeting { kind: 'play'; handIdx: number; pos: number } // play a card that needs a target
interface HeroTargeting { kind: 'hero' }

// ---- layout (stage coordinates, 1600x900) ----
export const SLOT_X = (i: number) => 263 + i * 154;
const BOARD_Y = 350;
const SHOP_Y = 76;
const HAND_Y = 712;
const SHOP_DROP_LINE = 310; // above this = tavern
const BOARD_TOP = 320;
const BOARD_BOTTOM = 640;

function shopX(i: number, n: number) {
  const total = n * 152 - 12;
  return 800 - total / 2 + i * 152;
}
function handX(i: number, n: number) {
  const step = n <= 8 ? 128 : Math.floor(1040 / n);
  const total = (n - 1) * step + 120;
  return 800 - total / 2 + i * step;
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
    this.stage.classList.toggle('menu-bg', this.screen === 'title' || this.screen === 'rules' || this.screen === 'hero');
    this.stage.style.backgroundImage = `url('${art(this.stage.classList.contains('menu-bg') ? 'art/menu.svg' : 'art/board.svg')}')`;
    if (this.screen === 'combat') return; // combat view owns the stage
    let html = '';
    if (this.screen === 'title') html = this.titleHtml();
    else if (this.screen === 'rules') html = this.rulesHtml();
    else if (this.screen === 'hero') html = this.heroSelectHtml();
    else if (this.screen === 'shop') html = this.shopHtml();
    else if (this.screen === 'over') html = this.shopHtml() + this.overHtml();
    this.stage.innerHTML = html;
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
      <div class="choices">${offer.map((id) => {
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
    return `<div class="abs panel leader" style="left:14px;top:14px;width:228px;height:872px">${rows}${ghostNext}</div>`;
  }

  shopHtml() {
    const g = this.g!;
    const p = this.me;
    const tgt = this.targeting;
    const targetUids = tgt?.kind === 'play'
      ? new Set(validTargets(p, p.hand[tgt.handIdx]?.cardId ?? '').map((u) => u.uid))
      : tgt?.kind === 'hero' ? new Set(p.board.map((u) => u.uid)) : null;
    let h = this.leaderboardHtml();
    // tavern header
    const upCost = p.tier >= CONFIG.maxTier ? null : p.upgradeCost;
    h += `<div class="abs panel" style="left:258px;top:14px;width:1084px;height:300px"></div>`;
    h += `<div class="zone-label" style="left:282px;top:24px">Tavern · Tier ${p.tier} ${'★'.repeat(p.tier)}</div>`;
    h += `<div class="abs" style="right:276px;top:20px;display:flex;gap:10px">
      <button class="btn" data-act="upgrade" ${upCost === null || p.gold < upCost ? 'disabled' : ''}>${upCost === null ? 'Max Tier' : `Upgrade <span class="cost">${upCost}<span class="coin"></span></span>`}</button>
      <button class="btn" data-act="reroll" ${p.gold < CONFIG.rerollCost ? 'disabled' : ''}>Refresh <span class="cost">${CONFIG.rerollCost}<span class="coin"></span></span></button>
      <button class="btn ${p.frozen ? 'on' : ''}" data-act="freeze">${p.frozen ? 'Frozen' : 'Freeze'}</button>
    </div>`;
    p.shop.forEach((u, i) => {
      const sel = this.sel?.zone === 'shop' && this.sel.idx === i ? 'selected' : '';
      const v = unitView(p, u, 'shop', i);
      h += cardHtml(v, { zone: 'shop', idx: i, x: shopX(i, p.shop.length), y: SHOP_Y, extraClass: `${sel} ${p.gold < buyCost(p) ? 'unaffordable' : ''} ${p.frozen ? 'frozen' : ''}` });
    });
    if (!p.shop.length) h += `<div class="hint abs" style="left:560px;top:170px;width:480px">The Tavern is empty. Refresh for new units.</div>`;
    // army slots
    for (let i = 0; i < CONFIG.boardSize; i++) {
      const s = p.slots[i];
      const bonus = [s.atk || s.hp ? `${s.atk >= 0 ? '+' : ''}${s.atk}/${s.hp >= 0 ? '+' : ''}${s.hp}` : '', ...s.kw.map((k) => ({ taunt: 'Taunt', divineShield: 'Shield', reborn: 'Reborn', venomous: 'Venom', stealth: 'Stealth', windfury: 'Windfury' })[k])].filter(Boolean).join(' · ');
      const buffed = s.atk || s.hp || s.kw.length;
      h += `<div class="slot-plate ${buffed ? 'buffed' : ''}" style="left:${SLOT_X(i)}px"><div class="bonus ${s.atk < 0 || s.hp < 0 ? 'neg' : ''}">${bonus || `Slot ${i + 1}`}</div></div>`;
    }
    p.board.forEach((u, i) => {
      const sel = this.sel?.zone === 'board' && this.sel.idx === i ? 'selected' : '';
      const tg = targetUids?.has(u.uid) ? 'targetable' : '';
      h += cardHtml(unitView(p, u, 'board', i), { zone: 'board', idx: i, x: SLOT_X(i) + 5, y: BOARD_Y, extraClass: `${sel} ${tg}` });
    });
    // hand
    h += `<div class="zone-label" style="left:282px;top:${HAND_Y - 40}px">Hand ${p.hand.length}/${CONFIG.handSize}</div>`;
    p.hand.forEach((u, i) => {
      const sel = this.sel?.zone === 'hand' && this.sel.idx === i ? 'selected' : '';
      h += cardHtml(unitView(p, u, 'hand', i), { zone: 'hand', idx: i, x: handX(i, p.hand.length), y: HAND_Y, small: true, extraClass: sel });
    });
    // right panel
    h += this.rightPanelHtml();
    // targeting hint
    if (tgt) {
      h += `<div class="abs panel" style="left:520px;top:600px;width:560px;padding:10px;display:flex;gap:14px;align-items:center;justify-content:center;z-index:20">
        <span>${tgt.kind === 'hero' ? 'Choose a unit for your Hero Power' : `Choose a target for ${esc(def(p.hand[tgt.handIdx]?.cardId ?? 'skel').name)}`}</span>
        ${tgt.kind === 'play' ? '<button class="btn" data-act="no-target">No target</button>' : ''}
        <button class="btn" data-act="cancel-target">Cancel</button></div>`;
    }
    // modals
    if (p.discovers.length) h += this.discoverHtml();
    else if (p.trinketOffer) h += this.trinketHtml();
    if (this.inspect !== null) h += this.inspectHtml();
    void g;
    return h;
  }

  rightPanelHtml() {
    const p = this.me;
    const hd = heroDef(p.hero);
    const canPower = hd && canUseHeroPower(this.g!, p);
    const trink = p.trinkets.map((t) => `<span class="trinket-chip" title="${esc(trinketDef(t).text)}">${esc(trinketDef(t).name)}</span>`).join('');
    return `<div class="abs panel hero-box" style="left:1356px;top:14px;width:230px;height:872px">
      <div class="hero-portrait" style="background-image:url('${heroArt(p.hero)}')"><div class="hp">${p.health}</div></div>
      <div style="font-family:var(--display);font-weight:700;font-size:16px;text-align:center">${esc(hd?.name ?? p.name)}</div>
      ${hd ? `<div class="power ${hd.passive ? 'passive' : ''} ${p.heroUsed ? 'used' : ''} ${!hd.passive && !canPower ? 'disabled' : ''}" data-act="hero-power">
        <div class="pn">${esc(hd.power)} ${hd.passive ? '' : `<span class="cost">${hd.cost}<span class="coin"></span></span>`}</div>
        <div class="pt">${esc(hd.text)}</div></div>` : ''}
      ${trink ? `<div class="trinkets">${trink}</div>` : ''}
      <div class="gold-display"><span class="coin"></span>${p.gold}<span style="font-size:16px;color:var(--ink-soft)">/ ${Math.min(CONFIG.maxGold, 2 + this.g!.round) + p.maxGoldBonus}</span></div>
      <div style="font-size:14px;color:var(--ink-soft)">Round ${this.g!.round}${p.goldNextTurn ? ` · +${p.goldNextTurn} gold next turn` : ''}</div>
      <button class="btn big primary" data-act="end-turn" style="width:100%">End Turn</button>
      <div id="detail" class="detail">${this.detailHtml()}</div>
      <button class="btn" data-act="menu" style="position:absolute;top:12px;left:12px;font-size:13px;padding:4px 10px">Menu</button>
    </div>`;
  }

  detailHtml() {
    const p = this.me;
    const s = this.sel ?? this.hover;
    if (!s) {
      const next = p.nextOpponent === -1 ? 'a ghost' : p.nextOpponent !== null ? this.g!.players[p.nextOpponent].name : '?';
      const quests = p.quests.filter((q) => q.have < q.need).map((q) => `<div class="hint">Quest: ${q.kind === 'bill' ? 'Buy Business Demons' : 'Buy Kindred'} ${q.have}/${q.need}</div>`).join('');
      return `<div class="hint" style="margin-top:20px">Next opponent:<br><b style="color:var(--ink);font-size:17px">${esc(next)}</b></div>
        ${quests}
        <div class="hint" style="margin-top:16px">Drag a Tavern unit down to buy it. Drag from your hand into your army to play it. Drag an army unit up to the Tavern to sell it.<br><br>Or tap a card to see it and act.</div>`;
    }
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
    return `<div style="transform:scale(.84);transform-origin:top center;margin-bottom:-50px">${bigCardHtml(v)}</div><div class="actions">${actions}</div>`;
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
      <div class="choices">${offer.map((id) => {
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
      <div class="panel" style="padding:24px 30px;display:flex;flex-direction:column;gap:14px;align-items:center;min-width:700px">
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
    const el = this.stage.querySelector('#detail');
    if (el) el.innerHTML = this.detailHtml();
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

  result(r: { ok: boolean; reason?: string }) {
    if (!r.ok && r.reason) this.toast(r.reason);
  }

  newGame() {
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
    this.result(play(this.g!, p, handIdx, pos));
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
      case 'menu': this.screen = 'title'; this.render(); break;
      case 'check-update': e.preventDefault(); checkForUpdates(true); break;
      case 'hero-pick': selectHero(g!, el.dataset.id!); this.screen = 'shop'; this.commit(); break;
      case 'upgrade': this.result(upgrade(g!, p!)); this.commit(); break;
      case 'reroll': this.result(reroll(g!, p!)); this.sel = null; this.commit(); break;
      case 'freeze': toggleFreeze(p!); this.commit(); break;
      case 'end-turn': this.endTurn(); break;
      case 'buy': if (this.sel) { this.result(buy(g!, p!, this.sel.idx)); this.sel = null; this.commit(); } break;
      case 'play': if (this.sel) this.doPlay(this.sel.idx, p!.board.length); break;
      case 'sell': if (this.sel) { this.result(sell(g!, p!, this.sel.idx)); this.sel = null; this.commit(); } break;
      case 'left': case 'right': if (this.sel) {
        const to = this.sel.idx + (act === 'left' ? -1 : 1);
        const r = move(p!, this.sel.idx, to);
        if (r.ok) this.sel = { zone: 'board', idx: to };
        this.result(r);
        this.commit();
      } break;
      case 'discover': chooseDiscover(g!, p!, Number(el.dataset.idx)); this.commit(); break;
      case 'trinket': if (!pickTrinket(g!, p!, el.dataset.id!)) this.toast('Not enough gold'); this.commit(); break;
      case 'trinket-skip': pickTrinket(g!, p!, null); this.commit(); break;
      case 'hero-power': {
        const h = heroDef(p!.hero);
        if (!h || h.passive) break;
        if (!canUseHeroPower(g!, p!)) { this.toast(p!.heroUsed ? 'Already used this turn' : 'Not enough gold'); break; }
        if (h.target) {
          if (!p!.board.length) { this.toast('You need a unit in your army'); break; }
          this.targeting = { kind: 'hero' };
          this.render();
        } else { useHeroPower(g!, p!); this.commit(); }
        break;
      }
      case 'no-target': if (this.targeting?.kind === 'play') {
        const t = this.targeting;
        this.targeting = null;
        this.result(play(g!, p!, t.handIdx, t.pos));
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
    const scale = r.width / 1600;
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
      if (x > SLOT_X(i) + 75) idx++;
    }
    return idx;
  }

  updateMarker(pt: { x: number; y: number }) {
    const showBoard = pt.y > BOARD_TOP && pt.y < BOARD_BOTTOM && (this.press!.zone === 'hand' || this.press!.zone === 'board');
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
    this.marker.style.left = `${SLOT_X(idx) - 5}px`;
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
          this.result(play(g, p, t.handIdx, t.pos, u.uid));
        } else {
          this.targeting = null;
          useHeroPower(g, p, u);
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
      if (pt.y > SHOP_DROP_LINE) this.result(buy(g, p, press.idx));
    } else if (press.zone === 'hand') {
      if (pt.y > BOARD_TOP && pt.y < BOARD_BOTTOM) {
        this.doPlay(press.idx, this.boardIndexAt(pt.x));
        return;
      }
    } else if (press.zone === 'board') {
      if (pt.y < SHOP_DROP_LINE) this.result(sell(g, p, press.idx));
      else if (pt.y < BOARD_BOTTOM) this.result(move(p, press.idx, this.boardIndexAt(pt.x, press.idx)));
    }
    this.sel = null;
    this.commit();
  }
}
