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
import type { GameState } from './engine/types';

declare const __ARTIFACT__: boolean;

interface Hot {
  ready?: (start: (data: { g?: GameState; screen?: string }) => void) => void;
  data?: { g?: GameState; screen?: string };
  snapshot?: (fn: () => unknown) => void;
}
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

const stage = document.getElementById('stage')!;

function fit() {
  const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
  stage.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

function start(data: { g?: GameState; screen?: string } = {}) {
  const app = new App(stage);
  (window as unknown as { torrekin: App }).torrekin = app;
  // when the page is updated while open in Claude, keep the game going
  if (data.g) app.resume(data.g);
  hot?.snapshot?.(() => ({ g: app.g, screen: app.screen }));
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});

if (!__ARTIFACT__) initUpdates();
