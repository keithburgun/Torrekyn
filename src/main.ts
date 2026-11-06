import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './ui/styles.css';
import { App } from './ui/app';
import { initUpdates } from './ui/update';

const stage = document.getElementById('stage')!;

function fit() {
  const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
  stage.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

const app = new App(stage);
(window as unknown as { torrekin: App }).torrekin = app;
initUpdates();
