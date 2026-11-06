import { SAVE_VERSION } from '../engine/game';
import type { GameState } from '../engine/types';

const KEY = 'torrekin-save';

export function save(g: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* storage unavailable (private mode) — the game still works, it just won't resume */
  }
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as GameState;
    return g.version === SAVE_VERSION ? g : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
