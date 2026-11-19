// Cache-busting: stamps ?v=<version> on the CSS/JS links in index.html and on the
// relative module imports in src/*.js. GitHub Pages lets phones cache files for 10 min,
// so without this a refresh can show a new index.html with an old style.css/main.js.
// Usage (before committing): node tools/stamp.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12); // yyyymmddhhmm
const stamp = (url) => url.replace(/(\.(?:css|js))(\?v=\w+)?$/, `$1?v=${v}`);

const files = ['index.html', ...fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`)];
for (const f of files) {
  const p = path.join(root, f);
  const before = fs.readFileSync(p, 'utf8');
  const after = before
    .replace(/(href|src)="(src\/[\w.-]+\.(?:css|js)(?:\?v=\w+)?)"/g, (_, a, u) => `${a}="${stamp(u)}"`)
    .replace(/(from\s+')(\.\/[\w.-]+\.js(?:\?v=\w+)?)(')/g, (_, a, u, b) => a + stamp(u) + b);
  if (after !== before) fs.writeFileSync(p, after);
}
console.log(`stamped v=${v}`);
