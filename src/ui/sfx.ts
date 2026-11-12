/**
 * Small synthesized sound effects (Web Audio, no files). Audio starts only after the player's
 * first tap/click, as browsers require. Mute is remembered per device.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try { muted = localStorage.getItem('torrekin-muted') === '1'; } catch { /* storage unavailable */ }

const listeners = new Set<(m: boolean) => void>();

function ensure(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// unlock audio on the first interaction
window.addEventListener('pointerdown', () => { if (!muted) ensure(); }, { once: true });

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('torrekin-muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.32;
  listeners.forEach((f) => f(m));
}
export function onMuteChange(f: (m: boolean) => void) { listeners.add(f); }

interface Tone { f: number; f2?: number; t?: number; d: number; type?: OscillatorType; v?: number; a?: number }

function tone({ f, f2, t = 0, d, type = 'triangle', v = 0.5, a = 0.008 }: Tone) {
  const c = ensure();
  if (!c || !master) return;
  const now = c.currentTime + t;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, now);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + d);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(v, now + a);
  g.gain.exponentialRampToValueAtTime(0.0001, now + d);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + d + 0.05);
}

function noise({ t = 0, d, v = 0.4, lp = 2000, hp = 0 }: { t?: number; d: number; v?: number; lp?: number; hp?: number }) {
  const c = ensure();
  if (!c || !master) return;
  const now = c.currentTime + t;
  const len = Math.floor(c.sampleRate * d);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.setValueAtTime(lp, now);
  low.frequency.exponentialRampToValueAtTime(Math.max(80, lp / 6), now + d);
  const high = c.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(v, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + d);
  src.connect(low).connect(high).connect(g).connect(master);
  src.start(now);
}

let lastPlayed: Record<string, number> = {};
/** avoid stacking the same sound many times in one instant */
function throttle(name: string, ms: number) {
  const now = performance.now();
  if (now - (lastPlayed[name] ?? 0) < ms) return false;
  lastPlayed[name] = now;
  return true;
}

