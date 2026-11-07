/**
 * Where installed copies of the game (Windows app, phones) look for new versions.
 * The release workflow publishes version.json here together with the web build and the Windows installer.
 * If you host the game somewhere else, change this URL.
 */
export const UPDATE_BASE_URL = 'https://keithburgun.github.io/Torrekyn/';

/**
 * The Android app updates from the repo's "android-latest" release: CI (.github/workflows/android.yml)
 * replaces Torrekin.apk + version.json there on every push to main.
 */
export const ANDROID_RELEASE = 'https://github.com/keithburgun/Torrekyn/releases/download/android-latest/';
export const ANDROID_VERSION_URL = `${ANDROID_RELEASE}version.json`;

/**
 * Cloud saves (src/save/). Supabase project shared with Spellstorm, so one account works for both games.
 * The key is Supabase's public "publishable" key (safe to ship; row-level security protects each player's data).
 * Table setup: docs/cloud-saves.md.
 */
export const CLOUD = {
  supabaseUrl: 'https://bdncsprakdvvmfnxxlqr.supabase.co',
  supabaseKey: 'sb_publishable_y_mJp1WbutYXVPPKbrl1lQ_4vpZ5GqN',
};
