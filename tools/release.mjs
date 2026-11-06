// Usage: npm run release -- 0.2.0
// Bumps the version everywhere, commits, tags and pushes. The Release workflow then builds everything.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) {
  console.error('Usage: npm run release -- <major.minor.patch>');
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = v;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8').replace(/^version = ".*"$/m, `version = "${v}"`);
fs.writeFileSync('src-tauri/Cargo.toml', cargo);
const run = (c) => execSync(c, { stdio: 'inherit' });
run('npm install --package-lock-only');
run(`git add package.json package-lock.json src-tauri/Cargo.toml`);
run(`git commit -m "Release v${v}"`);
run(`git tag v${v}`);
run('git push origin HEAD --tags');
