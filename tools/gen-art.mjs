// Generates placeholder SVG art for every card, the battle board background and hero portraits.
// Output: public/art/cards/<id>.svg, public/art/board.svg, public/art/menu.svg, public/art/heroes/<n>.svg
// Replace any file with your own art (same name, or edit src/data/art.json to point to a .png/.webp).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'src/data/cards.json'), 'utf8'));
// hero-power tokens defined in src/engine/core.ts (not in the spreadsheet)
data.cards.push({ id: 'pumpkin', tribe: 'neutral', tier: 1 }, { id: 'dragon', tribe: 'neutral', tier: 1 });
const outCards = path.join(root, 'public/art/cards');
const outHeroes = path.join(root, 'public/art/heroes');
fs.mkdirSync(outCards, { recursive: true });
fs.mkdirSync(outHeroes, { recursive: true });

function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pastel palettes per tribe: sky gradient (top -> bottom), glow, glyph fill, outline, far/near scenery
const PAL = {
  neverending: { sky: ['#7a4fc4', '#b598ea', '#efe4ff'], glow: '#f3e8ff', glyph: ['#ffffff', '#c3a6f2'], stroke: '#4d2b8c', far: '#a98ade', near: '#8e6ccf', spark: '#f3e8ff' },
  azure: { sky: ['#3f63c9', '#8ea6ea', '#e6edff'], glow: '#ffffff', glyph: ['#ffffff', '#9fb4f0'], stroke: '#22398a', far: '#8aa1e2', near: '#647fd1', spark: '#ffffff' },
  kindred: { sky: ['#ff9cc0', '#ffc4d9', '#fff0f6'], glow: '#fff6cf', glyph: ['#ffffff', '#ffa9c8'], stroke: '#bf4a7b', far: '#f6aec9', near: '#ea91b4', spark: '#fff6cf' },
  brambor: { sky: ['#9a6a3e', '#d0aa82', '#f7ecdf'], glow: '#fff3d6', glyph: ['#ffffff', '#ddb98f'], stroke: '#5e3a17', far: '#c79e74', near: '#a87c52', spark: '#fff3d6' },
  cloister: { sky: ['#3f8a58', '#93cfa4', '#e6f7ea'], glow: '#f4fff0', glyph: ['#ffffff', '#9fd8b0'], stroke: '#1f5632', far: '#86c39a', near: '#5f9f74', spark: '#f4fff0' },
  alcove: { sky: ['#f2be1e', '#fbe07a', '#fffbe2'], glow: '#ffffff', glyph: ['#ffffff', '#ffe27a'], stroke: '#9a7200', far: '#f5d76b', near: '#e8bf3c', spark: '#ffffff' },
  demons: { sky: ['#d94848', '#f2a0a0', '#ffe9e6'], glow: '#fff1e0', glyph: ['#ffffff', '#f5a5a5'], stroke: '#8f1f1f', far: '#ec9898', near: '#d86c6c', spark: '#fff1e0' },
  neutral: { sky: ['#a99cd2', '#d1c8ee', '#f7f3ff'], glow: '#ffffff', glyph: ['#ffffff', '#c8bdf0'], stroke: '#625392', far: '#c5bae8', near: '#ab9ed8', spark: '#ffffff' },
};

