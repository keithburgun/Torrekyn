/**
 * The triple ceremony (inspired by Battlegrounds): the three copies rush together, spin and merge in a
 * flash, the Golden card is revealed in a burst of light with a "TRIPLE!" banner, then it flies into
 * your hand. Click anywhere to hurry it along.
 */
import { CONFIG, def } from '../engine/core';
import type { Keyword } from '../engine/types';
import type { Layout } from './layout';
import { sfx } from './sfx';
import { bigCardHtml, cardHtml, esc } from './view';

interface Pos { x: number; y: number }
interface View { cardId: string; golden: boolean; atk: number; hp: number; kw: Keyword[] }

const wait = (ms: number, skip: { on: boolean }) => new Promise<void>((res) => {
  const t0 = performance.now();
  const tick = () => (skip.on || performance.now() - t0 >= ms ? res() : requestAnimationFrame(tick));
  tick();
});

export async function playTriple(stage: HTMLElement, L: Layout, cardId: string, sources: Pos[], golden: View, handEl: HTMLElement | null, tier: number) {
  const d = def(cardId);
  const skip = { on: false };
  const ov = document.createElement('div');
  ov.className = 'triple-overlay';
  ov.addEventListener('click', () => { skip.on = true; });
  stage.appendChild(ov);
  if (handEl) handEl.style.visibility = 'hidden';

  const cx = L.cx;
  const cy = L.H * 0.43;
  const base: View = { cardId, golden: false, atk: d.atk, hp: d.hp, kw: [...d.keywords] };

  // 1. the three copies appear where they were and rush to the centre
  sfx.tripleCharge();
  const clones = sources.map((s, i) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHtml(base, { zone: 'fx', idx: i, x: s.x, y: s.y, small: L.small });
    const el = tmp.firstElementChild as HTMLElement;
    el.style.zIndex = '2';
    el.style.transition = 'none';
    ov.appendChild(el);
    return el;
  });
  const anims = clones.map((el, i) => {
    const sx = parseFloat(el.style.left) + L.cardW / 2;
    const sy = parseFloat(el.style.top) + L.cardH / 2;
    const dx = cx - sx + (i - 1) * 46;
    const dy = cy - sy;
    return el.animate(
      [
        { transform: 'translate(0,0) rotate(0) scale(1)', filter: 'brightness(1)' },
        { transform: `translate(${dx * 0.15}px, ${dy * 0.15 - 30}px) rotate(${(i - 1) * -8}deg) scale(1.08)`, offset: 0.25 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${(i - 1) * 14}deg) scale(1.15)`, filter: 'brightness(1.6) drop-shadow(0 0 22px #ffd36a)' },
      ],
      { duration: skip.on ? 1 : 700, easing: 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards', delay: i * 60 },
    ).finished;
  });
  await Promise.all(anims).catch(() => undefined);

  // 2. spin together and merge
  const merge = clones.map((el, i) => el.animate(
    [{ opacity: 1 }, { transform: `${getComputedStyle(el).transform === 'none' ? '' : getComputedStyle(el).transform} rotate(${180 + i * 60}deg) scale(.4)`, opacity: 0 }],
    { duration: skip.on ? 1 : 320, easing: 'ease-in', fill: 'forwards' },
  ).finished);
  await Promise.all(merge).catch(() => undefined);
  clones.forEach((c) => c.remove());

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
  ov.appendChild(card);
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
  if (handEl) to = { x: parseFloat(handEl.style.left) + 60, y: parseFloat(handEl.style.top) + 82 };
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
