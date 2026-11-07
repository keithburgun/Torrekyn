/**
 * Where installed copies of the game (Windows app, phones) look for new versions.
 * The release workflow publishes version.json here together with the web build and the Windows installer.
 * If you host the game somewhere else, change this URL.
 */
export const UPDATE_BASE_URL = 'https://keithburgun.github.io/Torrekyn/';

/**
 * The Android app updates from this public repo's releases (only installers live there; the code stays private).
 * CI (.github/workflows/android.yml) uploads Torrekin.apk + version.json to it on every push to main.
 */
export const BUILDS_REPO = 'keithburgun/torrekin-builds';
export const ANDROID_VERSION_URL = `https://github.com/${BUILDS_REPO}/releases/latest/download/version.json`;