// ---------------- glyphs (drawn in a 256 box, centred at 128,128) ----------------
const G = {
  bunny: `<ellipse cx="100" cy="74" rx="20" ry="50" transform="rotate(-12 100 74)"/><ellipse cx="156" cy="74" rx="20" ry="50" transform="rotate(12 156 74)"/><circle cx="128" cy="150" r="62"/><ellipse cx="100" cy="76" rx="8" ry="32" transform="rotate(-12 100 76)" fill="#ffc6e0"/><ellipse cx="156" cy="76" rx="8" ry="32" transform="rotate(12 156 76)" fill="#ffc6e0"/><circle cx="106" cy="146" r="8" class="k"/><circle cx="150" cy="146" r="8" class="k"/><path d="M120 164l8 7 8-7" class="ks"/><circle cx="92" cy="166" r="9" fill="#ffb6d5" opacity=".8"/><circle cx="164" cy="166" r="9" fill="#ffb6d5" opacity=".8"/>`,
  skull: `<path d="M128 52c-38 0-64 26-64 62 0 20 9 34 22 42v22c0 6 5 10 10 10h64c5 0 10-4 10-10v-22c13-8 22-22 22-42 0-36-26-62-64-62z"/><circle cx="104" cy="118" r="15" class="k"/><circle cx="152" cy="118" r="15" class="k"/><path d="M128 136l-9 18h18z" class="k"/><path d="M108 172v16M128 172v16M148 172v16" class="ks"/>`,
  flame: `<path d="M128 40c10 34 52 50 52 100 0 34-24 62-52 62s-52-28-52-62c0-26 14-40 24-52 2 18 8 26 16 30-4-30 2-56 12-78z"/><path d="M128 120c6 16 24 24 24 46 0 16-11 26-24 26s-24-10-24-26c0-14 10-20 14-30 2 10 6 12 10 14z" class="k"/>`,
  hourglass: `<path d="M84 50h88v12c0 30-28 46-28 66s28 36 28 66v12H84v-12c0-30 28-46 28-66S84 92 84 62z"/><path d="M102 74h52c-4 18-26 28-26 40-1-12-22-22-26-40zM128 160c10 10 26 20 28 34h-56c2-14 18-24 28-34z" class="k"/>`,
  crown: `<path d="M60 170l-8-90 40 36 36-56 36 56 40-36-8 90z"/><rect x="60" y="176" width="136" height="20" rx="4"/><circle cx="128" cy="140" r="10" class="k"/><circle cx="92" cy="148" r="7" class="k"/><circle cx="164" cy="148" r="7" class="k"/>`,
  thorns: `<path d="M60 200C90 160 100 120 128 100s60-30 70-60" class="s" stroke-width="14"/><path d="M90 160l-24-10M104 132l26 6M122 104l-14-24M150 86l20 16M172 64l-6-26M78 182l22 14" class="s" stroke-width="10"/>`,
  tree: `<path d="M118 210h20v-60l30-30-10-6-20 20V90h-20v44l-20-20-10 6 30 30z"/><circle cx="128" cy="78" r="40"/><circle cx="88" cy="104" r="28"/><circle cx="168" cy="104" r="28"/>`,
  sickle: `<path d="M180 60c-60-10-112 30-112 90 0 20 8 36 18 46-2-60 40-100 94-104z"/><rect x="76" y="168" width="18" height="60" rx="6" transform="rotate(-35 85 198)"/>`,
  horse: `<path d="M86 210h96l-8-30c-6-24-4-46 6-62l-14-50-18 22-24-6c-26 0-48 20-56 50l-4 18 22 6 16-18c10 4 18 4 24 0-6 22-30 40-36 70z"/><circle cx="130" cy="100" r="6" class="k"/>`,
  coffin: `<path d="M108 40h40l26 52-16 124H98L82 92z"/><path d="M128 76v80M106 104h44" class="ks"/>`,
  hood: `<path d="M128 42c-46 0-70 50-70 100 0 30 6 50 12 70h116c6-20 12-40 12-70 0-50-24-100-70-100z"/><path d="M128 92c-26 0-38 22-38 46 0 22 14 40 38 40s38-18 38-40c0-24-12-46-38-46z" class="k"/><circle cx="114" cy="134" r="6"/><circle cx="142" cy="134" r="6"/>`,
  staff: `<rect x="120" y="96" width="16" height="128" rx="6"/><circle cx="128" cy="70" r="30"/><circle cx="128" cy="70" r="14" class="k"/><path d="M96 40l14 18M160 40l-14 18M128 26v18" class="s" stroke-width="8"/>`,
  heart: `<path d="M128 206S50 156 50 104c0-28 20-48 44-48 16 0 28 8 34 22 6-14 18-22 34-22 24 0 44 20 44 48 0 52-78 102-78 102z"/>`,
  rune: `<circle cx="128" cy="128" r="76" class="s" stroke-width="10"/><path d="M128 62v132M86 92l84 72M170 92l-84 72" class="s" stroke-width="10"/><circle cx="128" cy="128" r="18"/>`,
  spiral: `<path d="M128 128m-8 0a8 8 0 1 1 16 0a24 24 0 1 1-48 0a40 40 0 1 1 80 0a56 56 0 1 1-112 0a72 72 0 1 1 144 0" class="s" stroke-width="12"/>`,
  eclipse: `<circle cx="128" cy="128" r="74"/><circle cx="148" cy="116" r="66" class="k"/>`,
  wave: `<path d="M40 150c20-30 40-30 60 0s40 30 60 0 40-30 60 0v50H40z"/><path d="M40 110c20-30 40-30 60 0s40 30 60 0 40-30 60 0" class="s" stroke-width="12"/>`,
  shield: `<path d="M128 40l76 26v50c0 50-34 86-76 104-42-18-76-54-76-104V66z"/><path d="M128 64v134M78 112h100" class="ks"/>`,
  gem: `<path d="M84 72h88l32 40-76 104-76-104z"/><path d="M52 112h152M84 72l20 40 24-40 24 40 20-40M104 112l24 104 24-104" class="ks"/>`,
  scroll: `<rect x="72" y="58" width="112" height="140" rx="10"/><rect x="60" y="48" width="136" height="22" rx="11"/><rect x="60" y="188" width="136" height="22" rx="11"/><path d="M94 100h68M94 124h68M94 148h44" class="ks"/>`,
  helm: `<path d="M128 44c-44 0-68 34-68 80v60c0 10 8 20 20 20h96c12 0 20-10 20-20v-60c0-46-24-80-68-80z"/><path d="M84 124h88v16H138v52h-20v-52H84z" class="k"/><path d="M128 44v-16" class="s" stroke-width="10"/>`,
  envelope: `<rect x="48" y="78" width="160" height="108" rx="10"/><path d="M52 84l76 58 76-58" class="ks"/><circle cx="128" cy="150" r="14" class="k"/>`,
  banner: `<rect x="70" y="34" width="10" height="190" rx="4"/><path d="M80 44h110l-20 40 20 40H80z"/><path d="M118 70l8 16h18l-14 10 6 18-16-10-16 10 6-18-14-10h18z" class="k"/>`,
  sword: `<path d="M128 26l14 28v110h-28V54z"/><rect x="86" y="164" width="84" height="14" rx="6"/><rect x="120" y="178" width="16" height="36" rx="5"/><circle cx="128" cy="222" r="10"/>`,
  bow: `<path d="M86 40c70 30 70 146 0 176" class="s" stroke-width="14"/><path d="M86 40v176" class="s" stroke-width="4"/><path d="M60 128h140M200 128l-20-12M200 128l-20 12" class="s" stroke-width="8"/>`,
  tower: `<path d="M86 214V96h-8V56h20v18h16V56h28v18h16V56h20v40h-8v118z"/><path d="M116 214v-40c0-8 6-14 12-14s12 6 12 14v40zM120 110h16v24h-16z" class="k"/>`,
  catapult: `<rect x="50" y="176" width="156" height="18" rx="6"/><circle cx="80" cy="204" r="16"/><circle cx="176" cy="204" r="16"/><path d="M100 176l70-110" class="s" stroke-width="14"/><circle cx="172" cy="58" r="20"/><path d="M90 176l30-40 30 40" class="s" stroke-width="10"/>`,
  eye: `<path d="M30 128c30-50 66-70 98-70s68 20 98 70c-30 50-66 70-98 70s-68-20-98-70z"/><circle cx="128" cy="128" r="36" class="k"/><circle cx="128" cy="128" r="16"/>`,
  spear: `<path d="M128 22l24 52-16 10v140h-16V84l-16-10z"/><path d="M98 96h60" class="s" stroke-width="10"/>`,
  sunsea: `<circle cx="128" cy="112" r="50"/><path d="M40 160h176M56 184h144M76 206h104" class="s" stroke-width="12"/>`,
  ring: `<circle cx="128" cy="140" r="58" class="s" stroke-width="22"/><path d="M108 70l20-30 20 30-20 20z"/>`,
  cross: `<path d="M106 46h44v60h60v44h-60v60h-44v-60H46v-44h60z"/>`,
  book: `<path d="M128 70c-24-16-56-18-80-10v130c24-8 56-6 80 10 24-16 56-18 80-10V60c-24-8-56-6-80 10z"/><path d="M128 70v130" class="ks"/>`,
  compass: `<path d="M128 40l14 36-44 140-14-6 34-110z"/><path d="M128 40l-14 36 44 140 14-6-34-110z"/><circle cx="128" cy="76" r="14" class="k"/><path d="M80 170c30 16 66 16 96 0" class="s" stroke-width="8"/>`,
  patch: `<rect x="56" y="56" width="66" height="66" rx="6"/><rect x="134" y="56" width="66" height="66" rx="6"/><rect x="56" y="134" width="66" height="66" rx="6"/><rect x="134" y="134" width="66" height="66" rx="6"/><path d="M122 70l12 8M122 90l12-6M70 122l8 12M182 122l-8 12" class="ks"/>`,
  mask: `<path d="M50 80c50-20 106-20 156 0 0 70-30 120-78 120S50 150 50 80z"/><path d="M78 110c10-10 30-10 40 4-12 10-30 10-40-4zM138 114c10-14 30-14 40-4-10 14-28 14-40 4zM100 160c18 12 38 12 56 0" class="k"/>`,
  brokenheart: `<path d="M128 206S50 156 50 104c0-28 20-48 44-48 16 0 28 8 34 22l-12 30 20 20-16 30 22-30-18-20 10-30c6-14 18-22 34-22 24 0 44 20 44 48 0 52-78 102-78 102z"/>`,
  hammer: `<rect x="70" y="48" width="116" height="52" rx="8"/><rect x="118" y="100" width="20" height="120" rx="6"/>`,
  footprints: `<ellipse cx="96" cy="160" rx="22" ry="34"/><ellipse cx="160" cy="96" rx="22" ry="34"/><circle cx="84" cy="114" r="8"/><circle cx="102" cy="110" r="8"/><circle cx="148" cy="50" r="8"/><circle cx="166" cy="46" r="8"/>`,
  fist: `<rect x="72" y="80" width="112" height="90" rx="22"/><path d="M100 80v40M128 80v40M156 80v40" class="ks"/><rect x="94" y="170" width="68" height="46" rx="8"/>`,
  sprout: `<path d="M124 214v-90h8v90z"/><path d="M128 130c-10-40-40-60-80-56 4 40 36 62 80 56z"/><path d="M132 110c6-40 34-62 76-60-2 40-32 64-76 60z"/>`,
  sun: `<circle cx="128" cy="128" r="46"/><g class="s" stroke-width="10"><path d="M128 42v24M128 190v24M42 128h24M190 128h24M67 67l17 17M172 172l17 17M67 189l17-17M172 84l17-17"/></g>`,
  flower: `<circle cx="128" cy="86" r="28"/><circle cx="170" cy="118" r="28"/><circle cx="154" cy="166" r="28"/><circle cx="102" cy="166" r="28"/><circle cx="86" cy="118" r="28"/><circle cx="128" cy="128" r="20" class="k"/>`,
  candle: `<rect x="100" y="110" width="56" height="104" rx="8"/><path d="M128 42c12 18 20 30 20 44 0 12-9 20-20 20s-20-8-20-20c0-14 8-26 20-44z"/>`,
  wheat: `<path d="M126 220V60h4v160z"/><g>${[60, 86, 112, 138].map((y) => `<ellipse cx="112" cy="${y}" rx="10" ry="18" transform="rotate(-30 112 ${y})"/><ellipse cx="144" cy="${y}" rx="10" ry="18" transform="rotate(30 144 ${y})"/>`).join('')}</g>`,
  buckler: `<circle cx="128" cy="128" r="78"/><circle cx="128" cy="128" r="56" class="k"/><circle cx="128" cy="128" r="22"/>`,
  roots: `<path d="M128 40v80M128 120c-20 20-40 30-70 40M128 120c20 20 40 30 70 40M128 120v90M128 160c-16 10-26 30-30 50M128 160c16 10 26 30 30 50" class="s" stroke-width="14"/>`,
  droplet: `<path d="M128 36c30 50 62 82 62 120 0 36-28 62-62 62s-62-26-62-62c0-38 32-70 62-120z"/><path d="M104 150c0 18 10 30 24 34" class="ks"/>`,
  vine: `<path d="M70 214c0-50 110-50 110-100S100 60 120 30" class="s" stroke-width="12"/><ellipse cx="90" cy="150" rx="24" ry="12" transform="rotate(-30 90 150)"/><ellipse cx="170" cy="110" rx="24" ry="12" transform="rotate(30 170 110)"/><ellipse cx="110" cy="70" rx="20" ry="10" transform="rotate(-20 110 70)"/>`,
  hat: `<path d="M128 30l52 120H76z"/><ellipse cx="128" cy="160" rx="92" ry="22"/><path d="M98 120h60" class="ks"/>`,
  star: `<path d="M128 34l26 60 64 6-48 42 14 64-56-34-56 34 14-64-48-42 64-6z"/>`,
  mountains: `<path d="M20 210l70-120 40 60 36-80 70 140z"/><path d="M152 70l14 30 16-10" class="ks"/>`,
  bird: `<path d="M40 120c40-10 64 0 88 30 24-30 48-40 88-30-30 6-50 30-60 60-8 24-20 40-28 50-8-10-20-26-28-50-10-30-30-54-60-60z"/><circle cx="128" cy="140" r="14" class="k"/>`,
  crosshair: `<circle cx="128" cy="128" r="66" class="s" stroke-width="12"/><circle cx="128" cy="128" r="12"/><path d="M128 40v50M128 166v50M40 128h50M166 128h50" class="s" stroke-width="12"/>`,
  shuriken: `<path d="M128 30l20 78 78 20-78 20-20 78-20-78-78-20 78-20z"/><circle cx="128" cy="128" r="14" class="k"/>`,
  owl: `<path d="M70 70l26 18c20-8 44-8 64 0l26-18-6 40c10 16 14 34 14 50 0 34-30 56-66 56s-66-22-66-56c0-16 4-34 14-50z"/><circle cx="104" cy="122" r="20" class="k"/><circle cx="152" cy="122" r="20" class="k"/><circle cx="104" cy="122" r="8"/><circle cx="152" cy="122" r="8"/><path d="M120 150l8 14 8-14z" class="k"/>`,
  keyhole: `<circle cx="128" cy="128" r="80"/><circle cx="128" cy="108" r="24" class="k"/><path d="M114 120h28l10 66h-48z" class="k"/>`,
  note: `<rect x="150" y="40" width="14" height="130" rx="4"/><path d="M164 40c20 10 40 20 40 50-10-14-22-18-40-18z"/><ellipse cx="128" cy="176" rx="34" ry="24" transform="rotate(-20 128 176)"/>`,
  snake: `<path d="M180 60c-40-20-110 0-100 40s100 20 100 60-60 60-110 40" class="s" stroke-width="24"/><circle cx="184" cy="58" r="20"/><circle cx="190" cy="52" r="5" class="k"/>`,
  cocoon: `<ellipse cx="128" cy="134" rx="46" ry="80"/><path d="M90 90c20 10 56 10 76 0M84 130c26 12 62 12 88 0M90 172c20 10 56 10 76 0" class="ks"/><path d="M128 54V26" class="s" stroke-width="6"/>`,
  dagger: `<path d="M128 30l18 44-4 76h-28l-4-76z"/><rect x="92" y="150" width="72" height="12" rx="5"/><rect x="120" y="162" width="16" height="40" rx="5"/><path d="M128 202l12 14h-24z"/>`,
  pagoda: `<path d="M128 30l20 20h-40zM70 74l58-22 58 22-16 8H86zM80 120l48-22 48 22-14 8H94zM74 170l54-24 54 24-16 8H90z"/><rect x="104" y="82" width="48" height="40"/><rect x="100" y="128" width="56" height="44"/><rect x="96" y="178" width="64" height="40"/>`,
  robot: `<rect x="76" y="70" width="104" height="84" rx="14"/><circle cx="106" cy="110" r="14" class="k"/><circle cx="150" cy="110" r="14" class="k"/><rect x="98" y="134" width="60" height="8" class="k"/><path d="M128 70V44" class="s" stroke-width="8"/><circle cx="128" cy="40" r="10"/><rect x="88" y="160" width="80" height="54" rx="10"/>`,
  gear: `<path d="M116 36h24l4 22 18 8 18-14 18 18-14 18 8 18 22 4v24l-22 4-8 18 14 18-18 18-18-14-18 8-4 22h-24l-4-22-18-8-18 14-18-18 14-18-8-18-22-4v-24l22-4 8-18-14-18 18-18 18 14 18-8z"/><circle cx="128" cy="128" r="28" class="k"/>`,
  chip: `<rect x="72" y="72" width="112" height="112" rx="12"/><rect x="100" y="100" width="56" height="56" class="k"/><path d="M94 52v20M128 52v20M162 52v20M94 184v20M128 184v20M162 184v20M52 94h20M52 128h20M52 162h20M184 94h20M184 128h20M184 162h20" class="s" stroke-width="8"/>`,
  bolt: `<path d="M144 26L66 140h52l-16 90 88-124h-54z"/>`,
  drone: `<rect x="96" y="112" width="64" height="36" rx="10"/><path d="M96 124l-40-30M160 124l40-30M96 136l-40 30M160 136l40 30" class="s" stroke-width="8"/><ellipse cx="52" cy="90" rx="30" ry="8"/><ellipse cx="204" cy="90" rx="30" ry="8"/><ellipse cx="52" cy="170" rx="30" ry="8"/><ellipse cx="204" cy="170" rx="30" ry="8"/>`,
  virus: `<circle cx="128" cy="128" r="50"/>${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; const x = 128 + Math.cos(a) * 74; const y = 128 + Math.sin(a) * 74; return `<path d="M${128 + Math.cos(a) * 46} ${128 + Math.sin(a) * 46}L${x} ${y}" class="s" stroke-width="8"/><circle cx="${x}" cy="${y}" r="10"/>`; }).join('')}<circle cx="112" cy="116" r="10" class="k"/><circle cx="146" cy="142" r="8" class="k"/>`,
  flask: `<path d="M108 40h40v54l50 98c6 12-2 26-16 26H74c-14 0-22-14-16-26l50-98z"/><path d="M78 170h100" class="ks"/><circle cx="116" cy="190" r="8" class="k"/><circle cx="146" cy="184" r="6" class="k"/>`,
  infinity: `<path d="M128 128c-20-30-40-44-60-44-24 0-40 20-40 44s16 44 40 44c20 0 40-14 60-44s40-44 60-44c24 0 40 20 40 44s-16 44-40 44c-20 0-40-14-60-44z" class="s" stroke-width="18"/>`,
  coin: `<circle cx="128" cy="128" r="76"/><circle cx="128" cy="128" r="58" class="ks"/><path d="M146 96c-6-8-14-10-22-10-14 0-24 8-24 20 0 28 50 16 50 44 0 12-12 20-26 20-10 0-20-4-26-12M128 72v112" class="ks"/>`,
  briefcase: `<rect x="48" y="88" width="160" height="110" rx="12"/><path d="M100 88V70c0-6 4-10 10-10h36c6 0 10 4 10 10v18" class="s" stroke-width="10"/><path d="M48 132h160" class="ks"/>`,
  chest: `<path d="M50 120h156v86H50z"/><path d="M50 120c0-36 30-60 78-60s78 24 78 60z"/><rect x="116" y="112" width="24" height="32" rx="4" class="k"/><path d="M50 120h156" class="ks"/>`,
  wheel: `<circle cx="128" cy="128" r="80" class="s" stroke-width="18"/><circle cx="128" cy="128" r="16"/><path d="M128 48v160M48 128h160M72 72l112 112M72 184L184 72" class="s" stroke-width="6"/>`,
  chart: `<path d="M50 210h160" class="s" stroke-width="8"/><rect x="62" y="150" width="28" height="56"/><rect x="104" y="116" width="28" height="90"/><rect x="146" y="74" width="28" height="132"/><path d="M58 130l50-40 40 20 56-60" class="s" stroke-width="8"/>`,
  wings: `<path d="M128 100c-30-40-70-60-100-50 10 30 30 50 60 60-30 0-46 10-56 30 30 6 60 0 96-20zM128 100c30-40 70-60 100-50-10 30-30 50-60 60 30 0 46 10 56 30-30 6-60 0-96-20z"/><circle cx="128" cy="130" r="22"/><path d="M118 108l-6-16M138 108l6-16" class="s" stroke-width="6"/>`,
  pickaxe: `<path d="M50 90c40-40 116-40 156 0-40-14-116-14-156 0z"/><rect x="120" y="70" width="16" height="150" rx="5" transform="rotate(20 128 145)"/>`,
  tophat: `<rect x="80" y="50" width="96" height="110" rx="6"/><ellipse cx="128" cy="168" rx="84" ry="18"/><rect x="80" y="130" width="96" height="16" class="k"/>`,
  claw: `<path d="M70 200c-10-60 0-120 30-160-6 50-2 100 20 150zM116 206c-6-64 6-124 40-164-8 54-6 110 12 160zM168 200c0-50 14-96 44-124-10 44-12 90-4 130z"/>`,
  fang: `<path d="M60 70h136c0 40-20 60-40 66l-10 70-18-66h-0l-18 66-10-70c-20-6-40-26-40-66z"/>`,
  spoon: `<ellipse cx="128" cy="80" rx="36" ry="48"/><rect x="120" y="120" width="16" height="104" rx="8"/>`,
  moon: `<path d="M150 40c-50 6-84 46-84 92s38 86 88 86c22 0 40-8 54-20-60 10-104-30-104-82 0-34 20-64 46-76z"/><circle cx="170" cy="70" r="6"/><circle cx="196" cy="110" r="4"/>`,
  pumpkin: `<path d="M120 86l2-34h18l-4 34z"/><ellipse cx="128" cy="148" rx="88" ry="66"/><path d="M100 88c-18 30-18 86 0 120M156 88c18 30 18 86 0 120" class="ks"/><path d="M88 136l18-22 18 22z" class="k"/><path d="M132 136l18-22 18 22z" class="k"/><path d="M90 164q38 26 76 0l-10 16q-28 14-56 0z" class="k"/>`,
  dragon: `<path d="M118 78l-18-40 34 30z"/><path d="M150 72l8-42 16 40z"/><path d="M56 156c0-48 36-84 84-84 18 0 34 6 46 16l34-22-8 40c8 12 12 26 12 40 0 40-34 68-84 68H94c-22 0-38-16-38-38z"/><circle cx="164" cy="128" r="11" class="k"/><circle cx="210" cy="156" r="5" class="k"/><path d="M112 186q28 14 56 0" class="ks"/>`,
  guitar: `<circle cx="102" cy="170" r="46"/><circle cx="134" cy="132" r="34"/><path d="M146 110l54-54 16 16-54 54z"/><path d="M198 44l22-8 8 22-14 14-16-16z"/><circle cx="112" cy="158" r="13" class="k"/><path d="M92 182L214 58" class="ks"/>`,
  bell: `<path d="M128 42c-36 0-56 30-56 70v48l-18 26h148l-18-26v-48c0-40-20-70-56-70z"/><circle cx="128" cy="204" r="16"/><path d="M128 42V28" class="s" stroke-width="8"/>`,
};

