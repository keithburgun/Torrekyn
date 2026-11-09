// Usage: node tools/bump.mjs <patch|minor|major|x.y.z> "What changed" ["Another change" ...]
// Bumps the game's version (package.json, Cargo.toml, package-lock.json) and adds an entry at the top of
// CHANGELOG.md. It doesn't tag (a v* tag starts the full Release workflow; see tools/release.mjs for that).
// Every update that ships gets a bump: patch for fixes and small tweaks, minor for new content or reworks.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const [kind, ...notes] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const v = /^\d+\.\d+\.\d+$/.test(kind ?? '') ? kind
  : kind === 'major' ? `${ma + 1}.0.0` : kind === 'minor' ? `${ma}.${mi + 1}.0` : kind === 'patch' ? `${ma}.${mi}.${pa + 1}` : null;
if (!v || !notes.length) {
  console.error('Usage: node tools/bump.mjs <patch|minor|major|x.y.z> "change" ["change" ...]');
  process.exit(1);
}
pkg.version = v;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8').replace(/^version = ".*"$/m, `version = "${v}"`);
fs.writeFileSync('src-tauri/Cargo.toml', cargo);
execSync('npm install --package-lock-only --silent', { stdio: 'inherit' });
const date = new Date().toISOString().slice(0, 10);
const head = '# Torrekin changelog\n\nNewest first. The version shows on the title screen.\n';
const old = fs.existsSync('CHANGELOG.md') ? fs.readFileSync('CHANGELOG.md', 'utf8').replace(head, '') : '';
fs.writeFileSync('CHANGELOG.md', `${head}\n## ${v} — ${date}\n${notes.map((n) => `- ${n}`).join('\n')}\n${old}`);
console.log(`v${v}`);
