#!/usr/bin/env node
// Check a Carryall tool definition from the terminal: the same checks as the tool builder, printed
// as a list with a non-zero exit code when there are problems. Made for coding agents such as
// GitHub Copilot in VS Code, which can run it after every edit and read the result.
//
//   node tools/check.mjs examples/my-tool.html        check the definition in #ca-spec
//   node tools/check.mjs my-tool.json                 check a definition file
//   node tools/check.mjs examples/my-tool.html --selftest
//        also run the full self-test (renders every view, runs the tests and migrations) in
//        headless Chromium. Needs Playwright: npm install --no-save playwright && npx playwright install chromium

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const selftest = args.includes('--selftest');
if (!file) {
  console.error('Usage: node tools/check.mjs <tool.html | definition.json> [--selftest]');
  process.exit(2);
}

const SPEC_RE = /^<script type="application\/json" id="ca-spec">\n?([\s\S]*?)\n?<\/script>/m;
const source = readFileSync(resolve(file), 'utf8').replace(/\r\n/g, '\n');
const isHtml = /\.html?$/i.test(file);
let text = source;
if (isHtml) {
  const m = SPEC_RE.exec(source);
  if (!m) fail(`${file} has no <script type="application/json" id="ca-spec"> block. Copy carryall.html and put the definition there.`);
  text = m[1].trim();
  if (!text || text === 'null') fail(`${file} has no tool definition yet: #ca-spec is null.`);
}

// Run the core with just enough of a browser around it to use its definition checker.
const coreJs = /\(function \(\) \{[\s\S]*\}\)\(\);/.exec(readFileSync(join(root, 'src', 'core.js'), 'utf8'))[0];
const sandbox = {
  console, Intl, crypto: globalThis.crypto, setTimeout, clearTimeout,
  location: { protocol: 'file:', href: 'file:///check', pathname: '/check', search: '', hash: '', origin: 'null' },
  document: { readyState: 'loading', addEventListener() {}, getElementById: () => null },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(coreJs, sandbox, { filename: 'src/core.js' });
const result = sandbox.Carryall.checkDefinition(text);

const groups = { error: [], warning: [], fixed: [] };
for (const p of result.problems) groups[p.level]?.push(p);
const line = (p, i) => `  ${i + 1}. ${p.where}: ${p.message}`;
if (groups.error.length) console.log(`${groups.error.length} problem${groups.error.length === 1 ? '' : 's'} to fix:\n${groups.error.map(line).join('\n')}`);
if (groups.warning.length) console.log(`\nSuggestions:\n${groups.warning.map(line).join('\n')}`);
if (groups.fixed.length) console.log(`\nTidied automatically (the tool builder would save the corrected definition):\n${groups.fixed.map(line).join('\n')}`);
if (groups.error.length) process.exit(1);
console.log(`${groups.warning.length || groups.fixed.length ? '\n' : ''}Definition OK: ${result.definition.name} ${result.definition.version}.`);

if (!selftest) {
  console.log('Run with --selftest to render every view and run the tests and migrations.');
  process.exit(0);
}

// Full self-test in headless Chromium.
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { fail('The self-test needs Playwright: npm install --no-save playwright && npx playwright install chromium. Or open the file with ?selftest in a browser.'); }
let target = resolve(file);
if (!isHtml) {
  // A bare definition: put it into a copy of the blank template.
  const dir = mkdtempSync(join(tmpdir(), 'carryall-check-'));
  target = join(dir, 'tool.html');
  const template = readFileSync(join(root, 'carryall.html'), 'utf8');
  writeFileSync(target, template.replace(SPEC_RE, () => `<script type="application/json" id="ca-spec">\n${text.replace(/</g, '\\u003c')}\n</script>`));
}
const browser = await chromium.launch(process.env.CARRYALL_CHROMIUM ? { executablePath: process.env.CARRYALL_CHROMIUM } : {});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(target).href);
  await page.waitForFunction(() => window.Carryall && window.Carryall._state.app);
  const st = await page.evaluate(() => window.Carryall.selfTest(false));
  const failed = st.results.filter(r => !r.pass);
  console.log(`Self-test: ${st.passed} of ${st.passed + st.failed} checks passed.`);
  failed.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}${r.detail ? ': ' + r.detail : ''}`));
  errors.forEach(e => console.log(`  Page error: ${e}`));
  process.exitCode = failed.length || errors.length ? 1 : 0;
} finally { await browser.close(); }

function fail(msg) { console.error(msg); process.exit(1); }