const GLYPH_OF = {
  skeleton: 'skull', ash: 'flame', memory: 'hourglass', ashlie: 'crown', bramble: 'thorns', thicket: 'tree', sickle: 'sickle',
  horseman: 'horse', funeral: 'coffin', lich: 'hood', necromancer: 'staff', romance: 'heart', ancient_name_neverending: 'rune',
  returner: 'spiral', abandon: 'eclipse', lake: 'wave', shield_azure: 'shield', tourmaline: 'gem', command: 'scroll',
  royal_guard: 'helm', message: 'envelope', front_and_center: 'banner', knight: 'sword', longbow: 'bow', time_cannot_destroy: 'tower',
  catapult: 'catapult', remember: 'eye', gelf_lanz: 'spear', ocean_sky: 'sunsea', commitment: 'ring', doctor: 'cross',
  librarian: 'book', architect: 'compass', patchwork: 'patch', hug: 'heart', pink_gem: 'gem', therapist: 'mask',
  vulnerability: 'brokenheart', builder: 'hammer', '1000_miles': 'footprints', barton: 'fist', life: 'sprout', restore: 'sun',
  honeysuckle_kindred: 'flower', devotion: 'candle', sapling: 'sprout', farmer: 'wheat', organizer: 'scroll',
  honeysuckle_brambor: 'flower', roll_guard: 'buckler', root: 'roots', splashmaster: 'droplet', elder: 'tree', cursed_vines: 'vine',
  witch: 'hat', warlock: 'star', distant_land: 'mountains', ancient_name_brambor: 'rune', chosen_name: 'star',
  andromeda_robin: 'bird', green_gem: 'gem', storyteller: 'book', disciple: 'hood', hunter: 'crosshair', orange_ninja: 'shuriken',
  owl: 'owl', secret: 'keyhole', white_ninja: 'shuriken', songstress: 'note', red_sea_snake: 'snake', larva: 'cocoon',
  ambush: 'dagger', shadow_place: 'pagoda', omar_evans: 'mask', shine_like_a_knife: 'dagger', left_twinbot: 'robot',
  right_twinbot: 'robot', tinker: 'gear', sniper: 'crosshair', mod: 'chip', chaos: 'bolt', aerial_drone: 'drone', computer: 'chip',
  virus: 'virus', robot_boy: 'robot', scientist: 'flask', paradox: 'infinity', warmech: 'robot', may_danaris: 'bird',
  golden_light: 'sun', drill_sgt: 'star', shopkeep: 'coin', intern: 'briefcase', pyro: 'flame', jeweler: 'gem', treasure: 'chest',
  biker: 'wheel', investor: 'chart', red_gem: 'gem', purveyor: 'coin', gargoil: 'wings', miner: 'pickaxe', bill_milton: 'tophat',
  gem_wizard: 'hat', exploit: 'claw', sword: 'sword', shield_neutral: 'shield', pickaxe: 'pickaxe', scout: 'compass',
  silver_banner: 'banner', gold_banner: 'banner', poison: 'flask', vampire: 'fang', locas: 'eye', spoonful: 'spoon', grief: 'droplet',
  sarinee: 'moon', broken_land: 'mountains', tom_judith: 'bell', omni_gem: 'gem', skel: 'skull', rootling: 'roots', phoenix: 'bird',
  pumpkin: 'pumpkin', dragon: 'dragon',
};


