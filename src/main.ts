import '@fontsource/amaranth/latin-400.css';
import '@fontsource/amaranth/latin-400-italic.css';
import '@fontsource/amaranth/latin-700.css';
import '@fontsource/grenze/latin-400.css';
import '@fontsource/grenze/latin-500.css';
import '@fontsource/grenze/latin-600.css';
import '@fontsource/grenze/latin-700.css';
import '@fontsource/grenze/latin-800.css';
import './ui/styles.css';
import { installDebug } from './ui/debug';
import { App } from './ui/app';
import { preloadArt } from './ui/view';
import { initUpdates } from './ui/update';
import { currentLayout, getMode, onLayoutChange, room } from './ui/layout';
import type { GameState } from './engine/types';

declare const __NO_UPDATES__: boolean;

interface Hot {
  ready?: (start: (data: { g?: GameState; screen?: string }) => void) => void;
  data?: { g?: GameState; screen?: string };
  snapshot?: (fn: () => unknown) => void;
}
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

installDebug();

const stage = document.getElementById('stage')!;

let lastSize: string | null = null;
/** the space inside the safe area (the viewport's padding keeps clear of notches and system bars) */
const viewport = document.getElementById('viewport')!;
function measure() {
  const cs = getComputedStyle(viewport);
  room.w = Math.max(1, viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  room.h = Math.max(1, viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
}
function fit() {
  measure();
  const L = currentLayout();
  stage.style.width = `${L.W}px`;
  stage.style.height = `${L.H}px`;
  const s = Math.min(room.w / L.W, room.h / L.H);
  stage.style.transform = `scale(${s})`;
  const size = `${L.W}x${L.H}`;
  const changed = lastSize !== null && lastSize !== size;
  lastSize = size;
  return changed;
}
// Phones are laid out for portrait. A phone held sideways gets a prompt to turn it (desktops and
// tablets are unaffected, and choosing a layout in Options turns the prompt off).
const rotate = document.createElement('div');
rotate.id = 'rotate-prompt';
rotate.innerHTML = `<div class="rp-icon">📱</div><div class="rp-title">Turn your phone upright</div>
  <div class="rp-text">Torrekin is laid out for portrait on phones, so everything is big enough to read and tap.</div>
  <button class="btn" type="button">Play sideways anyway</button>`;
document.body.appendChild(rotate);
let sidewaysOk = false;
try { sidewaysOk = sessionStorage.getItem('torrekin-sideways') === '1'; } catch { /* ignore */ }
rotate.querySelector('button')!.addEventListener('click', () => {
  sidewaysOk = true;
  try { sessionStorage.setItem('torrekin-sideways', '1'); } catch { /* ignore */ }
  checkRotate();
});
function checkRotate() {
  const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 520;
  rotate.classList.toggle('show', phone && window.innerWidth > window.innerHeight && getMode() === 'auto' && !sidewaysOk);
}
checkRotate();
window.addEventListener('resize', () => { checkRotate(); if (fit()) appRef?.render(); });
fit();
let appRef: App | null = null;
onLayoutChange(() => { checkRotate(); fit(); appRef?.render(); });

function start(data: { g?: GameState; screen?: string } = {}) {
  const app = new App(stage);
  appRef = app;
  (window as unknown as { torrekin: App }).torrekin = app;
  // when the page is updated while open in Claude, keep the game going
  if (data.g) app.resume(data.g);
  hot?.snapshot?.(() => ({ g: app.g, screen: app.screen }));
  setTimeout(preloadArt, 400); // card and hero art, in the background
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});

if (!__NO_UPDATES__) initUpdates();
