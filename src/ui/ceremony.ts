/**
 * The triple ceremony: the card you gained lands in your hand as usual, then the three copies are pulled
 * together, all spinning the same way and turning white, and become one Golden card that slows to a stop as
 * the white fades off it (with a "TRIPLE!" banner), then it goes into your hand. Click to hurry it along.
 */
import { CONFIG, def } from '../engine/core';
import type { Keyword } from '../engine/types';
import type { Layout } from './layout';
import { sfx } from './sfx';
import { bigCardHtml, cardHtml, esc } from './view';

interface Pos { x: number; y: number }
/** where a copy was; `gained`: the copy that just arrived (from the shop, or out of nowhere) */
interface Src extends Pos { gained?: boolean }
interface View { cardId: string; golden: boolean; atk: number; hp: number; kw: Keyword[] }

const wait = (ms: number, skip: { on: boolean }) => new Promise<void>((res) => {
  const t0 = performance.now();
  const tick = () => (skip.on || performance.now() - t0 >= ms ? res() : requestAnimationFrame(tick));
  tick();
});

export async function playTriple(stage: HTMLElement, L: Layout, cardId: string, sources: Src[], golden: View, handEl: HTMLElement | null, tier: number) {
  const d = def(cardId);
  const skip = { on: false };
  const ms = (n: number) => (skip.on ? 1 : n);
  const ov = document.createElement('div');
  ov.className = 'triple-overlay';
  ov.addEventListener('click', () => { skip.on = true; });
  stage.appendChild(ov);
  if (handEl) handEl.style.visibility = 'hidden';

  const cx = L.cx;
  const cy = L.H * 0.43;
  const base: View = { cardId, golden: false, atk: d.atk, hp: d.hp, kw: [...d.keywords] };
  // where the Golden card sits in your hand (the card you just gained lands there first, like any card you gain)
  const handSpot = handEl ? { x: parseFloat(handEl.style.left), y: parseFloat(handEl.style.top) } : { x: cx - L.cardW / 2, y: L.H - L.cardH - 20 };

  const clones = sources.map((s, i) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHtml(base, { zone: 'fx', idx: i, x: s.x, y: s.y, small: L.small });
    const el = tmp.firstElementChild as HTMLElement;
    el.style.zIndex = '2';
    el.style.transition = 'none';
    const white = document.createElement('div');
    white.className = 'whiteout';
    el.appendChild(white);
    ov.appendChild(el);
    return el;
  });

  // 1. the copy you just gained (bought, or added to your hand) arrives in your hand normally
  const gained = sources.map((s, i) => (s.gained ? i : -1)).filter((i) => i >= 0);
  if (gained.length) {
    await Promise.all(gained.map((i) => {
      const el = clones[i];
      const s = sources[i];
      el.style.left = `${handSpot.x}px`;
      el.style.top = `${handSpot.y}px`;
      return el.animate([{ translate: `${s.x - handSpot.x}px ${s.y - handSpot.y}px` }, { translate: '0px 0px' }],
        { duration: ms(380), easing: 'cubic-bezier(.3,.8,.35,1)', fill: 'backwards' }).finished.catch(() => undefined);
    }));
    sfx.deploy();
    await wait(260, skip);
  }

  // 2. the three copies are pulled together, all spinning the same way, faster and faster, turning white
  sfx.tripleCharge();
  const grow = 236 / L.cardW;
  const pull = ms(900);
  await Promise.all(clones.map((el) => {
    const sx = parseFloat(el.style.left) + L.cardW / 2;
    const sy = parseFloat(el.style.top) + L.cardH / 2;
    (el.querySelector('.whiteout') as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: pull, easing: 'ease-in', fill: 'forwards' });
    return el.animate(
      [
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', filter: 'drop-shadow(0 0 0 rgba(255,255,255,0))' },
        { transform: `translate(${cx - sx}px, ${cy - sy}px) rotate(900deg) scale(${grow})`, filter: 'drop-shadow(0 0 26px #fff)' },
      ],
      { duration: pull, easing: 'cubic-bezier(.55,0,.75,.4)', fill: 'forwards' },
    ).finished.catch(() => undefined);
  }));
  clones.forEach((c) => c.remove());

  // 3. they become one Golden card: still spinning the same way, it slows to a stop as the white fades off it
  // 3. flash, rays, sparks and the Golden card
  sfx.triple();
  const flash = document.createElement('div');
  flash.className = 'triple-flash';
  flash.style.left = `${cx}px`;
  flash.style.top = `${cy}px`;
  ov.appendChild(flash);
  const rays = document.createElement('div');
  rays.className = 'triple-rays';
  rays.style.left = `${cx}px`;
  rays.style.top = `${cy}px`;
  ov.appendChild(rays);
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('div');
    s.className = 'triple-spark';
    const a = Math.random() * Math.PI * 2;
    const dist = 180 + Math.random() * 260;
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
    s.style.animationDelay = `${Math.random() * 120}ms`;
    ov.appendChild(s);
  }
  const card = document.createElement('div');
  card.className = 'triple-card';
  card.style.left = `${cx - 118}px`;
  card.style.top = `${cy - 170}px`;
  card.innerHTML = bigCardHtml(golden);
  const cw = document.createElement('div');
  cw.className = 'whiteout';
  (card.firstElementChild as HTMLElement).appendChild(cw);
  ov.appendChild(card);
  card.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: ms(900), easing: 'cubic-bezier(.15,.75,.3,1)' });
  cw.animate([{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: ms(1000), easing: 'ease-out', fill: 'forwards' });

  const banner = document.createElement('div');
  banner.className = 'triple-banner';
  banner.style.left = `${cx}px`;
  banner.style.top = `${cy - 250}px`;
  banner.innerHTML = `<div class="tb-big">TRIPLE!</div>`;
  ov.appendChild(banner);
  const sub = document.createElement('div');
  sub.className = 'triple-sub';
  sub.style.left = `${cx}px`;
  sub.style.top = `${cy + 196}px`;
  sub.innerHTML = `Golden ${esc(d.name)}<br><span>Play it to Discover a Tier ${Math.min(CONFIG.maxTier, tier + 1)} unit</span>`;
  ov.appendChild(sub);

  await wait(1700, skip);

  // 4. into your hand
  banner.style.opacity = '0';
  sub.style.opacity = '0';
  rays.style.opacity = '0';
  let to = { x: cx, y: L.H - 120 };
  if (handEl) to = { x: parseFloat(handEl.style.left) + handEl.offsetWidth / 2, y: parseFloat(handEl.style.top) + handEl.offsetHeight / 2 };
  await card.animate(
    [{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${to.x - cx}px, ${to.y - cy}px) scale(.45)`, opacity: 0.9 }],
    { duration: 520, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' },
  ).finished.catch(() => undefined);
  ov.classList.add('closing');
  if (handEl) {
    handEl.style.visibility = '';
    handEl.classList.add('buff-flash');
  }
  sfx.deploy();
  await wait(260, { on: false });
  ov.remove();
}
