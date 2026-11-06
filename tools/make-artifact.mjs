// Turns the artifact build (dist-artifact/index.html) into a page body that can be published to Claude,
// and prints the list of supporting files.
import fs from 'node:fs';
import path from 'node:path';

const dir = 'dist-artifact';
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const keep = (head.match(/<(script|link)[^>]*>(<\/script>)?/g) ?? []).filter((t) => !/manifest|apple-touch|rel="icon"/.test(t));
const page = `<title>Torrekin</title>
<meta name="theme-color" content="#e9dcff">
${keep.join('\n')}
${body.trim()}
`;
fs.writeFileSync(path.join(dir, 'torrekin.html'), page);
const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (!['index.html', 'torrekin.html', 'version.json'].includes(f)) files.push(path.relative(dir, p));
  }
};
walk(dir);
const map = Object.fromEntries(files.map((f) => [f, path.join(dir, f)]));
fs.writeFileSync(path.join(dir, 'files.json'), JSON.stringify(map));
console.log(page);
console.log(files.length, 'files');
