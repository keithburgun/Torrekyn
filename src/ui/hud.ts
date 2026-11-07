/**
 * The mute button lives on the game canvas (top-right corner) on every screen, so it scales with the
 * game and never floats outside it. Screens re-render the canvas, so they call placeHud() afterwards.
 */
import { isMuted, onMuteChange, setMuted } from './sfx';
import type { Layout } from './layout';

const muteBtn = document.createElement('button');
muteBtn.id = 'mute-btn';
const paint = (m: boolean) => {
  muteBtn.textContent = m ? '🔇' : '🔊';
  muteBtn.title = m ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  muteBtn.classList.toggle('muted', m);
};
paint(isMuted());
onMuteChange(paint);
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); setMuted(!isMuted()); });

export function placeHud(stage: HTMLElement, L: Layout) {
  muteBtn.style.left = `${L.mute.x}px`;
  muteBtn.style.top = `${L.mute.y}px`;
  muteBtn.style.width = muteBtn.style.height = `${L.mute.size}px`;
  muteBtn.style.fontSize = `${Math.round(L.mute.size * 0.45)}px`;
  stage.appendChild(muteBtn);
}

/**
 * Centres the board art's arena on the army (shop) or between the two armies (combat). The art is drawn
 * for landscape; on tall portrait screens it is enlarged a little so the arena can be moved.
 */
export function placeBoardBg(stage: HTMLElement, L: Layout, centerY: number | null) {
  if (!L.portrait || centerY === null) {
    stage.style.backgroundSize = '';
    stage.style.backgroundPosition = '';
    return;
  }
  const h = L.H * 1.3;
  const top = Math.min(0, Math.max(L.H - h, centerY - h / 2));
  stage.style.backgroundSize = `auto ${Math.round(h)}px`;
  stage.style.backgroundPosition = `center ${Math.round(top)}px`;
}
