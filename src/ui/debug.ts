/**
 * DEBUG MODE: any error is printed on screen in small red text (bottom-left), so playtesters can see and report
 * it. On by default for now; switch it off in Options. The list sits outside the game's stage, so redraws
 * don't clear it. Tap it to clear.
 */
const KEY = 'torrekin-debug';
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* storage unavailable: stays on */ }

const lines: string[] = [];
let box: HTMLElement | null = null;

export const debugOn = () => on;

export function setDebug(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  draw();
}

function text(x: unknown): string {
  if (x instanceof Error) {
    const at = x.stack?.split('\n').find((l) => /\d+:\d+/.test(l) && !l.includes(x.message))?.trim();
    return `${x.name}: ${x.message}${at ? ` (${at.replace(/^at\s+/, '').replace(/https?:\/\/[^)\s]*\//g, '')})` : ''}`;
  }
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

export function debugError(...parts: unknown[]) {
  const t = new Date();
  const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
  const line = `${time} ${parts.map(text).join(' ')}`.slice(0, 400);
  if (lines[lines.length - 1]?.endsWith(line.slice(9))) return; // the same error again
  lines.push(line);
  if (lines.length > 8) lines.shift();
  draw();
}

function draw() {
  if (typeof document === 'undefined' || !document.body) return;
  if (!box) {
    box = document.createElement('div');
    box.id = 'debug-errors';
    box.title = 'Errors (DEBUG MODE). Tap to clear.';
    box.addEventListener('click', () => { lines.length = 0; draw(); });
    document.body.appendChild(box);
  }
  box.hidden = !on || !lines.length;
  box.textContent = lines.join('\n');
}

/** catch everything: uncaught errors, failed promises, and anything logged with console.error */
export function installDebug() {
  window.addEventListener('error', (e) => debugError(e.error ?? `${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => debugError('Unhandled:', e.reason));
  const orig = console.error.bind(console);
  console.error = (...a: unknown[]) => { orig(...a); debugError(...a); };
}
