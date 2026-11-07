/**
 * Scene transitions. They play on a layer above the stage (same size and position), so the screen
 * underneath can be swapped while it is covered. Tap to hurry them along.
 *  - battleIntro: shop -> battle. The two heroes slam in from top and bottom, "VS", the round banner.
 *  - recruitWipe: battle -> shop. A quick sweep with the next round's number.
 */
import { esc, heroArt } from './view';
import { sfx } from './sfx';

interface Who { hero?: string; name: string; health: number; sub?: string }

function layer(stage: HTMLElement, cls: string) {
  const r = stage.getBoundingClientRect();
  const w = stage.offsetWidth;
  const h = stage.offsetHeight;
  const el = document.createElement('div');
  el.className = `scene-tx ${cls} ${stage.classList.contains('portrait') ? 'portrait' : ''}`;
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.transform = `scale(${r.width / w})`;
  document.body.appendChild(el);
  return el;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** wait that can be cut short by a tap */
function waiter(el: HTMLElement) {
  let hurry = false;
  el.addEventListener('pointerdown', () => { hurry = true; el.classList.add('hurry'); });
  return (ms: number) => new Promise<void>((res) => {
    const t0 = performance.now();
    const tick = () => (hurry || performance.now() - t0 >= ms ? res() : requestAnimationFrame(tick));
    tick();
  });
}

/** Shop -> battle. `swap` runs while the screen is fully covered (build the battle scene then). */
export async function battleIntro(stage: HTMLElement, me: Who, opp: Who, round: number, ghost: boolean, swap: () => void) {
  const el = layer(stage, 'battle');
  const wait = waiter(el);
  const side = (w: Who, cls: string, label: string) => `<div class="tx-panel ${cls}"><div class="tx-hero">
    <div class="tx-portrait" style="background-image:url('${heroArt(w.hero)}')"><span class="tx-hp">${Math.max(0, w.health)}</span></div>
    <div class="tx-name"><small>${label}</small>${esc(w.name)}${w.sub ? `<em>${esc(w.sub)}</em>` : ''}</div></div></div>`;
  el.innerHTML = `${side(opp, 'enemy', ghost ? 'Ghost' : 'Opponent')}${side(me, 'mine', 'You')}
    <div class="tx-seam"></div><div class="tx-flash"></div>
    <div class="tx-vs">VS</div><div class="tx-round">Round ${round}</div><div class="tx-go">Battle!</div>`;
  if (reduced()) el.classList.add('instant');
  sfx.battle();
  await wait(440); // panels meet
  stage.classList.add('tx-shake');
  setTimeout(() => stage.classList.remove('tx-shake'), 420);
  await wait(260);
  swap(); // battle scene is built underneath
  await wait(900);
  el.classList.add('out');
  await new Promise((r) => setTimeout(r, reduced() ? 10 : 480));
  el.remove();
}

/** Battle -> shop. `swap` runs while covered (render the shop then). */
export async function recruitWipe(stage: HTMLElement, round: number, swap: () => void) {
  const el = layer(stage, 'recruit');
  const wait = waiter(el);
  el.innerHTML = `<div class="tx-band"><div class="tx-round">Round ${round}</div><div class="tx-go">Recruit</div></div>`;
  if (reduced()) el.classList.add('instant');
  sfx.whoosh();
  await wait(360);
  swap();
  await wait(520);
  el.classList.add('out');
  await new Promise((r) => setTimeout(r, reduced() ? 10 : 380));
  el.remove();
}
