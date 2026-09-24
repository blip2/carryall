#!/usr/bin/env node
// Build the GitHub Pages site into _site/: the index page, the blank template, the example tools
// (as hosted "home" copies) and their sample saved copies. Apps point `home` at the local dev
// server (http://localhost:8765); here that origin is rewritten to the published base URL so the
// hosted copies are real home copies and saved copies link back to them.
//
//   node tools/build-site.mjs https://blip2.github.io/carryall

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('Usage: node tools/build-site.mjs <base URL>');

const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fixtures'), { recursive: true });

const DEV = 'http://localhost:8765';
let rewritten = 0;
function copy(from, to, { rewrite = true } = {}) {
  let text = readFileSync(join(root, from), 'utf8');
  if (rewrite && text.includes(DEV)) { text = text.split(DEV).join(base); rewritten++; }
  writeFileSync(join(out, to), text);
  console.log(`  ${to}`);
}

copy('site/index.html', 'index.html', { rewrite: false });
copy('carryall.html', 'carryall.html');
for (const name of readdirSync(join(root, 'examples'))) {
  if (/\.(html|json)$/.test(name)) copy(`examples/${name}`, name);
}
for (const name of readdirSync(join(root, 'examples', 'fixtures'))) {
  if (name.endsWith('.html')) copy(`examples/fixtures/${name}`, `fixtures/${name}`);
}
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Built _site/ for ${base} (${rewritten} files had home URLs rewritten)`);
