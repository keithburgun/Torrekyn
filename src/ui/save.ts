import { SAVE_VERSION } from '../engine/game';
import type { GameState } from '../engine/types';
import { store } from '../save/store';

const KEY = 'torrekin-save';

/** the game in progress (synced, so you can continue on another device) */
export function save(g: GameState) {
  store.setJSON(KEY, g);
}

export function loadSave(): GameState | null {
  const g = store.getJSON<GameState>(KEY);
  return g && g.version === SAVE_VERSION ? g : null;
}

export function clearSave() {
  store.remove(KEY);
}
