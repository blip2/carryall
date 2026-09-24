#!/usr/bin/env node
// Stamp the current core (src/core.css, src/core.js, src/readme.txt) into Carryall HTML files.
// Only the core blocks, the README comment and the data-ca-core attribute are touched;
// app code (#ca-app, #ca-app-css) and data (#ca-data) are left exactly as they are.
//
//   node tools/sync-core.mjs                 # template + every examples/**/*.html
//   node tools/sync-core.mjs path/to/app.html [more.html ...]
//   node tools/sync-core.mjs --check         # exit 1 if any file is out of date

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

const css = read('src/core.css').trimEnd();
const js = read('src/core.js').trimEnd();
const version = /const CORE_VERSION = '([^']+)'/.exec(js)?.[1];
if (!version) throw new Error('CORE_VERSION not found in src/core.js');
const readme = read('src/readme.txt').replaceAll('{{CORE_VERSION}}', version).trimEnd();

// Guard against content that would break out of its container when inlined.
const bad = [
  [js, /<\/script|<!--/i, 'src/core.js must not contain "</script" or "<!--"'],
  [css, /<\/style/i, 'src/core.css must not contain "</style"'],
  [readme, /--/, 'src/readme.txt must not contain "--" (it lives inside an HTML comment)'],
];
for (const [text, re, msg] of bad) if (re.test(text)) throw new Error(msg);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue; // e.g. _saved/ test captures from dev-server
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const check = args.includes('--check');
let files = args.filter(a => !a.startsWith('--'));
if (!files.length) files = [join(root, 'carryall.html'), ...walk(join(root, 'examples'))];

// Blocks match only at the start of a line: the (indented) README mentions these tags too.
const blocks = [
  [/^<!--ca-readme[\s\S]*?-->/m, () => `<!--ca-readme\n${readme}\n-->`],
  [/^<style id="ca-core-css">[\s\S]*?<\/style>/m, () => `<style id="ca-core-css">\n${css}\n</style>`],
  [/^<script id="ca-core">[\s\S]*?<\/script>/m, () => `<script id="ca-core">\n${js}\n</script>`],
  [/^(<html\b[^>]*?) data-ca-core="[^"]*"/m, (_, open) => `${open} data-ca-core="${version}"`],
];

let stale = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  let after = before;
  for (const [re, replacer] of blocks) {
    if (!re.test(after)) throw new Error(`${relative(root, f)}: missing block ${re}`);
    after = after.replace(re, replacer); // function form: no $-pattern surprises
  }
  if (after === before) { console.log(`  up to date  ${relative(root, f)}`); continue; }
  stale++;
  if (check) console.log(`  STALE       ${relative(root, f)}`);
  else { writeFileSync(f, after); console.log(`  synced      ${relative(root, f)} → core ${version}`); }
}
if (check && stale) process.exit(1);
