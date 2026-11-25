import { heroDef } from '../engine/heroes';
import { store } from '../save/store';
import type { CombatFrame, CombatFrameUnit, CombatFx, CombatResult, GameState } from '../engine/types';
import { bigCardHtml, cardHtml, esc, frameUnitView, heroArt, keywordPanelsHtml, relatedCards, relatedCardHtml } from './view';
import { sfx } from './sfx';
import { currentLayout, type Layout } from './layout';
import { placeBoardBg, placeHud } from './hud';
import { puff } from './fx';


/** battle speeds: Normal, then > (1.5x as fast) and >> (2.5x as fast); Normal itself runs 15% faster than the old ×1 */
export const BASE_SPEED = 1.15;
export const SPEEDS = [{ v: 1, label: 'Normal' }, { v: 1.5, label: '>' }, { v: 2.5, label: '>>' }];
export const speedLabel = (v: number) => SPEEDS.find((s) => s.v === v)?.label ?? 'Normal';
/** the saved setting (older saves stored 2 and 4 for the old ×2 and ×4) */
export function speedSetting(): number {
  const v = Number(store.get('torrekin-speed')) || 1;
  return v >= 4 ? 2.5 : v >= 2 ? 1.5 : SPEEDS.some((s) => s.v === v) ? v : 1;
}

/** base time each frame stays on screen (ms at speed ×1) */
const DUR: Record<CombatFrame['kind'], number> = {
  start: 800, trigger: 420, attack: 420, hit: 380, death: 900, resolve: 160, end: 500,
};
const DEATH_FADE = 900;
const REBORN_FADE = 1100;



/** the battle's Pause button: every wait in the playback holds while paused */
let paused = false;
const sleep = async (ms: number) => {
  await new Promise((r) => setTimeout(r, ms));
  while (paused) await new Promise((r) => setTimeout(r, 120));
};

/**
 * The battle can play on the shop screen itself (the default now): the opponent's army stands where the Tavern's
 * units were, with their hero in the Tavern's circle; yours stays in its places; your hero, hand, leaderboard and the
 * rest of the screen stay put. App draws that screen and passes where things are.
 */
export interface BattleOnShop {
  /** your units' x by position (they fill from the left, as in the shop) */
  myX: (i: number) => number;
  myY: number;
  enemyY: number;
  myHero: { x: number; y: number };
  enemyHero: { x: number; y: number };
  /** your hand cards: where, and at what size */
  handPos: (i: number, n: number) => { x: number; y: number };
  handSize: { small: boolean; large: boolean; w: number; h: number };
  /** where the Speed / Pause / Skip buttons go (the Begin Battle button's place) */
  controls: { x: number; y: number };
}

export class CombatPlayer {
  els = new Map<number, HTMLElement>();
  speed = 1;
  skip = false;
  layer: HTMLElement;
  fxLayer: HTMLElement;
  L: Layout = currentLayout();
  /** hero portrait sizes in combat (bigger on phones; must match styles.css) */
  av = this.L.portrait ? { enemy: 130, mine: 150 } : { enemy: 100, mine: 124 };
  private rowX(i: number, n: number) {
    const step = this.L.combat.step;
    const total = (n - 1) * step + this.L.cardW;
    return this.L.cx - total / 2 + i * step;
  }

  private hpBefore: (id: number) => number = () => 0;
  private ghost = false;
  private oppId = 0;

