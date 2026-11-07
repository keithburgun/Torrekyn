import { heroDef } from '../engine/heroes';
import type { CombatFrame, CombatFrameUnit, CombatFx, CombatResult, GameState } from '../engine/types';
import { cardHtml, esc, frameUnitView, heroArt } from './view';
import { sfx } from './sfx';
import { currentLayout, type Layout } from './layout';
import { placeBoardBg, placeHud } from './hud';


/** base time each frame stays on screen (ms at speed ×1) */
const DUR: Record<CombatFrame['kind'], number> = {
  start: 800, trigger: 420, attack: 420, hit: 380, death: 900, resolve: 160, end: 500,
};
const DEATH_FADE = 900;
const REBORN_FADE = 1100;



const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  constructor(private stage: HTMLElement, private g: GameState, private r: CombatResult, private me: 0 | 1, private round: number, private done: () => void) {
    try { this.speed = Number(localStorage.getItem('torrekin-speed')) || 1; } catch { /* storage unavailable */ }
    const meP = g.players[0];
    const oppId = me === 0 ? (r.b === -1 ? r.ghostOf! : r.b) : r.a;
    const opp = g.players[oppId];
    // phones: when neither army ever has more than 5 units, use the bigger shop-size cards
    const most = Math.max(0, ...r.frames.map((f) => Math.max(f.sides[0].length, f.sides[1].length)));
    if (this.L.portrait && most <= 5) this.L = { ...this.L, small: false, large: true, cardW: 168, cardH: 228, combat: { ...this.L.combat, step: 176 } };
    placeBoardBg(stage, this.L, (this.L.combat.enemyY + this.L.combat.myY + this.L.cardH) / 2);
    stage.innerHTML = `
      <div class="combat-name enemy" style="left:${this.L.combat.enemyHero.x - this.av.enemy / 2}px;top:${this.L.combat.enemyHero.y - this.av.enemy / 2}px"><div class="avatar" id="avatar-enemy" style="background-image:url('${heroArt(opp.hero)}')"><div class="hpb">${opp.health}</div></div>
        <div>${r.b === -1 ? 'Ghost of ' : ''}${esc(opp.name)}<div class="hint" style="padding:0;text-align:left">${esc(heroDef(opp.hero)?.title ?? '')}</div></div></div>
      <div class="combat-name mine" style="left:${this.L.combat.myHero.x - this.av.mine / 2}px;top:${this.L.combat.myHero.y - this.av.mine / 2}px"><div class="avatar" id="avatar-me" style="background-image:url('${heroArt(meP.hero)}')"><div class="hpb">${meP.health}</div></div><div>${esc(meP.name)}</div></div>
      <div class="vs-banner" style="left:${this.L.cx}px;top:${this.L.combat.banner}px">ROUND ${round} · BATTLE</div>
      <div class="abs combat-ctl" style="right:30px;bottom:30px;display:flex;gap:10px">
        <button class="btn" data-cact="speed">Speed ×${this.speed}</button>
        <button class="btn" data-cact="skip">Skip</button>
      </div>
      <div id="clayer" class="abs" style="inset:0;pointer-events:none"></div>
      <div id="fxlayer" class="abs" style="inset:0;pointer-events:none;z-index:40"></div>`;
    this.layer = stage.querySelector('#clayer') as HTMLElement;
    placeHud(stage, this.L);
    this.fxLayer = stage.querySelector('#fxlayer') as HTMLElement;
    stage.querySelector('[data-cact="speed"]')!.addEventListener('click', (e) => {
      this.speed = this.speed >= 4 ? 1 : this.speed * 2;
      try { localStorage.setItem('torrekin-speed', String(this.speed)); } catch { /* ignore */ }
      (e.target as HTMLElement).textContent = `Speed ×${this.speed}`;
    });
    stage.querySelector('[data-cact="skip"]')!.addEventListener('click', () => { this.skip = true; });
  }

  private t(ms: number) {
    return ms / this.speed;
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
    this.finish();
  }

  private pos(f: CombatFrame) {
    const map = new Map<number, { u: CombatFrameUnit; x: number; y: number; side: 0 | 1 }>();
    const mine = f.sides[this.me];
    const theirs = f.sides[1 - this.me];
    mine.forEach((u, i) => map.set(u.id, { u, x: this.rowX(i, mine.length), y: this.L.combat.myY, side: this.me }));
    theirs.forEach((u, i) => map.set(u.id, { u, x: this.rowX(i, theirs.length), y: this.L.combat.enemyY, side: (1 - this.me) as 0 | 1 }));
    return map;
  }

  // ---------- small effect helpers ----------
  private center(id: number | undefined): { x: number; y: number } | null {
    if (id === undefined) return null;
    const el = this.els.get(id);
    if (!el) return null;
    return { x: parseFloat(el.style.left) + this.L.cardW / 2, y: parseFloat(el.style.top) + this.L.cardH / 2 };
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

  /** Divine Shield breaking: flash, ring and golden shards flying outward. */
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
    const shots = fx.filter((e) => (e.k === 'hit' || e.k === 'kill') && (e.from !== undefined || e.fromSide !== undefined));
    if (!shots.length) return;
    sfx.zap();
    const flight = this.t(380);
    const anims: Promise<unknown>[] = [];
    shots.slice(0, 12).forEach((e, i) => {
      const from = e.from !== undefined ? this.center(e.from) : this.heroCenter(e.fromSide!);
      const to = this.center(e.to);
      if (!from || !to || (from.x === to.x && from.y === to.y)) return;
      const p = document.createElement('div');
      p.className = `projectile ${e.k === 'kill' ? 'kill' : e.from === undefined ? 'hero' : ''}`;
      p.style.left = `${from.x}px`;
      p.style.top = `${from.y}px`;
      this.fxLayer.appendChild(p);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lift = -Math.min(120, Math.hypot(dx, dy) * 0.25);
      const a = p.animate(
        [
          { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0.6 },
          { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 + lift}px)) scale(1.15)`, opacity: 1, offset: 0.5 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.9)`, opacity: 1 },
        ],
        { duration: flight, delay: i * this.t(70), easing: 'ease-in', fill: 'forwards' },
      );
      anims.push(a.finished.then(() => {
        p.remove();
        sfx.hit();
        this.spot('impact', to.x, to.y, this.t(420));
      }).catch(() => p.remove()));
    });
    await Promise.all(anims);
  }

  private flashSource(id: number | undefined) {
    if (id === undefined) return false;
    const el = this.els.get(id);
    if (!el) return false;
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
      this.els.delete(id);
      if (instant) { el.remove(); continue; }
      sfx.destroy();
      el.style.transition = `opacity ${this.t(DEATH_FADE)}ms ease-out, transform ${this.t(DEATH_FADE)}ms ease-out, filter ${this.t(DEATH_FADE)}ms`;
      el.classList.add('dying');
      setTimeout(() => el.remove(), this.t(DEATH_FADE) + 30);
    }

    // 3. add new units / update existing ones
    for (const [id, { u, x, y }] of pos) {
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
            sfx.deploy();
            el.classList.add('summon-in');
            el.style.setProperty('--life', `${this.t(650)}ms`);
            this.spot('summon-burst', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(650));
          }
        }
        this.layer.appendChild(el);
        this.els.set(id, el);
      } else {
        const keep = ['activate', 'reborn-in', 'summon-in'].filter((c) => el!.classList.contains(c));
        el.className = fresh.className;
        for (const c of keep) el.classList.add(c);
        el.innerHTML = fresh.innerHTML;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      if (instant) continue;
      const before = prevPos.get(id)?.u;
      if (before) {
        if (u.hp < before.hp) this.float(x, y, `-${before.hp - u.hp}`, 'dmg');
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
      if (fxFor(id, 'venom')) this.spot('venom-pop', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(700));
      if (fxFor(id, 'kill')) this.spot('kill-pop', x + this.L.cardW / 2, y + this.L.cardH / 2, this.t(700), '✖');
    }
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
        setTimeout(() => { sfx.hit(); this.spot('impact big', parseFloat(t.style.left) + this.L.cardW / 2, parseFloat(t.style.top) + this.L.cardH / 2, this.t(380)); }, this.t((DUR.attack + 140) * 0.7));
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
      n.style.left = src ? `${parseFloat(src.style.left) + this.L.cardW / 2}px` : `${this.L.cx}px`;
      n.style.top = src ? `${parseFloat(src.style.top) - 30}px` : `${this.L.combat.banner}px`;
      n.style.animationDuration = `${this.t(1200)}ms`;
      this.layer.appendChild(n);
      setTimeout(() => n.remove(), this.t(1250));
    }
    let wait = DUR[f.kind];
    if (fx.some((e) => e.k === 'reborn')) wait = Math.max(wait, REBORN_FADE * 0.8);
    if (fx.some((e) => e.k === 'summon')) wait = Math.max(wait, 600);
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
    b.innerHTML = `<h2>${tie ? 'Draw' : myWin ? 'Victory' : 'Defeat'}</h2>
      <p>${tie ? 'No damage dealt.' : myWin ? `You dealt ${r.damage} damage.` : `You took ${r.damage} damage. ${me.health > 0 ? `${me.health} Health left.` : ''}`}</p>
      <button class="btn big primary">Continue</button>`;
    this.stage.appendChild(b);
    b.querySelector('button')!.addEventListener('click', () => this.done());
  }
}