// outline copy of a glyph: detail shapes hidden, stroked lines thickened
function outlineOf(glyph, extra, color) {
  return glyph
    .replace(/class="(k|ks)"/g, 'opacity="0"')
    .replace(/class="s"/g, `fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" data-o="1"`)
    .replace(/stroke-width="(\d+)"/g, (m, w) => `stroke-width="${Number(w) + extra}"`);
}

// ---------------- little decorations ----------------
const sparkle = (x, y, s, c, o = 0.9) =>
  `<path d="M${x} ${y - s}Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y}Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s}Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y}Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}z" fill="${c}" opacity="${o}"/>`;
const heart = (x, y, s, c, o = 0.8) =>
  `<path d="M${x} ${y + s * 0.9}C${x - s * 1.4} ${y}${' '}${x - s * 0.9} ${y - s}${' '}${x} ${y - s * 0.35}C${x + s * 0.9} ${y - s} ${x + s * 1.4} ${y} ${x} ${y + s * 0.9}z" fill="${c}" opacity="${o}"/>`;
const cloud = (x, y, w, c, o = 0.85) =>
  `<g fill="${c}" opacity="${o}"><ellipse cx="${x}" cy="${y}" rx="${w * 0.5}" ry="${w * 0.17}"/><circle cx="${x - w * 0.18}" cy="${y - w * 0.1}" r="${w * 0.17}"/><circle cx="${x + w * 0.1}" cy="${y - w * 0.16}" r="${w * 0.22}"/></g>`;

