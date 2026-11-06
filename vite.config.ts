import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true },
  build: { target: 'es2021', chunkSizeWarningLimit: 1500 },
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
    ...(isTauri ? [] : [VitePWA({
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
        orientation: 'landscape',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    })]),
  ],
});