  constructor(private stage: HTMLElement, private g: GameState, private r: CombatResult, private me: 0 | 1, private round: number, private done: () => void, private onShop?: BattleOnShop) {
    this.speed = speedSetting();
    const meP = g.players[0];
    const oppId = me === 0 ? (r.b === -1 ? r.ghostOf! : r.b) : r.a;
    const opp = g.players[oppId];
    // health shown at the start: the damage from this fight has already been applied, so add it back
    const loserId = r.winner === -1 ? -2 : r.winner === 0 ? r.b : r.a;
    this.hpBefore = (id: number) => g.players[id].health + (id === loserId ? r.damage : 0);
    this.ghost = r.b === -1;
    this.oppId = oppId;
    const controls = (x: number, y: number, col: boolean) => `<div class="abs combat-ctl ${col ? 'col' : ''}" style="left:${x}px;top:${y}px">
        <button class="btn" data-cact="speed">Speed ${speedLabel(this.speed)}</button>
        <button class="btn" data-cact="pause">Pause</button>
        <button class="btn" data-cact="skip">Skip</button>
      </div>`;
    if (onShop) {
      const L = this.L;
      const bannerY = (onShop.enemyY + L.cardH + onShop.myY) / 2;
      this.L = { ...L, combat: { ...L.combat, myY: onShop.myY, enemyY: onShop.enemyY, myHero: onShop.myHero, enemyHero: onShop.enemyHero, banner: bannerY } };
      const add = document.createElement('div');
      add.innerHTML = `${controls(onShop.controls.x, onShop.controls.y, true).replace("combat-ctl ", "combat-ctl onshop ")}
        <div class="vs-banner fleeting" style="left:${L.cx}px;top:${bannerY}px">ROUND ${round} · BATTLE</div>
        <div id="clayer" class="abs" style="inset:0;pointer-events:none"></div>
        <div id="fxlayer" class="abs" style="inset:0;pointer-events:none;z-index:40"></div>`;
      stage.append(...add.childNodes);
    } else {
    // phones: when neither army ever has more than 5 units, use the bigger shop-size cards
    const most = Math.max(0, ...r.frames.map((f) => Math.max(f.sides[0].length, f.sides[1].length)));
    if (this.L.portrait && most <= 5) this.L = { ...this.L, small: false, large: true, cardW: 168, cardH: 228, combat: { ...this.L.combat, step: 176 } };
    placeBoardBg(stage, this.L, (this.L.combat.enemyY + this.L.combat.myY + this.L.cardH) / 2);
    stage.innerHTML = `
      <div class="combat-name enemy" style="left:${this.L.combat.enemyHero.x - this.av.enemy / 2}px;top:${this.L.combat.enemyHero.y - this.av.enemy / 2}px"><div class="avatar" id="avatar-enemy" style="background-image:url('${heroArt(opp.hero)}')"><div class="hpb">${this.ghost ? '💀' : Math.max(0, this.hpBefore(oppId))}</div></div>
        <div>${r.b === -1 ? 'Ghost of ' : ''}${esc(opp.name)}<div class="hint" style="padding:0;text-align:left">${esc(heroDef(opp.hero)?.name ?? '')}</div></div></div>
      <div class="combat-name mine" style="left:${this.L.combat.myHero.x - this.av.mine / 2}px;top:${this.L.combat.myHero.y - this.av.mine / 2}px"><div class="avatar" id="avatar-me" style="background-image:url('${heroArt(meP.hero)}')"><div class="hpb">${Math.max(0, this.hpBefore(0))}</div></div><div>${esc(meP.name)}</div></div>
      <div class="vs-banner" style="left:${this.L.cx}px;top:${this.L.combat.banner}px">ROUND ${round} · BATTLE</div>
      <div class="abs combat-ctl" style="right:30px;bottom:30px;display:flex;gap:10px">
        <button class="btn" data-cact="speed">Speed ${speedLabel(this.speed)}</button>
        <button class="btn" data-cact="pause">Pause</button>
        <button class="btn" data-cact="skip">Skip</button>
      </div>
      <div id="clayer" class="abs" style="inset:0;pointer-events:none"></div>
      <div id="fxlayer" class="abs" style="inset:0;pointer-events:none;z-index:40"></div>`;
    }
    this.layer = stage.querySelector('#clayer') as HTMLElement;
    if (!onShop) placeHud(stage, this.L);
    this.fxLayer = stage.querySelector('#fxlayer') as HTMLElement;
    stage.querySelector('[data-cact="speed"]')!.addEventListener('click', (e) => {
      const i = SPEEDS.findIndex((s) => s.v === this.speed);
      this.speed = SPEEDS[(i + 1) % SPEEDS.length].v;
      store.set('torrekin-speed', String(this.speed));
      (e.target as HTMLElement).textContent = `Speed ${speedLabel(this.speed)}`;
    });
    stage.querySelector('[data-cact="skip"]')!.addEventListener('click', () => { this.skip = true; paused = false; });
    paused = false;
    stage.querySelector('[data-cact="pause"]')!.addEventListener('click', (e) => {
      paused = !paused;
      (e.target as HTMLElement).textContent = paused ? 'Resume' : 'Pause';
      this.stage.classList.toggle('combat-paused', paused);
    });
    // hover (or tap) a unit to see its full card; the battle keeps going
    stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.hoverAt(e); });
    stage.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest('button')) this.hoverAt(e); });
    stage.addEventListener('pointerleave', () => this.showZoom(null));
  }

  /** the unit each card shows right now (for the zoomed card) */
  private units = new Map<number, CombatFrameUnit>();
  /** your hand during the battle: card elements by uid */
  private handEls = new Map<number, HTMLElement>();

  /**
   * Your hand, shown small beside your hero during the battle (left of it on wide screens, under it on phones):
   * cards gained in battle arrive with a sparkle, cards summoned from it lift away.
   */
  private showHand(f: CombatFrame, instant: boolean) {
    if (!f.hand) return;
    const L = this.L;
    const on = this.onShop;
    const sc = on ? 1 : L.portrait ? 0.62 : 0.58; // card scale
    const w = on ? on.handSize.w : L.cardW * sc;
    const ch = on ? on.handSize.h : L.cardH * sc;
    const n = f.hand.length;
    const hero = L.combat.myHero;
    const step = Math.min(w * 0.82, (L.portrait ? 840 : 560) / Math.max(1, n));
    const pos = (i: number) => on ? on.handPos(i, n) : L.portrait
      ? { x: hero.x - ((n - 1) * step) / 2 + i * step - w / 2, y: Math.min(L.H - L.cardH * sc - 8, hero.y + 120) }
      : { x: hero.x - 150 - w - (n - 1 - i) * step, y: hero.y - (L.cardH * sc) / 2 + 10 };
    const seen = new Set<number>();
    f.hand.forEach((c, i) => {
      seen.add(c.uid);
      const { x, y } = pos(i);
      const html = cardHtml({ cardId: c.cardId, golden: c.golden, atk: c.atk, hp: c.hp, kw: c.kw }, on
        ? { zone: 'combat', idx: i, x, y, small: on.handSize.small, large: on.handSize.large, extraClass: 'in-hand battle-hand' }
        : { zone: 'combat', idx: i, x, y, small: L.small, extraClass: 'combat-hand' });
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild as HTMLElement;
      fresh.style.setProperty('--hs', String(sc));
      let el = this.handEls.get(c.uid);
      if (!el) {
        el = fresh;
        this.layer.appendChild(el);
        this.handEls.set(c.uid, el);
        if (!instant && this.handEls.size > 0 && f.kind !== 'start') {
          el.classList.add('hand-gain');
          this.spot('buff-glow', x + w / 2, y + ch / 2, this.t(700));
          sfx.buy();
        }
      } else {
        const ox = parseFloat(el.style.left);
        el.className = fresh.className + (el.classList.contains('hand-gain') ? ' hand-gain' : '');
        el.innerHTML = fresh.innerHTML;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        if (!instant && ox !== x) el.animate([{ translate: `${ox - x}px 0px` }, { translate: '0px 0px' }], { duration: this.t(300), easing: 'ease-out', fill: 'backwards' });
      }
    });
    for (const [uid, el] of this.handEls) {
      if (seen.has(uid)) continue;
      this.handEls.delete(uid);
      if (instant) { el.remove(); continue; }
      el.classList.add('hand-leave');
      setTimeout(() => el.remove(), this.t(500));
    }
  }
  private zoomId: number | null = null;
  private relTimer = 0;
  private zoomEl: HTMLElement | null = null;

  private hoverAt(e: PointerEvent) {
    let hit: number | null = null;
    for (const [id, el] of this.els) {
      if (el.classList.contains('dying')) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) hit = id;
    }
    this.showZoom(hit);
  }

  private showZoom(id: number | null) {
    const u = id === null ? undefined : this.units.get(id);
    const el = id === null ? undefined : this.els.get(id);
    if (!u || !el) { this.zoomEl?.remove(); this.zoomEl = null; this.zoomId = null; clearTimeout(this.relTimer); return; }
    const same = this.zoomId === id;
    if (!this.zoomEl) {
      this.zoomEl = document.createElement('div');
      this.zoomEl.className = 'combat-zoom';
      this.stage.appendChild(this.zoomEl);
    }
    this.zoomId = id;
    const rel = this.zoomEl.querySelector('.zoom-related');
    const fv = frameUnitView(u);
    const kws = keywordPanelsHtml(fv);
    this.zoomEl.classList.toggle('has-kw', !!kws);
    this.zoomEl.innerHTML = bigCardHtml(fv) + (kws ? `<div class="zoom-kw">${kws}</div>` : '');
    // the cards its text names appear beside it after half a second (kept while the same unit stays zoomed)
    if (same && rel) this.zoomEl.appendChild(rel);
    else {
      clearTimeout(this.relTimer);
      const ids = relatedCards(u.cardId);
      if (ids.length) this.relTimer = window.setTimeout(() => {
        if (this.zoomId !== id || !this.zoomEl) return;
        const r = document.createElement('div');
        const toLeft = !this.L.portrait && parseFloat(this.zoomEl.style.left) > this.L.cx;
        r.className = `zoom-related ${this.L.portrait ? (parseFloat(this.zoomEl.style.top) < this.L.H / 2 ? 'below' : 'above') : toLeft ? 'left' : 'right'}`;
        r.innerHTML = ids.map((x) => relatedCardHtml(x, undefined, u)).join('');
        this.zoomEl.appendChild(r);
      }, 500);
    }
    // clear of the board: the screen's side away from the unit (top or bottom edge on a tall screen)
    const sr = this.stage.getBoundingClientRect(), k = sr.width / this.L.W, r = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2 / k - sr.left / k, cy = (r.top + r.bottom) / 2 / k - sr.top / k;
    // the card is zoomed 2x in CSS; position in stage pixels
    const w = 472, h = 680;
    if (this.L.portrait) {
      this.zoomEl.style.left = `${this.L.cx - w / 2}px`;
      this.zoomEl.style.top = `${cy < this.L.H / 2 ? this.L.H - h - 140 : 120}px`;
    } else {
      this.zoomEl.style.left = `${cx < this.L.cx ? this.L.W - w - 60 : 60}px`;
      this.zoomEl.style.top = `${(this.L.H - h) / 2}px`;
    }
    // keyword panels: toward the middle of the screen (the related cards go beyond them); on a tall screen,
    // across from the related cards
    const kw = this.zoomEl.querySelector('.zoom-kw');
    if (kw) kw.className = `zoom-kw ${this.L.portrait ? (parseFloat(this.zoomEl.style.top) < this.L.H / 2 ? 'above' : 'below') : parseFloat(this.zoomEl.style.left) > this.L.cx ? 'left' : 'right'}`;
  }

  private t(ms: number) {
    return ms / (BASE_SPEED * this.speed);
  }

  /**
   * Your opponent arrives: their hero pops into the Tavern's circle, then their units drop in from the top one at a
   * time, as if stepping up to face you. Quick (about a second), and faster at higher speeds.
   */
  private async intro(f: CombatFrame) {
    if (this.skip) return;
    const keeper = this.stage.querySelector('.enemy-keeper') as HTMLElement | null;
    keeper?.animate([{ opacity: 0, transform: 'translateY(-90px) scale(0.6)' }, { opacity: 1, transform: 'none' }],
      { duration: this.t(300), easing: 'cubic-bezier(.2,.9,.3,1.25)', fill: 'backwards' });
    const enemy = f.sides[1 - this.me];
    const start = this.t(180);
    const step = this.t(90);
    const fall = this.t(320);
    enemy.forEach((u, i) => {
      const el = this.els.get(u.id);
      if (!el) return;
      const dy = parseFloat(el.style.top) + this.L.cardH + 60;
      el.animate([{ translate: `0px ${-dy}px`, opacity: 0 }, { opacity: 1, offset: 0.35 }, { translate: '0px 6px', offset: 0.85 }, { translate: '0px 0px', opacity: 1 }],
        { duration: fall, delay: start + i * step, easing: 'cubic-bezier(.3,.8,.4,1)', fill: 'backwards' });
      window.setTimeout(() => sfx.deal(), start + i * step + fall * 0.8);
    });
    await sleep(start + Math.max(0, enemy.length - 1) * step + fall + this.t(180));
  }

  async play() {
    const frames = this.r.frames;
    let prev: CombatFrame | null = null;
    for (const f of frames) {
      if (this.skip) break;
      await this.show(f, prev);
      prev = f;
    }
    if (frames.length) await this.show(frames[frames.length - 1], prev, true);
    await this.heroHit();
    this.finish();
  }

  /**
   * The loser's hero takes the hit: the winner's surviving units zap them, their health counts down, and if it
   * reaches 0 their portrait shatters and "<HERO> DEFEATED" fills the screen.
   */
  private async heroHit() {
    const r = this.r;
    if (r.winner === -1 || !r.damage) return;
    const fast = this.skip ? 0.25 : 1;
    const ms = (n: number) => this.t(n) * fast;
    const loserSide = (1 - r.winner) as 0 | 1;
    const loserIsMe = loserSide === this.me;
    if (!loserIsMe && this.ghost) return; // a ghost takes no damage
    const loserId = loserIsMe ? 0 : this.oppId;
    const loser = this.g.players[loserId];
    const from = this.hpBefore(loserId);
    const to = loser.health;
    const av = this.stage.querySelector(loserIsMe ? '#avatar-me' : '#avatar-enemy') as HTMLElement | null;
    const hpb = av?.querySelector('.hpb') as HTMLElement | null;
    const target = this.heroCenter(loserSide);
    av?.classList.add('hp-focus');
    await sleep(ms(300));
    await this.damageStars(r, loserSide, hpb ?? av, ms);
    // the hit lands: health counts down
    av?.classList.add('hit');
    const fl = document.createElement('div');
    fl.className = 'float-num dmg hero-dmg';
    fl.textContent = `${r.damage} damage!`;
    // beside the portrait, toward the middle of the screen (the enemy sits at the top, you at the bottom)
    fl.style.left = `${target.x - 170}px`;
    fl.style.top = `${target.y + (loserIsMe ? -150 : 40)}px`;
    this.fxLayer.appendChild(fl);
    setTimeout(() => fl.remove(), ms(1600));
    const steps = Math.min(from - Math.max(to, 0), 15);
    for (let i = 1; i <= steps; i++) {
      if (hpb) {
        hpb.textContent = String(Math.max(0, Math.round(from - ((from - Math.max(to, 0)) * i) / steps)));
        hpb.classList.remove('tick'); void hpb.offsetWidth; hpb.classList.add('tick');
      }
      sfx.click();
      await sleep(ms(Math.max(45, 700 / steps)));
    }
    if (hpb) hpb.textContent = String(Math.max(0, to));
    av?.classList.remove('hit');
    await sleep(ms(500));
    if (to > 0 || !av) { av?.classList.remove('hp-focus'); return; }
    // eliminated: the portrait shatters
    sfx.shieldBreak();
    av.classList.add('ko');
    this.shatter(target.x, target.y);
    puff(this.fxLayer, target.x, target.y, ms(900), 1.6);
    await sleep(ms(450));
    const name = heroDef(loser.hero)?.name ?? loser.name;
    const ko = document.createElement('div');
    ko.className = 'ko-banner';
    ko.innerHTML = `<b>${esc(name.toUpperCase())}</b><span>DEFEATED</span>`;
    this.stage.appendChild(ko);
    await sleep(ms(1900));
    ko.classList.add('out');
    setTimeout(() => ko.remove(), 400);
  }

  /**
   * Shows how the damage adds up: stars pop onto each of the winner's surviving units, one at a time (2 per unit,
   * plus Horseman's extra; a tier part would show on their hero), then they gather and fly into the loser's Health.
   */
  private async damageStars(r: CombatResult, loserSide: 0 | 1, hitEl: HTMLElement | null, ms: (n: number) => number) {
    const winSide = (1 - loserSide) as 0 | 1;
    const parts = r.dmgParts ?? { tier: r.damage, units: [], bonus: [] };
    const hero = this.heroCenter(winSide);
    const stars: HTMLElement[] = [];
    const pop = async (x: number, y: number, extra = '') => {
      const st = document.createElement('div');
      st.className = `dmg-star ${extra}`;
      st.textContent = '★';
      st.style.left = `${x}px`;
      st.style.top = `${y}px`;
      this.fxLayer.appendChild(st);
      stars.push(st);
      sfx.click();
      await sleep(ms(stars.length > 10 ? 120 : 200));
    };
    // the base damage (2): a row of stars across the winner's portrait
    const n = parts.tier;
    const gap = Math.min(40, 200 / Math.max(1, n));
    for (let i = 0; i < n; i++) await pop(hero.x + (i - (n - 1) / 2) * gap, hero.y, 'tier');
    if (n) await sleep(ms(150));
    // for each surviving unit, its stars (2 each), side by side; Horseman's extra ones a little to the side
    const per = parts.perUnit ?? 1;
    for (const id of parts.units) {
      const c = this.center(id);
      if (c) for (let k = 0; k < per; k++) await pop(c.x + (k - (per - 1) / 2) * 34, c.y);
    }
    const extraCount = new Map<number, number>();
    for (const id of parts.bonus) {
      const k = (extraCount.get(id) ?? 0) + 1;
      extraCount.set(id, k);
      const c = this.center(id);
      if (c) await pop(c.x + 26 * k, c.y - 26 * k, 'bonus');
    }
    // any stars we couldn't place (a unit not on screen) still count: they come from the hero
    while (stars.length < r.damage) await pop(hero.x + (stars.length % 5 - 2) * 30, hero.y + 46, 'tier');
    await sleep(ms(250));
    // gather in the middle of the battlefield, then fly into the loser's Health as one
    const mid = { x: this.L.cx, y: this.L.combat.banner };
    sfx.whoosh();
    await Promise.all(stars.map((st, i) => st.animate(
      [{ left: st.style.left, top: st.style.top }, { left: `${mid.x}px`, top: `${mid.y}px` }],
      { duration: ms(420), delay: i * ms(20), easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'forwards' }).finished.catch(() => undefined)));
    for (const st of stars) st.remove();
    const ball = document.createElement('div');
    ball.className = 'dmg-star big';
    ball.innerHTML = `★<b>${r.damage}</b>`;
    ball.style.left = `${mid.x}px`;
    ball.style.top = `${mid.y}px`;
    this.fxLayer.appendChild(ball);
    await sleep(ms(380));
    const to = hitEl ? this.stagePoint(hitEl) : this.heroCenter(loserSide);
    sfx.zap();
    await ball.animate([{ left: `${mid.x}px`, top: `${mid.y}px` }, { left: `${to.x}px`, top: `${to.y}px` }],
      { duration: ms(360), easing: 'cubic-bezier(.6, 0, .9, .5)', fill: 'forwards' }).finished.catch(() => undefined);
    ball.remove();
    puff(this.fxLayer, to.x, to.y, ms(500), 0.8);
  }

  /** an element's centre in stage pixels */
  private stagePoint(el: HTMLElement) {
    const sr = this.stage.getBoundingClientRect();
    const k = sr.width / (this.stage.offsetWidth || 1);
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - sr.left) / k, y: (r.top + r.height / 2 - sr.top) / k };
  }

  private pos(f: CombatFrame) {
    const map = new Map<number, { u: CombatFrameUnit; x: number; y: number; side: 0 | 1 }>();
    const mine = f.sides[this.me];
    const theirs = f.sides[1 - this.me];
    mine.forEach((u, i) => map.set(u.id, { u, x: this.onShop ? this.onShop.myX(i) : this.rowX(i, mine.length), y: this.L.combat.myY, side: this.me }));
    theirs.forEach((u, i) => map.set(u.id, { u, x: this.rowX(i, theirs.length), y: this.L.combat.enemyY, side: (1 - this.me) as 0 | 1 }));
    return map;
  }

  // ---------- small effect helpers ----------
  /** where each unit was last seen: a unit whose Deathrattle deals damage (Gargoil) is already gone when it fires */
  private lastSeen = new Map<number, { x: number; y: number }>();

  private center(id: number | undefined): { x: number; y: number } | null {
    if (id === undefined) return null;
    const el = this.els.get(id);
    if (!el) return this.lastSeen.get(id) ?? null;
    const c = { x: parseFloat(el.style.left) + this.L.cardW / 2, y: parseFloat(el.style.top) + this.L.cardH / 2 };
    this.lastSeen.set(id, c);
    return c;
  }

  private heroCenter(side: 0 | 1) {
    return side === this.me ? this.L.combat.myHero : this.L.combat.enemyHero;
  }

  private spot(cls: string, x: number, y: number, life: number, text = '') {
    const d = document.createElement('div');
    d.className = `fx ${cls}`;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.setProperty('--life', `${life}ms`);
    d.textContent = text;
    this.fxLayer.appendChild(d);
    setTimeout(() => d.remove(), life + 50);
  }

  /** Bubble popping: flash, ring and aqua droplets flying outward. */
  private shatter(x: number, y: number) {
    sfx.shieldBreak();
    const life = this.t(750);
    this.spot('shatter-flash', x, y, this.t(420));
    this.spot('shield-pop', x, y, life);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 110 + Math.random() * 80;
      const d = document.createElement('div');
      d.className = 'fx shard';
      d.style.left = `${x + Math.cos(a) * 60}px`;
      d.style.top = `${y + Math.sin(a) * 75}px`;
      d.style.setProperty('--life', `${life}ms`);
      d.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
      d.style.setProperty('--dy', `${Math.sin(a) * dist + 40}px`);
      d.style.setProperty('--r0', `${Math.random() * 360}deg`);
      d.style.setProperty('--r1', `${Math.random() * 720 - 360}deg`);
      this.fxLayer.appendChild(d);
      setTimeout(() => d.remove(), life + 50);
    }
  }

  private float(x: number, y: number, text: string, cls: string) {
    const d = document.createElement('div');
    d.className = `float-num ${cls}`;
    d.textContent = text;
    d.style.left = `${x + this.L.cardW / 2}px`;
    d.style.top = `${y + this.L.cardH * 0.37}px`;
    d.style.animationDuration = `${this.t(1000)}ms`;
    this.layer.appendChild(d);
    setTimeout(() => d.remove(), this.t(1050));
  }

  /** Fly glowing bolts from the sources of ability damage to their targets. */
  private async projectiles(fx: CombatFx[]) {
    await this.gemShots(fx);
    const shots = fx.filter((e) => (e.k === 'hit' || e.k === 'kill') && (e.from !== undefined || e.fromSide !== undefined));
    if (!shots.length) return;
    if (shots.some((e) => !['longbow', 'sniper'].includes(this.units.get(e.from ?? -1)?.cardId ?? ''))) sfx.zap();
    const flight = this.t(560);
    const anims: Promise<unknown>[] = [];
    shots.slice(0, 12).forEach((e, i) => {
      const from = e.from !== undefined ? this.center(e.from) : this.heroCenter(e.fromSide!);
      const to = this.center(e.to);
      if (!from || !to || (from.x === to.x && from.y === to.y)) return;
      // Longbow and Sniper fire a bullet: straight, fast, pointed at the target, with a muzzle flash
      const shooter = e.from !== undefined ? this.units.get(e.from)?.cardId : undefined;
      if (shooter === 'longbow' || shooter === 'sniper') {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const b = document.createElement('div');
        b.className = 'bullet';
        b.style.left = `${from.x}px`;
        b.style.top = `${from.y}px`;
        this.fxLayer.appendChild(b);
        const delay = i * this.t(110);
        setTimeout(() => { sfx.shot(); this.spot('muzzle', from.x, from.y, this.t(260)); }, delay);
        const a = b.animate(
          [
            { transform: `translate(-50%, -50%) rotate(${ang}deg)` },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${ang}deg)` },
          ],
          { duration: this.t(Math.max(140, Math.min(260, Math.hypot(dx, dy) * 0.4))), delay, easing: 'linear', fill: 'forwards' },
        );
        anims.push(a.finished.then(() => {
          b.remove();
          sfx.hit();
          this.spot('impact', to.x, to.y, this.t(380));
        }).catch(() => b.remove()));
        return;
      }
      // a white ball (gold from a hero, purple for an instant kill) arcing to the target, two fading echoes behind it
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lift = -Math.min(120, Math.hypot(dx, dy) * 0.25);
      const path = [
        { transform: 'translate(-50%, -50%) scale(.9)', opacity: 0.9 },
        { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 + lift}px)) scale(1.15)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`, opacity: 1 },
      ];
      const kind = e.k === 'kill' ? 'kill' : e.from === undefined ? 'hero' : '';
      [0, 1, 2].forEach((j) => {
        const p = document.createElement('div');
        p.className = `projectile ${kind} ${j ? 'trail' : ''}`;
        p.style.left = `${from.x}px`;
        p.style.top = `${from.y}px`;
        this.fxLayer.appendChild(p);
        const a = p.animate(path, { duration: flight, delay: i * this.t(90) + j * this.t(45), easing: 'ease-in-out', fill: 'forwards' });
        const done = a.finished.then(() => {
          p.remove();
          if (j) return;
          sfx.hit();
          this.spot('impact', to.x, to.y, this.t(420));
        }).catch(() => p.remove());
        if (!j) anims.push(done);
      });
    });
    await Promise.all(anims);
  }

  /** Gems played during battle (Invisible Hand, Bulldozer...): a red gem flies from the unit that played it
   *  (or from its hero, if that unit is gone) to each unit it buffs, then sparkles there */
  private async gemShots(fx: CombatFx[]) {
    const gems = fx.filter((e) => e.k === 'gem');
    if (!gems.length) return;
    sfx.buy();
    const anims: Promise<unknown>[] = [];
    gems.slice(0, 12).forEach((e, i) => {
      const from = (e.from !== undefined ? this.center(e.from) : null) ?? this.heroCenter(e.fromSide ?? 0);
      const to = this.center(e.to);
      if (!from || !to) return;
      const p = document.createElement('div');
      p.className = 'gem-shot';
      p.style.left = `${from.x}px`;
      p.style.top = `${from.y}px`;
      this.fxLayer.appendChild(p);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const a = p.animate(
        [
          { transform: 'translate(-50%, -50%) scale(.5) rotate(0deg)', opacity: 0.7 },
          { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - 90}px)) scale(1.3) rotate(180deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(360deg)`, opacity: 1 },
        ],
        { duration: this.t(520), delay: i * this.t(90), easing: 'ease-in-out', fill: 'forwards' },
      );
      anims.push(a.finished.then(() => { p.remove(); this.spot('gem-pop', to.x, to.y, this.t(500)); }).catch(() => p.remove()));
    });
    await Promise.all(anims);
  }

  private flashSource(id: number | undefined) {
    if (id === undefined) return false;
    const el = this.els.get(id);
    if (!el) {
      // already gone (a Deathrattle): a glow where it stood, so you can see where the ability comes from
      const at = this.lastSeen.get(id);
      if (!at) return false;
      this.spot('buff-glow', at.x, at.y, this.t(650));
      return true;
    }
    el.classList.remove('activate');
    void el.offsetWidth;
    el.style.setProperty('--life', `${this.t(650)}ms`);
    el.classList.add('activate');
    setTimeout(() => el.classList.remove('activate'), this.t(700));
    return true;
  }

  // ---------- one frame ----------
  private async show(f: CombatFrame, prev: CombatFrame | null, instant = false) {
    const fx = f.fx ?? [];
    if (!instant) {
      // 1. the unit whose ability is happening lights up, then any bolts fly
      if (f.kind === 'trigger' && this.flashSource(f.source)) await sleep(this.t(220));
      await this.projectiles(fx);
    }

    const pos = this.pos(f);
    const prevPos = prev ? this.pos(prev) : new Map();
    const fxFor = (id: number, k: CombatFx['k']) => fx.some((e) => e.to === id && e.k === k);

    // 2. units that are gone fade away slowly
    for (const [id, el] of this.els) {
      if (pos.has(id)) continue;
      this.center(id); // remember where it stood (its Deathrattle may shoot from there)
      this.els.delete(id);
      if (id === this.zoomId) this.showZoom(null);
      if (instant) { el.remove(); continue; }
      sfx.destroy();
      el.style.transition = `opacity ${this.t(DEATH_FADE)}ms ease-out, transform ${this.t(DEATH_FADE)}ms ease-out, filter ${this.t(DEATH_FADE)}ms`;
      el.classList.add('dying');
      setTimeout(() => el.remove(), this.t(DEATH_FADE) + 30);
    }

    // 3. add new units / update existing ones
    for (const [id, { u, x, y }] of pos) {
      this.units.set(id, u);
      if (id === this.zoomId) queueMicrotask(() => this.showZoom(id)); // the zoomed card follows its unit's stats
      const html = cardHtml(frameUnitView(u), { zone: 'combat', idx: 0, x, y, id, small: this.L.small, large: this.L.large });
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild as HTMLElement;
      if (u.dead) fresh.classList.add('doomed');
      let el = this.els.get(id);
      if (!el) {
        el = fresh;
        el.style.pointerEvents = 'none';
        if (!instant) {
          if (fxFor(id, 'reborn')) {
            sfx.reborn();
            el.classList.add('reborn-in');
            el.style.setProperty('--life', `${this.t(REBORN_FADE)}ms`);
            this.spot('reborn-burst', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(REBORN_FADE));
          } else if (fxFor(id, 'summon') || prev) {
            sfx.puff();
            el.classList.add('summon-in');
            el.style.setProperty('--life', `${this.t(750)}ms`);
            puff(this.fxLayer, x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(750), this.L.large ? 1.3 : 1);
          }
        }
        this.layer.appendChild(el);
        this.els.set(id, el);
      } else {
        const keep = ['activate', 'reborn-in', 'summon-in'].filter((c) => el!.classList.contains(c));
        el.className = fresh.className;
        for (const c of keep) el.classList.add(c);
        el.innerHTML = fresh.innerHTML;
        const ox = parseFloat(el.style.left);
        const oy = parseFloat(el.style.top);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        // units closing a gap (or making room) slide over instead of jumping; deaths start fading first
        if (!instant && (ox !== x || oy !== y)) {
          const deaths = f.kind === 'death' || f.kind === 'resolve';
          el.animate([{ translate: `${ox - x}px ${oy - y}px` }, { translate: '0px 0px' }],
            { duration: this.t(450), delay: deaths ? this.t(220) : 0, easing: 'cubic-bezier(.3, .8, .35, 1)', fill: 'backwards' });
        }
      }
      if (instant) continue;
      const before = prevPos.get(id)?.u;
      if (before) {
        if (u.hp < before.hp) this.float(x, y, `-${before.hp - u.hp + (u.over ?? 0) - (before.over ?? 0)}`, 'dmg');
        else if (u.hp > before.hp || u.atk > before.atk) {
          this.float(x, y, `+${Math.max(0, u.atk - before.atk)}/+${Math.max(0, u.hp - before.hp)}`, 'buff');
          this.spot('buff-glow', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(700));
        } else if (u.atk < before.atk) this.float(x, y, `${u.atk - before.atk} atk`, 'dmg');
        if (before.kw.includes('divineShield') && !u.kw.includes('divineShield')) this.shatter(x + this.L.cardW / 2, y + this.L.cardH / 2);
        if (!before.kw.includes('divineShield') && u.kw.includes('divineShield')) this.spot('shield-gain', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(650));
        if (!before.kw.includes('taunt') && u.kw.includes('taunt')) this.spot('kw-gain', x + this.L.cardW / 2, y + 30, this.t(800), '🛡');
        if (!before.kw.includes('reborn') && u.kw.includes('reborn')) this.spot('kw-gain', x + this.L.cardW / 2, y + 30, this.t(800), '☥');
        if (!before.kw.includes('venomous') && u.kw.includes('venomous')) this.spot('kw-gain', x + this.L.cardW / 2, y + 30, this.t(800), '☠');
      }
      if (before && u.avenge !== undefined && before.avenge !== u.avenge) el.querySelector('.avenge-count')?.classList.add('tick');
      if (fxFor(id, 'splash')) this.spot('impact', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(380));
      if (fxFor(id, 'venom')) this.spot('venom-pop', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(700));
      if (fxFor(id, 'kill')) this.spot('kill-pop', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(700), '✖');
    }
    this.showHand(f, instant);
    if (instant) return;


    // 4. the attack lunge
    if (f.kind === 'attack' && f.attacker !== undefined && f.target !== undefined) {
      const a = this.els.get(f.attacker);
      const t = this.els.get(f.target);
      if (a && t) {
        const dx = parseFloat(t.style.left) - parseFloat(a.style.left);
        const dy = parseFloat(t.style.top) - parseFloat(a.style.top);
        a.style.zIndex = '20';
        const anim = a.animate(
          [{ transform: 'none' }, { transform: `translate(${dx * 0.12}px, ${dy * 0.12 - (dy > 0 ? 14 : -14)}px) scale(1.1)`, offset: 0.4 },
            { transform: `translate(${dx * 0.82}px, ${dy * 0.82}px) scale(1.06)`, offset: 0.7 }, { transform: 'none' }],
          { duration: this.t(DUR.attack + 140), easing: 'ease-in-out' });
        setTimeout(() => {
          sfx.hit();
          this.spot('impact big', parseFloat(t.style.left) + this.L.cardW / 2, parseFloat(t.style.top) + this.L.cardH / 2, this.t(380));
          // Tank / Sickle: the units next to the target are struck in the same instant
          for (const id of f.splash ?? []) { const c = this.center(id); if (c) this.spot('impact', c.x, c.y, this.t(380)); }
        }, this.t((DUR.attack + 140) * 0.7));
        await anim.finished.catch(() => undefined);
        a.style.zIndex = '';
        return;
      }
    }

    // 5. ability label
    if (f.kind === 'trigger' && f.note) {
      const src = f.source !== undefined ? this.els.get(f.source) : undefined;
      const n = document.createElement('div');
      n.className = 'trigger-note';
      n.textContent = f.note;
      // a hero power's or trinket's note sits by that side's hero (above yours, below theirs), so it can't be
      // mistaken for something your own hero did
      const hs = f.noteSide !== undefined && !src ? this.heroCenter(f.noteSide) : null;
      n.style.left = src ? `${parseFloat(src.style.left) + this.L.cardW / 2}px` : hs ? `${hs.x}px` : `${this.L.cx}px`;
      n.style.top = src ? `${parseFloat(src.style.top) - 30}px` : hs ? `${hs.y + (f.noteSide === this.me ? -95 : 95)}px` : `${this.L.combat.banner}px`;
      n.style.animationDuration = `${this.t(1200)}ms`;
      this.layer.appendChild(n);
      setTimeout(() => n.remove(), this.t(1250));
    }
    // on the shop screen, the battle opens with your opponent arriving
    if (!prev && !instant && this.onShop) { await this.intro(f); return; }
    let wait = DUR[f.kind];
    if (fx.some((e) => e.k === 'reborn')) wait = Math.max(wait, REBORN_FADE * 0.8);
    if (fx.some((e) => e.k === 'summon')) wait = Math.max(wait, 650);
    await sleep(this.t(wait));
  }

  private finish() {
    const r = this.r;
    const myWin = r.winner === this.me;
    const tie = r.winner === -1;
    const me = this.g.players[0];
    if (myWin) sfx.win(); else if (!tie) sfx.lose();
    const b = document.createElement('div');
    b.className = `result-banner ${!tie && !myWin ? 'lose' : ''}`;
    const stale = r.stalemate?.[this.me as 0 | 1] ?? 0;
    b.innerHTML = `<p class="rb-lead">${tie ? (stale ? `Stalemate! Time ran out with both armies standing. You took ${stale} damage.` : 'No damage dealt.') : myWin ? `You dealt ${r.damage} damage.` : `You took ${r.damage} damage.`}</p>
      <div class="rb-health"><div class="rb-heart">${Math.max(0, me.health)}</div><span>Your Health</span></div>
      <button class="btn big primary">Continue</button>`;
    this.stage.appendChild(b);
    b.querySelector('button')!.addEventListener('click', () => this.done());
  }
}