export const sfx = {
  /** a card lands on the board */
  deploy() {
    if (!throttle('deploy', 60)) return;
    tone({ f: 523, d: 0.12, type: 'triangle', v: 0.45 });
    tone({ f: 784, t: 0.07, d: 0.18, type: 'triangle', v: 0.4 });
    tone({ f: 1568, t: 0.12, d: 0.22, type: 'sine', v: 0.18 });
    noise({ d: 0.08, v: 0.12, lp: 3000, hp: 800 });
  },
  /** a unit appears in a puff of smoke */
  puff() {
    if (!throttle('puff', 70)) return;
    noise({ d: 0.22, v: 0.22, lp: 2600, hp: 300 });
    tone({ f: 300, f2: 900, d: 0.16, type: 'sine', v: 0.18 });
    tone({ f: 1320, t: 0.08, d: 0.18, type: 'triangle', v: 0.12 });
  },
  /** shop -> battle: whoosh, then a big hit */
  battle() {
    noise({ d: 0.42, v: 0.22, lp: 7000, hp: 600 });
    tone({ f: 180, f2: 720, d: 0.4, type: 'sawtooth', v: 0.05 });
    noise({ t: 0.42, d: 0.5, v: 0.45, lp: 1400 });
    tone({ t: 0.42, f: 120, f2: 38, d: 0.7, type: 'sine', v: 0.9 });
    [262, 330, 392, 523].forEach((f) => tone({ t: 0.44, f, d: 0.9, type: 'sawtooth', v: 0.05, a: 0.01 }));
    [523, 659, 784].forEach((f, i) => tone({ t: 0.5 + i * 0.07, f, d: 0.5, type: 'triangle', v: 0.16 }));
  },
  /** battle -> shop */
  whoosh() {
    noise({ d: 0.38, v: 0.2, lp: 5000, hp: 400 });
    tone({ f: 660, f2: 990, d: 0.3, type: 'sine', v: 0.1 });
  },
  buy() {
    tone({ f: 988, d: 0.08, type: 'square', v: 0.16 });
    tone({ f: 1319, t: 0.06, d: 0.2, type: 'square', v: 0.14 });
  },
  sell() {
    tone({ f: 1319, d: 0.08, type: 'square', v: 0.14 });
    tone({ f: 988, t: 0.06, d: 0.1, type: 'square', v: 0.13 });
    tone({ f: 659, t: 0.12, d: 0.2, type: 'triangle', v: 0.25 });
  },
  click() {
    tone({ f: 660, f2: 880, d: 0.06, type: 'sine', v: 0.2 });
  },
  refresh() {
    tone({ f: 400, f2: 900, d: 0.16, type: 'sawtooth', v: 0.08 });
    noise({ d: 0.18, v: 0.12, lp: 5000, hp: 1500 });
  },
  upgrade() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: i * 0.07, d: 0.25, type: 'triangle', v: 0.35 }));
  },
  power() {
    tone({ f: 330, f2: 990, d: 0.25, type: 'sine', v: 0.35 });
    tone({ f: 1320, t: 0.12, d: 0.3, type: 'triangle', v: 0.15 });
  },
  /** a hero power goes off by itself: a bright rising chime */
  heroFx() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: i * 0.07, d: 0.32, type: 'triangle', v: 0.22 }));
    tone({ f: 262, f2: 524, d: 0.4, type: 'sine', v: 0.25 });
  },
  /** a unit is destroyed */
  destroy() {
    if (!throttle('destroy', 90)) return;
    tone({ f: 420, f2: 70, d: 0.35, type: 'sawtooth', v: 0.18 });
    noise({ d: 0.3, v: 0.35, lp: 1800 });
  },
  hit() {
    if (!throttle('hit', 50)) return;
    tone({ f: 160, f2: 60, d: 0.14, type: 'sine', v: 0.6 });
    noise({ d: 0.07, v: 0.2, lp: 1200 });
  },
  zap() {
    if (!throttle('zap', 50)) return;
    tone({ f: 1400, f2: 300, d: 0.2, type: 'square', v: 0.08 });
  },
  shieldBreak() {
    if (!throttle('shield', 60)) return;
    [2093, 2637, 3136].forEach((f, i) => tone({ f, t: i * 0.025, d: 0.35, type: 'triangle', v: 0.16 }));
    noise({ d: 0.25, v: 0.25, lp: 9000, hp: 3000 });
  },
  reborn() {
    [392, 523, 659, 784, 1047].forEach((f, i) => tone({ f, t: i * 0.06, d: 0.4, type: 'sine', v: 0.18 }));
  },
  /** three copies rushing together */
  tripleCharge() {
    tone({ f: 220, f2: 880, d: 0.65, type: 'sawtooth', v: 0.07 });
    tone({ f: 330, f2: 1320, d: 0.65, type: 'triangle', v: 0.16 });
    noise({ d: 0.6, v: 0.1, lp: 6000, hp: 2000 });
  },
  /** the golden reveal */
  triple() {
    noise({ d: 0.35, v: 0.35, lp: 4000 });
    tone({ f: 110, f2: 55, d: 0.5, type: 'sine', v: 0.7 });
    [523, 659, 784].forEach((f) => tone({ f, d: 1.3, type: 'triangle', v: 0.22, a: 0.02 }));
    [1047, 1319, 1568, 2093].forEach((f, i) => tone({ f, t: 0.12 + i * 0.08, d: 0.6, type: 'sine', v: 0.14 }));
    [2637, 3136, 3951].forEach((f, i) => tone({ f, t: 0.5 + i * 0.07, d: 0.4, type: 'sine', v: 0.08 }));
  },
  achievement() {
    tone({ f: 1175, d: 0.18, type: 'triangle', v: 0.3 });
    tone({ f: 1568, t: 0.1, d: 0.35, type: 'triangle', v: 0.3 });
    tone({ f: 2349, t: 0.18, d: 0.4, type: 'sine', v: 0.12 });
  },
  /** a banned tribe gets stamped */
  ban() {
    tone({ f: 140, f2: 50, d: 0.25, type: 'square', v: 0.18 });
    noise({ d: 0.15, v: 0.3, lp: 900 });
  },
  reveal() {
    tone({ f: 784, d: 0.15, type: 'triangle', v: 0.25 });
    tone({ f: 1175, t: 0.06, d: 0.25, type: 'sine', v: 0.18 });
  },
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, t: i * 0.09, d: 0.35, type: 'triangle', v: 0.3 }));
  },
  lose() {
    [392, 330, 262, 196].forEach((f, i) => tone({ f, t: i * 0.12, d: 0.4, type: 'triangle', v: 0.25 }));
  },
};
