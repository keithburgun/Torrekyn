# itch.io

Every push to `main` uploads Torrekin to itch.io with butler:

| Channel | What | Built by |
|---|---|---|
| `html5` | the browser version (zip with `index.html`) | `.github/workflows/itch.yml` (`npm run build:itch`) |
| `windows` | the Windows app (`Torrekin.exe`, no installer; the itch app installs and updates it) | `.github/workflows/itch.yml` |
| `android` | the APK | `.github/workflows/android.yml` |

The version shown on itch.io is `<package version>-build.<run number>`. The upload script is
`.github/scripts/itch_push.sh`; each run's summary (Actions → the run) lists what was uploaded.

## One-time setup

1. On itch.io, create the game page (Dashboard → Create new project). Kind of project: **HTML**. Save it as a
   draft. Its URL gives the game name, e.g. `https://keithburgun.itch.io/torrekin` → `keithburgun/torrekin`.
2. On GitHub, in this repo: **Settings → Secrets and variables → Actions**
   - **Secrets** → New repository secret: `BUTLER_API_KEY` = your itch.io API key (itch.io → Settings → API keys;
     the same key Spellstorm uses works).
   - **Variables** → New repository variable: `ITCH_GAME` = `keithburgun/torrekin` (your page's name).
3. Push anything (or Actions → itch.io → Run workflow). After the first upload, on the itch.io page's edit screen
   tick **"This file will be played in the browser"** next to the html5 upload, set the embed size (1600 × 900,
   with **Fullscreen button** and **Mobile friendly** on), and publish the page when you're ready.

Until the secret and variable exist, the builds still run and the uploads are skipped with a notice.