// ---------------- tribe scenery ----------------
function scenery(tribe, r, pal) {
  const parts = [];
  const H = 256;
  const hills = (y0, amp, color, step = 64) => {
    let d = `M0 ${H}L0 ${y0}`;
    let px = 0, py = y0;
    for (let x = step; x <= 256 + step; x += step) {
      const ny = y0 - r() * amp;
      d += `Q${px + step / 2} ${Math.min(py, ny) - amp * 0.6} ${x} ${ny}`;
      px = x; py = ny;
    }
    return `<path d="${d}L256 ${H}z" fill="${color}"/>`;
  };
  for (let i = 0; i < 2; i++) parts.push(cloud(20 + r() * 220, 30 + r() * 60, 70 + r() * 50, '#ffffff', 0.55 + r() * 0.3));
  switch (tribe) {
    case 'neverending':
      parts.push(`<circle cx="${50 + r() * 150}" cy="${46 + r() * 20}" r="22" fill="#fffbe8" opacity=".9"/><circle cx="${62 + r() * 150}" cy="40" r="20" fill="${pal.sky[0]}" opacity=".0"/>`);
      parts.push(hills(205, 18, pal.far));
      for (let i = 0; i < 5; i++) {
        const x = r() * 230, h = 16 + r() * 16;
        parts.push(`<path d="M${x} 236v-${h}a11 11 0 0 1 22 0v${h}z" fill="${pal.near}"/><path d="M${x + 11} ${232 - h}v8M${x + 7} ${236 - h}h8" stroke="#fff" stroke-width="2" opacity=".6"/>`);
      }
      break;
    case 'azure': {
      parts.push(hills(212, 16, pal.far));
      const x = r() * 150 + 30;
      parts.push(`<path d="M${x} 236v-56h10v-10h8v10h12v-26h14v26h12v-10h8v10h10v56z" fill="${pal.near}"/><path d="M${x + 33} 154v-16l12 5-12 5" fill="#ffd1e8"/>`);
      break;
    }
    case 'kindred':
      parts.push(hills(214, 14, pal.far));
      for (let i = 0; i < 5; i++) {
        const x = i * 54 + r() * 16, h = 22 + r() * 16;
        parts.push(`<path d="M${x} 236v-${h}l20-15 20 15v${h}z" fill="${pal.near}"/><rect x="${x + 14}" y="${236 - h + 8}" width="12" height="10" rx="3" fill="#fff6cf" opacity=".9"/>`);
      }
      for (let i = 0; i < 5; i++) parts.push(heart(r() * 256, 20 + r() * 110, 4 + r() * 4, '#ffffff', 0.7));
      break;
    case 'brambor':
      parts.push(hills(200, 26, pal.far));
      for (let i = 0; i < 5; i++) {
        const x = r() * 256, s = 14 + r() * 12;
        parts.push(`<circle cx="${x}" cy="${222 - s}" r="${s}" fill="${pal.near}"/><rect x="${x - 3}" y="${222 - s}" width="6" height="${s + 14}" rx="3" fill="${pal.stroke}" opacity=".45"/>`);
      }
      parts.push(hills(226, 8, pal.near, 32));
      break;
    case 'cloister': {
      parts.push(hills(206, 22, pal.far));
      const x = 20 + r() * 150;
      parts.push(`<path d="M${x} 236v-36h-8l28-14 28 14h-8v36zM${x - 6} 194l34-20 34 20" fill="${pal.near}"/>`);
      for (let i = 0; i < 9; i++) parts.push(`<ellipse cx="${r() * 256}" cy="${r() * 220}" rx="4" ry="2.4" fill="#ffffff" opacity=".8" transform="rotate(${r() * 180})"/>`);
      break;
    }
    case 'alcove':
      for (let i = 0; i < 7; i++) {
        const y = 40 + r() * 190, x = r() * 256;
        parts.push(`<path d="M0 ${y}H${x}v${(r() - 0.5) * 50}H256" stroke="#ffffff" stroke-width="2" fill="none" opacity=".45"/><circle cx="${x}" cy="${y}" r="3.5" fill="#ffffff" opacity=".8"/>`);
      }
      parts.push(hills(222, 6, pal.far, 32));
      break;
    case 'demons':
      parts.push(hills(210, 20, pal.far));
      for (let i = 0; i < 6; i++) {
        const x = i * 44 + r() * 10, h = 26 + r() * 40;
        parts.push(`<rect x="${x}" y="${236 - h}" width="30" height="${h}" rx="4" fill="${pal.near}"/><rect x="${x + 8}" y="${242 - h}" width="6" height="6" rx="2" fill="#fff7cc"/>`);
      }
      for (let i = 0; i < 4; i++) parts.push(`<circle cx="${r() * 256}" cy="${30 + r() * 100}" r="${3 + r() * 3}" fill="#ffe08a" stroke="#fff" stroke-width="1.5"/>`);
      break;
    default:
      parts.push(hills(196, 40, pal.far));
      parts.push(hills(220, 16, pal.near));
  }
  for (let i = 0; i < 6; i++) parts.push(sparkle(r() * 256, r() * 170, 3 + r() * 5, pal.spark, 0.6 + r() * 0.4));
  return parts.join('');
}

