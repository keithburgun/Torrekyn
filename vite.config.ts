import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
// `npm run build:artifact` makes a copy for playing inside Claude (no service worker, no update checks)
const isArtifact = process.env.TORREKIN_TARGET === 'artifact';
// `npm run build:android` makes the copy wrapped into the Android app (Capacitor, see capacitor.config.json)
const isAndroid = process.env.TORREKIN_TARGET === 'android';

export default defineConfig({
  base: './',
  // __NO_UPDATES__: the copy inside Claude (it can't update itself). __ANDROID__: the Android app, which updates
  // from the public builds repo. __BUILD__: CI run number (TORREKIN_BUILD), how the Android app tells builds apart.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __NO_UPDATES__: JSON.stringify(isArtifact),
    __ANDROID__: JSON.stringify(isAndroid),
    __BUILD__: JSON.stringify(Number(process.env.TORREKIN_BUILD ?? 0)),
  },
  build: { target: 'es2021', chunkSizeWarningLimit: 1500, outDir: isArtifact ? 'dist-artifact' : isAndroid ? 'dist-android' : 'dist' },
  server: { port: 5173, strictPort: true },
  plugins: [
    {
      name: 'torrekin-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({
            version: pkg.version,
            date: new Date().toISOString(),
            windows: `downloads/Torrekin_${pkg.version}_x64-setup.exe`,
          }, null, 1),
        });
      },
    },
    VitePWA({
      disable: isTauri || isArtifact || isAndroid,
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        globIgnores: ['downloads/**'],
        navigateFallbackDenylist: [/version\.json/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'Torrekin',
        short_name: 'Torrekin',
        description: 'A single-player autobattler.',
        theme_color: '#120d0a',
        background_color: '#07050a',
        display: 'fullscreen',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
});
