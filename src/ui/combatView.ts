import { heroDef } from '../engine/heroes';
import type { CombatFrame, CombatFrameUnit, CombatResult, GameState } from '../engine/types';
import { cardHtml, esc, frameUnitView, heroArt } from './view';

const ENEMY_Y = 130;
const MY_Y = 520;
const DUR: Record<CombatFrame['kind'], number> = { start: 900, trigger: 520, attack: 520, resolve: 380, end: 500 };

function rowX(i: number, n: number) {
  const total = n * 154 - 4;
  return 800 - total / 2 + i * 154 + 5;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CombatPlayer {
  els = new Map<number, HTMLElement>();
  speed = 1;
  skip = false;
  layer: HTMLElement;

  constructor(private stage: HTMLElement, private g: GameState, private r: CombatResult, private me: 0 | 1, private round: number, private done: () => void) {
    try { this.speed = Number(localStorage.getItem('torrekin-speed')) || 1; } catch { /* storage unavailable */ }
    const meP = g.players[0];
    const oppId = me === 0 ? (r.b === -1 ? r.ghostOf! : r.b) : r.a;
    const opp = g.players[oppId];
    stage.innerHTML = `
      <div class="combat-name" style="left:40px;top:40px"><div class="avatar" style="background-image:url('${heroArt(opp.hero)}')"></div>
        <div>${r.b === -1 ? 'Ghost of ' : ''}${esc(opp.name)}<div class="hint" style="padding:0;text-align:left">${esc(heroDef(opp.hero)?.title ?? '')}</div></div></div>
      <div class="combat-name" style="left:40px;bottom:40px"><div class="avatar" style="background-image:url('${heroArt(meP.hero)}')"></div><div>${esc(meP.name)}</div></div>
      <div class="vs-banner">ROUND ${round} · BATTLE</div>
      <div class="abs" style="right:30px;bottom:30px;display:flex;gap:10px">
        <button class="btn" data-cact="speed">Speed ×${this.speed}</button>
        <button class="btn" data-cact="skip">Skip</button>
      </div>
      <div id="clayer" class="abs" style="inset:0;pointer-events:none"></div>`;
    this.layer = stage.querySelector('#clayer') as HTMLElement;
    stage.querySelector('[data-cact="speed"]')!.addEventListener('click', (e) => {
      this.speed = this.speed >= 4 ? 1 : this.speed * 2;
      try { localStorage.setItem('torrekin-speed', String(this.speed)); } catch { /* ignore */ }
      (e.target as HTMLElement).textContent = `Speed ×${this.speed}`;
    });
    stage.querySelector('[data-cact="skip"]')!.addEventListener('click', () => { this.skip = true; });
  }

  async play() {
    const frames = this.r.frames;
    let prev: CombatFrame | null = null;
    for (const f of frames) {
      if (this.skip) break;
      await this.show(f, prev);
      prev = f;
    }
    if (frames.length) this.show(frames[frames.length - 1], prev, true);
    this.finish();
  }

  private pos(f: CombatFrame) {
    const map = new Map<number, { u: CombatFrameUnit; x: number; y: number }>();
    const mine = f.sides[this.me];
    const theirs = f.sides[1 - this.me];
    mine.forEach((u, i) => map.set(u.id, { u, x: rowX(i, mine.length), y: MY_Y }));
    theirs.forEach((u, i) => map.set(u.id, { u, x: rowX(i, theirs.length), y: ENEMY_Y }));
    return map;
  }

  private float(x: number, y: number, text: string, cls: string) {
    const d = document.createElement('div');
    d.className = `float-num ${cls}`;
    d.textContent = text;
    d.style.left = `${x + 70}px`;
    d.style.top = `${y + 70}px`;
    this.layer.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  private async show(f: CombatFrame, prev: CombatFrame | null, instant = false) {
    const pos = this.pos(f);
    const prevPos = prev ? this.pos(prev) : new Map();
    // remove dead
    for (const [id, el] of this.els) {
      if (!pos.has(id)) {
        el.classList.add('dying');
        this.els.delete(id);
        setTimeout(() => el.remove(), 380);
      }
    }
    // add / update
    for (const [id, { u, x, y }] of pos) {
      const html = cardHtml(frameUnitView(u), { zone: 'combat', idx: 0, x, y, id });
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild as HTMLElement;
      let el = this.els.get(id);
      if (!el) {
        el = fresh;
        el.classList.add('spawn');
        el.style.pointerEvents = 'none';
        this.layer.appendChild(el);
        this.els.set(id, el);
      } else {
        el.className = fresh.className;
        el.innerHTML = fresh.innerHTML;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      const before = prevPos.get(id)?.u;
      if (before && !instant) {
        if (u.hp < before.hp) this.float(x, y, `-${before.hp - u.hp}`, 'dmg');
        else if (u.hp > before.hp || u.atk > before.atk) this.float(x, y, `+${u.atk - before.atk}/+${u.hp - before.hp}`, 'buff');
        if (before.kw.includes('divineShield') && !u.kw.includes('divineShield')) this.float(x, y - 20, '✦', 'buff');
      }
    }
    if (instant) return;
    const wait = DUR[f.kind] / this.speed;
    if (f.kind === 'attack' && f.attacker !== undefined && f.target !== undefined) {
      const a = this.els.get(f.attacker);
      const t = this.els.get(f.target);
      if (a && t) {
        const dx = parseFloat(t.style.left) - parseFloat(a.style.left);
        const dy = parseFloat(t.style.top) - parseFloat(a.style.top);
        a.style.zIndex = '20';
        const anim = a.animate(
          [{ transform: 'none' }, { transform: `translate(${dx * 0.2}px, ${dy * 0.2 - (dy > 0 ? -10 : 10)}px) scale(1.1)`, offset: 0.35 },
            { transform: `translate(${dx * 0.82}px, ${dy * 0.82}px) scale(1.06)`, offset: 0.6 }, { transform: 'none' }],
          { duration: wait, easing: 'ease-in-out' });
        await anim.finished.catch(() => undefined);
        a.style.zIndex = '';
        return;
      }
    }
    if (f.kind === 'trigger' && f.note) {
      const src = f.source !== undefined ? this.els.get(f.source) : undefined;
      const n = document.createElement('div');
      n.className = 'trigger-note';
      n.textContent = f.note;
      n.style.left = src ? `${parseFloat(src.style.left) + 70}px` : '800px';
      n.style.top = src ? `${parseFloat(src.style.top) - 30}px` : '420px';
      this.layer.appendChild(n);
      setTimeout(() => n.remove(), 1100);
    }
    await sleep(wait);
  }

  private finish() {
    const r = this.r;
    const myWin = r.winner === this.me;
    const tie = r.winner === -1;
    const me = this.g.players[0];
    const b = document.createElement('div');
    b.className = `result-banner ${!tie && !myWin ? 'lose' : ''}`;
    b.innerHTML = `<h2>${tie ? 'Draw' : myWin ? 'Victory' : 'Defeat'}</h2>
      <p>${tie ? 'No damage dealt.' : myWin ? `You dealt ${r.damage} damage.` : `You took ${r.damage} damage. ${me.health > 0 ? `${me.health} Health left.` : ''}`}</p>
      <button class="btn big primary">Continue</button>`;
    this.stage.appendChild(b);
    b.querySelector('button')!.addEventListener('click', () => this.done());
  }
}
