/**
 * Self-update.
 *  - Web / installed web app (PWA): a service worker caches the game for offline play. When a new
 *    version is deployed we show a banner and reload into it.
 *  - Windows (Tauri): we fetch version.json from the update site; if it is newer we offer to download
 *    and run the new installer, then the app closes so the installer can replace it.
 *  - Android app: we read version.json from the android-latest release; if its build number is higher we
 *    download the new APK inside the app (ApkUpdaterPlugin.java) and hand it to Android's installer.
 *    Your progress is kept (it lives in the app's storage, which an update doesn't touch).
 */
import { registerPlugin } from '@capacitor/core';
import { ANDROID_VERSION_URL, UPDATE_BASE_URL } from '../config';

declare const __APP_VERSION__: string;
declare const __ANDROID__: boolean;
declare const __BUILD__: number;
export const APP_VERSION: string = __APP_VERSION__;
export const BUILD: number = __BUILD__;

interface ApkUpdater {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  fetchText(o: { url: string }): Promise<{ text: string }>;
  downloadAndInstall(o: { url: string }): Promise<void>;
  addListener(ev: 'progress', fn: (d: { percent: number }) => void): Promise<{ remove: () => Promise<void> }>;
}
const apk = __ANDROID__ ? registerPlugin<ApkUpdater>('ApkUpdater') : null;

/** a short version label: "v0.1.0" on PC/web, "v0.1.0 · build 42" in the Android app */
export const versionLabel = () => `v${APP_VERSION}${__ANDROID__ && BUILD ? ` · build ${BUILD}` : ''}`;
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface VersionInfo { version: string; build?: number; date?: string; windows?: string; apk?: string; notes?: string }

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

const hide = () => document.getElementById('update-banner')?.classList.remove('show');

/** Android: is a newer build waiting on the android-latest release? */
async function checkAndroid(manual: boolean) {
  let info: VersionInfo;
  try {
    const r = await apk!.fetchText({ url: `${ANDROID_VERSION_URL}?t=${Date.now()}` });
    info = JSON.parse(r.text) as VersionInfo;
  } catch {
    if (manual) banner('Could not reach the update server.', 'OK', hide);
    return;
  }
  if (!info.build || !info.apk || info.build <= BUILD) {
    if (manual) banner(`You have the latest version (${versionLabel()}).`, 'OK', hide);
    return;
  }
  const notes = info.notes ? ` ${info.notes}` : '';
  banner(`A new version of Torrekin is ready (build ${info.build}).${notes}`, 'Update', () => void installAndroid(info.apk!));
}

async function installAndroid(url: string) {
  const { allowed } = await apk!.canInstall();
  if (!allowed) {
    // Android asks once: allow Torrekin to install its own updates
    banner('Android needs your OK to let Torrekin install updates. Turn on "Allow from this source", then come back and tap Update.', 'Open settings', async () => {
      await apk!.openInstallSettings();
      banner('Ready when you are.', 'Update', () => void installAndroid(url));
    });
    return;
  }
  banner('Downloading update… 0%', '…', () => undefined);
  const sub = await apk!.addListener('progress', ({ percent }) => {
    const span = document.querySelector('#update-banner span');
    if (span) span.textContent = `Downloading update… ${percent}%`;
  });
  try {
    await apk!.downloadAndInstall({ url });
    banner('Tap Install on the next screen. Torrekin restarts with your progress kept.', 'OK', hide);
  } catch (e) {
    banner(`Update failed: ${(e as Error).message ?? e}`, 'Try again', () => void installAndroid(url));
  } finally {
    await sub.remove();
  }
}

export async function checkForUpdates(manual = false) {
  if (apk) return checkAndroid(manual);
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
  if (!isTauri && !__ANDROID__ && 'serviceWorker' in navigator && import.meta.env.PROD) {
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
