# Torrekin

A single-player autobattler in the style of Hearthstone: Battlegrounds, with 6 players, 60 Health, a 15 damage cap, its own tribes and cards, and slot bonuses.

It runs on **Windows** (installer), in any **web browser**, and on **phones and tablets** (installable web app). Every version checks for updates on its own.

## Playing locally
```bash
npm install
npm run dev          # http://localhost:5173
```

## Project layout
| Path | What it is |
|---|---|
| `src/engine/` | Game rules (no UI): `game.ts` shop & rounds, `combat.ts` battles, `effects.ts` every card's ability, `heroes.ts` heroes & trinkets, `ai.ts` opponents |
| `src/ui/` | Interface: shop/board/hand (`app.ts`), combat playback (`combatView.ts`), self-update (`update.ts`) |
| `src/data/cards.json` | Card data, generated from the spreadsheet |
| `src/data/art.json` | Which image each card uses |
| `public/art/` | Generated placeholder art (cards, heroes, board, menu) |
| `tools/import_cards.py` | Spreadsheet → `cards.json` (Golden text lives here too) |
| `tools/gen-art.mjs` | Regenerates placeholder art |
| `src-tauri/` | Windows app wrapper (Tauri) |
| `DESIGN_NOTES.md` | Rules decisions and card interpretations |

## Updating cards
Edit the spreadsheet, then:
```bash
python3 tools/import_cards.py path/to/cards.xlsx     # rewrites src/data/cards.json
npm test                                             # runs 150 simulated games
```
New card **abilities** need code in `src/engine/effects.ts` (one entry per card id).

## Replacing art
Drop images in `public/art/cards/` (any of png/webp/jpg/svg). Then point the card at the file in `src/data/art.json`, for example `"lich": "art/cards/lich.png"`. Square images around 512×512 work best. Hero portraits are `public/art/heroes/<n>.svg`. The board is `public/art/board.svg` and the menu background is `public/art/menu.svg`.

## Making a new version
```bash
npm run release -- 0.2.0
```
This bumps the version, tags `v0.2.0` and pushes. GitHub Actions then:
1. runs the tests, builds the **Windows installer** and attaches it to a GitHub Release;
2. builds the **web version**, bundling `version.json` and the installer, and deploys it to **GitHub Pages**. This step only runs once Pages is turned on; see below.

### Self-update
- **Web / phones:** the game is cached for offline play. When a new version is deployed, players get a "new version — Reload" banner.
- **Windows:** the app checks `version.json` on the update site. When a newer version is out it offers "Install update", which downloads and runs the new installer.
- The update site is set in `src/config.ts` (default `https://keithburgun.github.io/Torrekyn/`).

### Turning on the web version and updates (one-time)
The repo is private, so nothing is public yet. To publish:
1. GitHub → Settings → Pages → Source: **GitHub Actions**. Pages on a private repo needs a paid GitHub plan; otherwise make the repo public.
2. GitHub → Settings → Secrets and variables → Actions → Variables → add `DEPLOY_PAGES` = `true`.
3. Run `npm run release -- <next version>`.

Until then, the Windows installer is still built and attached to each Release, and you can download it from the Releases page.

### Windows note
The installer isn't code-signed yet, so Windows SmartScreen will warn on first install ("More info → Run anyway"). Signing needs a code-signing certificate.

## Building Windows locally (on a Windows PC)
Install [Rust](https://rustup.rs) and Node 22, then `npm install` and `npm run tauri:build`.
