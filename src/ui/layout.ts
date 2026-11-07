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
  large?: boolean; // use large cards in combat (phones, small armies)
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
  leader: { x: number; y: number; w: number; h: number; horizontal: boolean };
  /** tall phone screens (iPhone-shaped): a little more room for everything */
  tall?: boolean;
  /** phone-only pieces (portrait): sizes chosen for touch, see portraitLayout */
  phone?: {
    tavern: { kp: number; btn: number; up: number; refresh: number; freeze: number; btnTop: number };
    heroSize: number;
    pillY: number;
    trinket: { x: number; y: number; size: number; step: number };
    quest: { x: number; y: number; w: number };
    turnLabel: { x: number; y: number; w: number };
    endTurnW: number;
    cardsW: number;
    tribesH: number;
  };
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
 * Portrait is the phone layout. On a phone the 900-pixel-wide stage is shown about 390 points wide, so
 * one point is roughly 2.3 stage pixels. Everything here follows phone guidelines at that scale:
 * touch targets of at least 44 points (about 100 stage pixels) and text of at least 11 points (26 px).
 *
 * Sections are stacked top to bottom with fixed sizes and the leftover height is shared evenly between
 * them. The stage height follows the screen's shape (1400 to 2000; a full-screen iPhone is about 1950,
 * Safari's visible area about 1500). Tall screens get slightly bigger tavern and hero rows.
 */
export const IPHONE_H = 1950; // 900 x 1950 = 9 : 19.5, the shape of a modern iPhone screen

export function portraitLayout(H: number): Layout {
  const W = 900;
  const tall = H >= 1750;
  const sizes = { strip: tall ? 196 : 184, tavern: tall ? 222 : 192, shop: 228, board: 214, hero: tall ? 290 : 250, hand: 228 };
  const top = 10;
  const tripTag = 26; // room above the shop for the "TRIPLE!" tag
  const fixed = top + tripTag + Object.values(sizes).reduce((a, b) => a + b, 0) + 16;
  const gap = Math.max(10, (H - fixed) / 5);
  let y = top;
  const stripY = y; y += sizes.strip + gap;
  const tavernY = y; y += sizes.tavern + gap + tripTag;
  const shopY = y; y += sizes.shop + gap;
  const slotTop = y; y += sizes.board + gap;
  const heroTop = y; y += sizes.hero + gap;
  const handY = Math.min(y, H - sizes.hand - 16);
  const heroSize = tall ? 200 : 170;
  const kp = tall ? 172 : 150;
  const btn = tall ? 128 : 116;
  const btnSize = 88;
  return {
    portrait: true, tall, W, H, cx: 450, small: true, cardW: 120, cardH: 165,
    shopBig: true, shopCardW: 168, shopCardH: 228, handCardW: 168, handCardH: 228,
    slotX: (i) => 17 + i * 124, slotW: 122, slotTop, slotH: sizes.board,
    boardY: slotTop + 16, shopY, shopStep: 176, tavernY,
    heroY: heroTop + 4 + heroSize / 2, handY, handWidth: 880,
    shopDrop: slotTop - 14, boardTop: slotTop - 14, boardBottom: slotTop + sizes.board + 10,
    leader: { x: 10, y: stripY, w: 790, h: sizes.strip, horizontal: true },
    endTurn: { x: 626, y: heroTop + 38 }, gold: { x: 22, y: heroTop + 2 },
    gear: { x: 808, y: stripY + btnSize + 8, size: btnSize }, mute: { x: 808, y: stripY, size: btnSize },
    tribes: { x: 22, y: heroTop + sizes.hero - 100, w: 236 },
    cardsBtn: { x: 626, y: heroTop + sizes.hero - 100 },
    targetBar: { x: 40, y: slotTop + sizes.board + 4, w: 820 },
    popover: 'stack',
    phone: {
      tavern: { kp, btn, up: 450 - 228, refresh: 450 + 172, freeze: 450 + 312, btnTop: tavernY + kp / 2 - btn / 2 },
      heroSize,
      pillY: heroTop + 24 + heroSize,
      trinket: { x: 270, y: heroTop + 10, size: 80, step: 96 },
      quest: { x: 22, y: heroTop + 104, w: 236 },
      turnLabel: { x: 626, y: heroTop, w: 252 },
      endTurnW: 252,
      cardsW: 252,
      tribesH: 100,
    },
    // on tall screens the whole fight sits a little lower so it is centred rather than top-heavy
    combat: ((o) => ({
      enemyHero: { x: 450, y: Math.round(H * (0.12 + o)) }, enemyY: Math.round(H * (0.26 + o)), banner: Math.round(H * (0.44 + o)),
      myY: Math.round(H * (0.52 + o)), myHero: { x: 450, y: Math.round(H * (0.76 + o)) }, step: 124,
    }))(tall ? 0.04 : 0),
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

/** usable screen size in CSS pixels (inside notches and system bars); main.ts keeps it current */
export const room = { w: typeof window === 'undefined' ? 1600 : window.innerWidth, h: typeof window === 'undefined' ? 900 : window.innerHeight };

export function currentLayout(): Layout {
  const portrait = mode === 'portrait' || (mode === 'auto' && room.h > room.w * 1.1);
  if (!portrait) return LANDSCAPE;
  // the Portrait toggle on a wide screen previews an iPhone-shaped screen; a real portrait screen uses its own shape
  const winH = 900 * (room.h / room.w);
  const H = mode === 'portrait' && room.h <= room.w * 1.1 ? IPHONE_H : Math.round(Math.min(2000, Math.max(1400, winH)));
  return portraitLayout(H);
}
