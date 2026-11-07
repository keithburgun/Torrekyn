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

/** The night-sky backdrop tiles to fit any screen shape, so it no longer moves; this just clears old inline sizing. */
export function placeBoardBg(stage: HTMLElement, _L: Layout, _centerY: number | null) {
  stage.style.backgroundSize = '';
  stage.style.backgroundPosition = '';
}
