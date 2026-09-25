#!/usr/bin/env node
// Combine copies of a Carryall document from the terminal, the same way as More, Combine with
// another copy in the tool. Runs the first file's own tool in headless Chromium.
//
//   node tools/combine.mjs a.html b.html [c.html ...] -o combined.html
//   node tools/combine.mjs a.html b.html -o combined.html --prefer ours|theirs|newest
//   node tools/combine.mjs a.html b.html --base original.html -o combined.html
//   node tools/combine.mjs a.html b.html -o combined.html --tool examples/review-tracker.html
//
// The combine runs in the first file's own copy of the tool, unless --tool names another copy
// (usually the latest, home copy), which also upgrades older files first.
// Without --prefer, the combined file is written only when there are no conflicts; otherwise
// they are listed and the exit code is 1. --base names the copy they all started from, which
// settles most differences between files saved before change stamps existed (core 0.3.0).
// Problems the tool would offer to fix (links to deleted rows, repeated references) are listed
// but left as they are.
// Needs Playwright: npm install --no-save playwright && npx playwright install chromium

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = opt('-o') || opt('--out');
const prefer = opt('--prefer');
const basePath = opt('--base');
const tool = opt('--tool');
const files = args.filter(a => !a.startsWith('-'));
if (files.length < 2 || !out || (prefer && !['ours', 'theirs', 'newest'].includes(prefer))) {
  console.error('Usage: node tools/combine.mjs a.html b.html [more.html ...] -o combined.html [--prefer ours|theirs|newest] [--base original.html]');
  process.exit(2);
}

const DATA_RE = /^<script type="application\/json" id="ca-data">\n?([\s\S]*?)\n?<\/script>/m;
function data(file) {
  const text = readFileSync(resolve(file), 'utf8').replace(/\r\n/g, '\n');
  if (/\.json$/i.test(file)) return JSON.parse(text);
  const m = DATA_RE.exec(text);
  const raw = m && m[1].trim();
  if (!raw || raw === 'null') fail(`${file} has no data in it.`);
  return JSON.parse(raw);
}
const first = data(files[0]);
const others = files.slice(1).map(f => [f, data(f)]);
const base = basePath ? data(basePath) : null;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { fail('This needs Playwright: npm install --no-save playwright && npx playwright install chromium'); }
const browser = await chromium.launch(process.env.CARRYALL_CHROMIUM ? { executablePath: process.env.CARRYALL_CHROMIUM } : {});
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve(tool || files[0])).href);
  await page.waitForFunction(() => window.Carryall && window.Carryall._state.app);
  if (!(await page.evaluate(() => typeof window.Carryall.combine === 'function'))) {
    fail(`${tool || files[0]} has an older Carryall core that cannot combine copies. Add --tool with the latest copy of the tool.`);
  }
  const result = await page.evaluate(({ first, others, base, prefer }) => {
    let doc = first;
    const report = [];
    for (const [name, other] of others) {
      const r = window.Carryall.combine(doc, other, { base, prefer });
      report.push({ name, changes: r.changes, conflicts: r.conflicts, issues: r.issues });
      if (!r.settled) return { report, html: null };
      doc = r.doc;
    }
    return { report, html: window.Carryall.fileText(doc) };
  }, { first, others, base, prefer });
  for (const r of result.report) {
    console.log(`${r.name}: ${r.changes} changes taken in, ${r.conflicts.length} conflicts${r.conflicts.length && prefer ? ` settled by keeping ${prefer}` : ''}.`);
    if (!prefer) r.conflicts.forEach((c, i) => console.log(`  ${i + 1}. ${[c.table, c.id, c.field].filter(Boolean).join(' › ') || c.kind}${c.reason ? ` (${c.reason})` : ''}: ours ${JSON.stringify(c.ours)}, theirs ${JSON.stringify(c.theirs)}`));
    if (r.issues?.length) console.log(`  To check in the tool afterwards:\n${r.issues.map(x => `  - ${x}`).join('\n')}`);
  }
  if (!result.html) {
    console.log('\nNot written. Combine the copies in the tool to choose for each conflict, or use --prefer ours, theirs or newest.');
    process.exitCode = 1;
  } else {
    writeFileSync(resolve(out), result.html);
    console.log(`Wrote ${out}.`);
  }
} finally { await browser.close(); }

function fail(msg) { console.error(msg); process.exit(1); }
