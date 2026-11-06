/**
 * Self-update.
 *  - Web / installed web app (PWA): a service worker caches the game for offline play. When a new
 *    version is deployed we show a banner and reload into it.
 *  - Windows (Tauri): we fetch version.json from the update site; if it is newer we offer to download
 *    and run the new installer, then the app closes so the installer can replace it.
 */
import { UPDATE_BASE_URL } from '../config';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = __APP_VERSION__;
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface VersionInfo { version: string; date?: string; windows?: string; notes?: string }

let swUpdate: ((reload?: boolean) => Promise<void>) | null = null;

export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

function banner(text: string, actionLabel: string, action: () => void) {
  let b = document.getElementById('update-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'update-banner';
    document.body.appendChild(b);
  }
  b.innerHTML = `<span></span><button class="btn primary"></button><button class="btn">Later</button>`;
  b.querySelector('span')!.textContent = text;
  const [go, later] = b.querySelectorAll('button');
  go.textContent = actionLabel;
  go.addEventListener('click', action);
  later.addEventListener('click', () => b!.classList.remove('show'));
  b.classList.add('show');
}

async function fetchVersion(): Promise<VersionInfo | null> {
  const url = (isTauri ? UPDATE_BASE_URL : import.meta.env.BASE_URL) + 'version.json?t=' + Date.now();
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as VersionInfo;
  } catch {
    return null;
  }
}

export async function checkForUpdates(manual = false) {
  const info = await fetchVersion();
  if (!info) {
    if (manual) banner('Could not reach the update server.', 'OK', () => document.getElementById('update-banner')?.classList.remove('show'));
    return;
  }
  if (!newer(info.version, APP_VERSION)) {
    if (manual) banner(`You have the latest version (v${APP_VERSION}).`, 'OK', () => document.getElementById('update-banner')?.classList.remove('show'));
    return;
  }
  if (isTauri) {
    if (!info.windows) return;
    const url = new URL(info.windows, UPDATE_BASE_URL).toString();
    banner(`Torrekin v${info.version} is available.`, 'Install update', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      banner('Downloading update…', '…', () => undefined);
      try {
        await invoke('install_update', { url });
      } catch (e) {
        banner(`Update failed: ${e}`, 'OK', () => document.getElementById('update-banner')?.classList.remove('show'));
      }
    });
  } else {
    banner(`Torrekin v${info.version} is available.`, 'Reload', async () => {
      if (swUpdate) await swUpdate(true);
      location.reload();
    });
  }
}

export async function initUpdates() {
  if (!isTauri && 'serviceWorker' in navigator && import.meta.env.PROD) {
    try {
      const { registerSW } = await import('virtual:pwa-register');
      swUpdate = registerSW({
        onNeedRefresh() {
          banner('A new version of Torrekin is ready.', 'Reload', () => swUpdate?.(true));
        },
        onRegisteredSW(_url, reg) {
          if (reg) setInterval(() => reg.update(), 30 * 60 * 1000);
        },
      });
    } catch {
      /* no service worker support */
    }
  }
  setTimeout(() => checkForUpdates(false), 3000);
  setInterval(() => checkForUpdates(false), 30 * 60 * 1000);
}
