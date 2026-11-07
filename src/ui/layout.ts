/**
 * Screen layouts. Landscape mirrors Hearthstone: Battlegrounds on PC; portrait stacks the same pieces
 * for phones held upright. All numbers are in stage pixels (the stage is scaled to fit the window).
 */
export type LayoutMode = 'auto' | 'landscape' | 'portrait';

export interface Layout {
  portrait: boolean;
  W: number;
  H: number;
  cx: number; // horizontal centre
  small: boolean; // use small cards on the board and in the shop
  cardW: number;
  cardH: number;
  slotX(i: number): number;
  slotW: number;
  slotTop: number;
  slotH: number;
  boardY: number;
  shopY: number;
  shopStep: number;
  tavernY: number;
  heroY: number; // centre of your hero portrait
  handY: number;
  handWidth: number;
  shopDrop: number; // drag above this to sell / below it to buy
  boardTop: number;
  boardBottom: number;
  leader: { x: number; y: number; w: number; h: number; horizontal: boolean };
  endTurn: { x: number; y: number };
  gold: { x: number; y: number };
  gear: { x: number; y: number };
  tribes: { x: number; y: number; w: number };
  targetBar: { x: number; y: number; w: number };
  popover: 'beside' | 'dock';
  dockY: number;
  combat: { enemyY: number; myY: number; enemyHero: { x: number; y: number }; myHero: { x: number; y: number }; banner: number; step: number };
}

export const LANDSCAPE: Layout = {
  portrait: false, W: 1600, H: 900, cx: 800, small: false, cardW: 140, cardH: 190,
  slotX: (i) => 263 + i * 154, slotW: 150, slotTop: 382, slotH: 236,
  boardY: 398, shopY: 160, shopStep: 152, tavernY: 14,
  heroY: 680, handY: 770, handWidth: 1040,
  shopDrop: 372, boardTop: 372, boardBottom: 625,
  leader: { x: 14, y: 14, w: 228, h: 800, horizontal: false },
  endTurn: { x: 1410, y: 360 }, gold: { x: 1150, y: 812 }, gear: { x: 1540, y: 842 },
  tribes: { x: 14, y: 826, w: 228 },
  targetBar: { x: 250, y: 640, w: 440 },
  popover: 'beside', dockY: 0,
  combat: { enemyY: 168, myY: 452, enemyHero: { x: 800, y: 62 }, myHero: { x: 800, y: 742 }, banner: 411, step: 154 },
};

export const PORTRAIT: Layout = {
  portrait: true, W: 900, H: 1600, cx: 450, small: true, cardW: 120, cardH: 165,
  slotX: (i) => 17 + i * 124, slotW: 122, slotTop: 560, slotH: 214,
  boardY: 576, shopY: 340, shopStep: 132, tavernY: 150,
  heroY: 880, handY: 1020, handWidth: 860,
  shopDrop: 548, boardTop: 548, boardBottom: 790,
  leader: { x: 10, y: 10, w: 760, h: 120, horizontal: true },
  endTurn: { x: 690, y: 846 }, gold: { x: 36, y: 846 }, gear: { x: 840, y: 1540 },
  tribes: { x: 36, y: 920, w: 220 },
  targetBar: { x: 230, y: 1210, w: 440 },
  popover: 'dock', dockY: 1192,
  combat: { enemyY: 420, myY: 840, enemyHero: { x: 450, y: 250 }, myHero: { x: 450, y: 1150 }, banner: 712, step: 124 },
};

let mode: LayoutMode = 'auto';
try { mode = (localStorage.getItem('torrekin-layout') as LayoutMode) || 'auto'; } catch { /* storage unavailable */ }
const listeners = new Set<() => void>();

export function getMode(): LayoutMode { return mode; }
export function setMode(m: LayoutMode) {
  mode = m;
  try { localStorage.setItem('torrekin-layout', m); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}
export function onLayoutChange(f: () => void) { listeners.add(f); }

export function currentLayout(): Layout {
  if (mode === 'portrait') return PORTRAIT;
  if (mode === 'landscape') return LANDSCAPE;
  return window.innerHeight > window.innerWidth * 1.1 ? PORTRAIT : LANDSCAPE;
}