function cardSvg(card) {
  const pal = PAL[card.tribe] ?? PAL.neutral;
  const r = rng(card.id);
  const glyph = G[GLYPH_OF[card.id] ?? 'star'];
  const rot = (r() - 0.5) * 10;
  const scale = 0.74 + r() * 0.08;
  const cx = 128 + (r() - 0.5) * 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.sky[0]}"/><stop offset=".55" stop-color="${pal.sky[1]}"/><stop offset="1" stop-color="${pal.sky[2]}"/></linearGradient>
<radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${pal.glow}" stop-opacity=".85"/><stop offset=".6" stop-color="${pal.glow}" stop-opacity=".25"/><stop offset="1" stop-color="${pal.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.glyph[0]}"/><stop offset="1" stop-color="${pal.glyph[1]}"/></linearGradient>
<radialGradient id="vig" cx=".5" cy=".45" r=".75"><stop offset=".65" stop-color="${pal.stroke}" stop-opacity="0"/><stop offset="1" stop-color="${pal.stroke}" stop-opacity=".35"/></radialGradient>
<filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
<style>.k{fill:${pal.stroke};opacity:.9}.ks{fill:none;stroke:${pal.stroke};stroke-width:6;stroke-linecap:round;opacity:.85}.s{fill:none;stroke:url(#gl);stroke-linecap:round;stroke-linejoin:round}</style>
</defs>
<rect width="256" height="256" fill="url(#sky)"/>
${scenery(card.tribe, r, pal)}
<circle cx="${cx}" cy="124" r="100" fill="url(#halo)"/>
<g transform="translate(${cx} 128) rotate(${rot}) scale(${scale}) translate(-128 -128)">
<g filter="url(#blur)" opacity=".95" fill="#ffffff" stroke="#ffffff" stroke-width="22">${outlineOf(glyph, 22, '#ffffff')}</g>
<g fill="${pal.stroke}" stroke="${pal.stroke}" stroke-width="12" stroke-linejoin="round">${outlineOf(glyph, 12, pal.stroke)}</g>
<g fill="url(#gl)" stroke="none">${glyph}</g>
</g>
${sparkle(cx + 70, 70, 9, '#ffffff', 0.95)}${sparkle(cx - 74, 178, 6, '#ffffff', 0.85)}
<rect width="256" height="256" fill="url(#vig)"/>
</svg>`;
}

for (const c of data.cards) fs.writeFileSync(path.join(outCards, `${c.id}.svg`), cardSvg(c));

// ---------------- battle board: charcoal night arena with pink & lavender glow ----------------
function boardSvg() {
  const r = rng('board');
  const W = 1600, H = 900;
  const haze = [];
  for (let i = 0; i < 12; i++) {
    const x = r() < 0.5 ? r() * 330 : W - r() * 330;
    haze.push(cloud(x, 60 + r() * 780, 180 + r() * 180, r() < 0.5 ? '#3a3346' : '#33303b', 0.55 + r() * 0.3));
  }
  const sparks = [];
  for (let i = 0; i < 110; i++) sparks.push(sparkle(r() * W, r() * H, 1.5 + r() * 6, r() < 0.35 ? '#ff9fd0' : r() < 0.5 ? '#c9b3ff' : '#ffffff', 0.25 + r() * 0.55));
  const hearts = [];
  for (let i = 0; i < 16; i++) hearts.push(heart(r() * W, r() * H, 5 + r() * 8, r() < 0.5 ? '#ff7fbf' : '#b79cf2', 0.25 + r() * 0.3));
  const ring = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const x = 800 + Math.cos(a) * 300, y = 450 + Math.sin(a) * 138;
    ring.push(i % 2 ? sparkle(x, y, 7, '#e9dcff', 0.85) : heart(x, y, 6, '#ff7fbf', 0.8));
  }
  let hill1 = `M0 ${H}L0 760`; for (let x = 0; x <= W + 200; x += 200) hill1 += `Q${x + 100} ${700 + r() * 40} ${x + 200} ${750 + r() * 40}`;
  let hill2 = `M0 ${H}L0 830`; for (let x = 0; x <= W + 160; x += 160) hill2 += `Q${x + 80} ${790 + r() * 30} ${x + 160} ${820 + r() * 30}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1920"/><stop offset=".5" stop-color="#25222b"/><stop offset="1" stop-color="#1d1b22"/></linearGradient>
<radialGradient id="center" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff8fc8" stop-opacity=".22"/><stop offset=".5" stop-color="#b79cf2" stop-opacity=".12"/><stop offset="1" stop-color="#b79cf2" stop-opacity="0"/></radialGradient>
<radialGradient id="glowL" cx=".1" cy=".15" r=".45"><stop offset="0" stop-color="#7d5bd0" stop-opacity=".28"/><stop offset="1" stop-color="#7d5bd0" stop-opacity="0"/></radialGradient>
<radialGradient id="glowR" cx=".92" cy=".85" r=".45"><stop offset="0" stop-color="#e2569e" stop-opacity=".22"/><stop offset="1" stop-color="#e2569e" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="${H}" fill="url(#glowL)"/>
<rect width="${W}" height="${H}" fill="url(#glowR)"/>
${haze.join('')}
<ellipse cx="800" cy="450" rx="660" ry="340" fill="url(#center)"/>
<ellipse cx="800" cy="450" rx="300" ry="138" fill="none" stroke="#c9b3ff" stroke-width="3" opacity=".55"/>
<ellipse cx="800" cy="450" rx="270" ry="120" fill="none" stroke="#ff7fbf" stroke-width="2" stroke-dasharray="4 12" stroke-linecap="round" opacity=".7"/>
${ring.join('')}
<path d="${hill1}L${W} ${H}z" fill="#2c2735"/>
<path d="${hill2}L${W} ${H}z" fill="#24202b"/>
${hearts.join('')}
${sparks.join('')}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;
}
fs.writeFileSync(path.join(root, 'public/art/board.svg'), boardSvg());

// ---------------- menu background: dark sky, pink moon ----------------
function menuSvg() {
  const r = rng('menu');
  const W = 1600, H = 900;
  const sparks = Array.from({ length: 160 }, () => sparkle(r() * W, r() * 600, 1.5 + r() * 6, r() < 0.3 ? '#ff9fd0' : '#ffffff', 0.25 + r() * 0.7)).join('');
  const clouds = Array.from({ length: 12 }, () => cloud(r() * W, 470 + r() * 260, 220 + r() * 220, '#3a3346', 0.6 + r() * 0.3)).join('');
  let ridge1 = `M0 ${H}L0 690`; for (let x = 0; x <= W + 200; x += 200) ridge1 += `Q${x + 100} ${620 + r() * 60} ${x + 200} ${680 + r() * 50}`;
  let ridge2 = `M0 ${H}L0 790`; for (let x = 0; x <= W + 160; x += 160) ridge2 += `Q${x + 80} ${740 + r() * 40} ${x + 160} ${780 + r() * 40}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141217"/><stop offset=".55" stop-color="#26212e"/><stop offset=".85" stop-color="#3b2a3d"/><stop offset="1" stop-color="#2a2430"/></linearGradient>
<radialGradient id="m" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd6ec" stop-opacity=".9"/><stop offset=".3" stop-color="#ff8fc8" stop-opacity=".35"/><stop offset="1" stop-color="#b79cf2" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s)"/>${sparks}
<circle cx="800" cy="400" r="320" fill="url(#m)"/><circle cx="800" cy="400" r="80" fill="#fff1f8"/><circle cx="830" cy="384" r="72" fill="#ffd3e8" opacity=".5"/>
<path d="${ridge1}L${W} ${H}z" fill="#2b2633"/>
${clouds}
<g fill="#3d3549"><path d="M1240 720v-130l16-22 16 22v-40l16-30 16 30v40l16-22 16 22v130z"/><path d="M1284 530v-22l16 7-16 7z" fill="#ff7fbf"/><rect x="1278" y="640" width="12" height="18" rx="6" fill="#ffc6e0"/></g>
<path d="${ridge2}L${W} ${H}z" fill="#1f1c25"/>
</svg>`;
}
fs.writeFileSync(path.join(root, 'public/art/menu.svg'), menuSvg());

// ---------------- hero portraits (file name = hero id) ----------------
const HERO_ART = {
  andromeda_robin: ['#9fe0bd', '#3a7f5c', 'hat'],
  gelf_lanz: ['#a9c9ff', '#3c64b0', 'spear'],
  derby_pocket: ['#ffbf9e', '#b85a36', 'briefcase'],
  bunny_wizard: ['#ffc6e0', '#b0457c', 'bunny'],
  croh_vosh: ['#8fd8f0', '#2a5f8e', 'sword'],
  may_danaris: ['#ff9fb8', '#a8304f', 'chip'],
  locas_clare: ['#d6cdf0', '#5e5290', 'keyhole'],
  venice_gorn: ['#ffe39a', '#a07a1a', 'wheat'],
  omar_evans: ['#b8eb9a', '#4a8a2a', 'shuriken'],
  eve_williams: ['#e4d2ff', '#6a3fa8', 'skull'],
  abragail: ['#c8d8ff', '#4a54a8', 'book'],
  bill_milton: ['#ffb39a', '#8f2f2a', 'tophat'],
  clover: ['#c6efa6', '#3d7a2c', 'dragon'],
  trevor_l: ['#e2d4ff', '#4b2f7e', 'guitar'],
  unknown: ['#e9e0ff', '#7d5bd0', 'star'],
  tavern: ['#ffc6e0', '#7d5bd0', 'pagoda'],
};
fs.rmSync(outHeroes, { recursive: true, force: true });
fs.mkdirSync(outHeroes, { recursive: true });
for (const [id, [bg, ink, gname]] of Object.entries(HERO_ART)) {
  const glyph = G[gname];
  const r = rng('hero' + id);
  const sp = Array.from({ length: 7 }, () => sparkle(30 + r() * 196, 30 + r() * 196, 4 + r() * 6, '#ffffff', 0.8)).join('');
  fs.writeFileSync(path.join(outHeroes, `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs><radialGradient id="b" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="${bg}"/><stop offset="1" stop-color="${ink}" stop-opacity=".75"/></radialGradient>
<filter id="blur"><feGaussianBlur stdDeviation="6"/></filter><style>.k{fill:${ink}}.ks{fill:none;stroke:${ink};stroke-width:6;stroke-linecap:round}.s{fill:none;stroke:#fff}</style></defs>
<rect width="256" height="256" fill="url(#b)"/>${sp}
<g transform="translate(128 132) scale(.66) translate(-128 -128)"><g filter="url(#blur)" fill="#fff" stroke="#fff" stroke-width="14">${outlineOf(glyph, 14, '#ffffff')}</g><g fill="${ink}" stroke="${ink}" stroke-width="12" stroke-linejoin="round">${outlineOf(glyph, 12, ink)}</g><g fill="#ffffff">${glyph}</g></g>
</svg>`);
}

// ---------------- hero power icons (inverted: white emblem on the hero's dark colour) ----------------
const POWER_GLYPH = {
  andromeda_robin: 'flame', gelf_lanz: 'bolt', derby_pocket: 'heart', bunny_wizard: 'sun', croh_vosh: 'wave', may_danaris: 'eye',
  locas_clare: 'coin', venice_gorn: 'sprout', omar_evans: 'tree', eve_williams: 'infinity', abragail: 'scroll', bill_milton: 'chart',
  clover: 'wings', trevor_l: 'note',
};
for (const [id, gname] of Object.entries(POWER_GLYPH)) {
  const [bg, ink] = HERO_ART[id];
  const glyph = G[gname];
  fs.writeFileSync(path.join(outHeroes, `power_${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs><radialGradient id="b" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="${bg}"/><stop offset=".6" stop-color="${ink}"/><stop offset="1" stop-color="#1e1c23"/></radialGradient>
<filter id="blur"><feGaussianBlur stdDeviation="8"/></filter><style>.k{fill:${ink}}.ks{fill:none;stroke:${ink};stroke-width:6;stroke-linecap:round}.s{fill:none;stroke:#fff}</style></defs>
<rect width="256" height="256" fill="url(#b)"/>
<g transform="translate(128 128) scale(.6) translate(-128 -128)"><g filter="url(#blur)" fill="${bg}" stroke="${bg}" stroke-width="16">${outlineOf(glyph, 16, bg)}</g><g fill="#ffffff">${glyph.replace(/class="s"/g, 'fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round"')}</g></g>
</svg>`);
}

// art manifest: card id -> path (edit to point at your own images)
const manifestPath = path.join(root, 'src/data/art.json');
let manifest = {};
if (fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const c of data.cards) if (!manifest[c.id]) manifest[c.id] = `art/cards/${c.id}.svg`;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`art: ${data.cards.length} cards, board, menu, ${Object.keys(HERO_ART).length} hero portraits`);
