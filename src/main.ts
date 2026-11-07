import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './ui/styles.css';
import { App } from './ui/app';
import { initUpdates } from './ui/update';
import { isMuted, onMuteChange, setMuted } from './ui/sfx';
import { currentLayout, onLayoutChange } from './ui/layout';
import type { GameState } from './engine/types';

declare const __ARTIFACT__: boolean;

interface Hot {
  ready?: (start: (data: { g?: GameState; screen?: string }) => void) => void;
  data?: { g?: GameState; screen?: string };
  snapshot?: (fn: () => unknown) => void;
}
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

const stage = document.getElementById('stage')!;

let lastSize: string | null = null;
function fit() {
  const L = currentLayout();
  stage.style.width = `${L.W}px`;
  stage.style.height = `${L.H}px`;
  const s = Math.min(window.innerWidth / L.W, window.innerHeight / L.H);
  stage.style.transform = `scale(${s})`;
  const size = `${L.W}x${L.H}`;
  const changed = lastSize !== null && lastSize !== size;
  lastSize = size;
  return changed;
}
window.addEventListener('resize', () => { if (fit()) appRef?.render(); });
fit();
let appRef: App | null = null;
onLayoutChange(() => { fit(); appRef?.render(); });

function start(data: { g?: GameState; screen?: string } = {}) {
  const app = new App(stage);
  appRef = app;
  (window as unknown as { torrekin: App }).torrekin = app;
  // when the page is updated while open in Claude, keep the game going
  if (data.g) app.resume(data.g);
  hot?.snapshot?.(() => ({ g: app.g, screen: app.screen }));
}

// mute button, top-right on every screen
const muteBtn = document.createElement('button');
muteBtn.id = 'mute-btn';
const paintMute = (m: boolean) => {
  muteBtn.textContent = m ? '🔇' : '🔊';
  muteBtn.title = m ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  muteBtn.classList.toggle('muted', m);
};
paintMute(isMuted());
onMuteChange(paintMute);
muteBtn.addEventListener('click', () => setMuted(!isMuted()));
document.body.appendChild(muteBtn);

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});

if (!__ARTIFACT__) initUpdates();
