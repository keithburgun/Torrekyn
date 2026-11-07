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
  small: boolean; // use small cards on the board (and in combat)
  cardW: number; // board / combat card size
  cardH: number;
  shopBig: boolean; // large cards in the shop and hand (portrait)
  shopCardW: number;
  shopCardH: number;
  handCardW: number;
  handCardH: number;
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
  leader: { x: number; y: number; w: number; h: number; horizontal: boolean; grid?: boolean };
  /** tall phone screens (iPhone-shaped): two-row leaderboard and a bigger hero */
  tall?: boolean;
  endTurn: { x: number; y: number };
  gold: { x: number; y: number };
  gear: { x: number; y: number; size: number };
  mute: { x: number; y: number; size: number };
  tribes: { x: number; y: number; w: number };
  cardsBtn: { x: number; y: number };
  targetBar: { x: number; y: number; w: number };
  /** beside: to the right/left of the card (landscape); stack: above/below it (portrait) */
  popover: 'beside' | 'stack';
  combat: { enemyY: number; myY: number; enemyHero: { x: number; y: number }; myHero: { x: number; y: number }; banner: number; step: number };
}

export const LANDSCAPE: Layout = {
  portrait: false, W: 1600, H: 900, cx: 800, small: false, cardW: 140, cardH: 190,
  shopBig: false, shopCardW: 140, shopCardH: 190, handCardW: 120, handCardH: 165,
  slotX: (i) => 263 + i * 154, slotW: 150, slotTop: 382, slotH: 236,
  boardY: 398, shopY: 160, shopStep: 152, tavernY: 14,
  heroY: 680, handY: 770, handWidth: 1040,
  shopDrop: 372, boardTop: 372, boardBottom: 625,
  leader: { x: 14, y: 14, w: 228, h: 800, horizontal: false },
  endTurn: { x: 1410, y: 360 }, gold: { x: 1150, y: 812 }, gear: { x: 1494, y: 12, size: 44 }, mute: { x: 1546, y: 12, size: 44 },
  tribes: { x: 14, y: 826, w: 228 },
  cardsBtn: { x: 1436, y: 470 },
  targetBar: { x: 250, y: 640, w: 440 },
  popover: 'beside',
  combat: { enemyY: 168, myY: 452, enemyHero: { x: 800, y: 62 }, myHero: { x: 800, y: 742 }, banner: 411, step: 154 },
};

/**
 * Portrait: sections are stacked top to bottom with fixed sizes, and whatever height is left over is
 * shared evenly between them, so nothing pools at the bottom. The stage is always 900 wide; its height
 * follows the screen's shape (1300 to 2000 stage pixels; an iPhone is about 1950). On tall screens the
 * leaderboard gets two rows with names and Health, and your hero gets bigger.
 */
export const IPHONE_H = 1950; // 900 x 1950 = 9 : 19.5, the shape of a modern iPhone screen

export function portraitLayout(H: number): Layout {
  const W = 900;
  const tall = H >= 1750;
  const sizes = { leader: tall ? 236 : 140, tavern: 150, shop: 228, board: 214, hero: tall ? 210 : 170, hand: 228 };
  const top = tall ? 16 : 10;
  const fixed = top + Object.values(sizes).reduce((a, b) => a + b, 0) + (tall ? 40 : 24);
  const gap = Math.max(12, (H - fixed) / 5);
  let y = top;
  const leaderY = y; y += sizes.leader + gap;
  const tavernY = y; y += sizes.tavern + gap;
  const shopY = y + 6; y += sizes.shop + gap;
  const slotTop = y; y += sizes.board + gap;
  const heroTop = y; y += sizes.hero + gap;
  const handY = y;
  const heroMid = heroTop + sizes.hero / 2;
  return {
    portrait: true, tall, W, H, cx: 450, small: true, cardW: 120, cardH: 165,
    shopBig: true, shopCardW: 168, shopCardH: 228, handCardW: 168, handCardH: 228,
    slotX: (i) => 17 + i * 124, slotW: 122, slotTop, slotH: sizes.board,
    boardY: slotTop + 16, shopY, shopStep: 176, tavernY,
    heroY: heroMid, handY, handWidth: 880,
    shopDrop: slotTop - 14, boardTop: slotTop - 14, boardBottom: slotTop + sizes.board + 10,
    leader: { x: 10, y: leaderY, w: tall ? 800 : 760, h: sizes.leader, horizontal: true, grid: tall },
    endTurn: { x: 696, y: heroMid - 57 }, gold: { x: 30, y: heroMid - 67 },
    gear: { x: 828, y: leaderY + 76, size: 58 }, mute: { x: 828, y: leaderY + 8, size: 58 },
    tribes: { x: 30, y: heroMid + 19, w: 210 },
    cardsBtn: { x: 720, y: heroMid + 33 },
    targetBar: { x: 230, y: slotTop + sizes.board + 2, w: 440 },
    popover: 'stack',
    // on tall screens the whole fight sits a little lower so it is centred rather than top-heavy
    combat: ((o) => ({
      enemyHero: { x: 450, y: Math.round(H * (0.13 + o)) }, enemyY: Math.round(H * (0.27 + o)), banner: Math.round(H * (0.44 + o)),
      myY: Math.round(H * (0.52 + o)), myHero: { x: 450, y: Math.round(H * (0.76 + o)) }, step: 124,
    }))(tall ? 0.045 : 0),
  };
}

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
  const portrait = mode === 'portrait' || (mode === 'auto' && window.innerHeight > window.innerWidth * 1.1);
  if (!portrait) return LANDSCAPE;
  // the Portrait toggle on a wide screen previews an iPhone-shaped screen; a real portrait screen uses its own shape
  const winH = 900 * (window.innerHeight / window.innerWidth);
  const H = mode === 'portrait' && window.innerHeight <= window.innerWidth * 1.1 ? IPHONE_H : Math.round(Math.min(2000, Math.max(1300, winH)));
  return portraitLayout(H);
}
