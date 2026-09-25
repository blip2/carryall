#!/usr/bin/env node
// Build the GitHub Pages site into _site/: the home page, the Copilot guide, the tool definition
// reference and the agent set-up page (rendered from the Markdown in docs/ and src/), the blank
// template (the tool builder), the example tools (as hosted "home" copies) and their sample saved
// copies. Apps point `home` at the local dev server (http://localhost:8765); here that origin is
// rewritten to the published base URL so the hosted copies are real home copies and saved copies
// link back to them.
//
//   node tools/build-site.mjs https://blip2.github.io/carryall

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './md.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('Usage: node tools/build-site.mjs <base URL>');
const REPO = 'https://github.com/blip2/carryall/blob/main/';

const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fixtures'), { recursive: true });
mkdirSync(join(out, 'copilot'), { recursive: true });

const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DEV = 'http://localhost:8765';
let rewritten = 0;
function copy(from, to, { rewrite = true } = {}) {
  let text = read(from);
  if (rewrite && text.includes(DEV)) { text = text.split(DEV).join(base); rewritten++; }
  writeFileSync(join(out, to), text);
  console.log(`  ${to}`);
}

// ── Pages ────────────────────────────────────────────────────────────────
const template = read('site/template.html');
const NAV = [['index.html', 'Home'], ['guide.html', 'Build a tool'], ['reference.html', 'Definition reference'], ['agent.html', 'Copilot agent'], ['carryall.html', 'Tool builder']];
function page(file, { title, description, main }) {
  const nav = NAV.map(([href, label]) => `<li><a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  const html = template.replace('{{title}}', () => esc(title)).replace('{{description}}', () => esc(description))
    .replace('{{nav}}', () => nav).replace('{{main}}', () => main);
  writeFileSync(join(out, file), html);
  console.log(`  ${file}`);
}
// Repository links in the Markdown become links within the site where a page exists.
const LINKS = {
  '../carryall.html': { href: 'carryall.html' },
  'carryall.html': { href: 'carryall.html' },
  '../src/definition-reference.md': { href: 'reference.html' },
  'src/definition-reference.md': { href: 'reference.html' },
  'copilot/agent-instructions.md': { href: 'agent.html#instructions' },
  'copilot/carryall-reference.md': { href: 'copilot/carryall-reference.md', download: true },
  'docs/CREATE-A-TOOL-WITH-COPILOT.md': { href: 'guide.html' },
};
const link = from => href => {
  if (LINKS[href]) return LINKS[href];
  if (/^(https?:|mailto:|#)/.test(href)) return { href };
  const path = join(dirname(from), href).replace(/\\/g, '/');
  return { href: REPO + path };
};
const toc = headings => {
  const h2 = headings.filter(h => h.level === 2);
  if (h2.length < 4) return '';
  return `<nav class="toc" aria-labelledby="toc-title"><h2 id="toc-title">On this page</h2><ul>${h2.map(h => `<li><a href="#${h.id}">${h.html}</a></li>`).join('')}</ul></nav>`;
};
function mdPage(file, from, description) {
  const { html, headings } = renderMarkdown(read(from), { link: link(from) });
  const title = headings.find(h => h.level === 1)?.html.replace(/<[^>]+>/g, '') || 'Carryall';
  // Contents after the first paragraph that follows the h1.
  const main = html.replace(/(<\/h1>\n<p>[\s\S]*?<\/p>)/, `$1\n${toc(headings)}`);
  page(file, { title: `${title} | Carryall`, description, main });
}

page('index.html', {
  title: 'Carryall: single-file tools that carry their own data',
  description: 'Build tracker and calculator tools without code: describe them to Copilot, check them in the tool builder, and share one HTML file.',
  main: read('site/home.html'),
});
mdPage('guide.html', 'docs/CREATE-A-TOOL-WITH-COPILOT.md', 'How to build a Carryall tool with Microsoft 365 Copilot and the tool builder, and how to set up the Copilot agent.');
mdPage('reference.html', 'src/definition-reference.md', 'Everything a Carryall tool definition can contain: tables, columns, formulas, views, checks, starting rows, tests and migrations.');

const instructions = read('docs/copilot/agent-instructions.md').trimEnd();
const knowledgeKb = Math.round(statSync(join(root, 'docs/copilot/carryall-reference.md')).size / 1024);
page('agent.html', {
  title: 'Set up the Copilot agent | Carryall',
  description: 'The instructions and knowledge file for the Carryall Tool Builder agent in Microsoft 365 Copilot.',
  main: `<h1>Set up the Copilot agent</h1>
<p class="lead">The Carryall Tool Builder agent writes tool definitions from a plain-English description.
  Set it up once in Microsoft 365 Copilot with Agent Builder (or Copilot Studio), then share it with the people who build tools.</p>
<div class="table-wrap"><table><thead><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead><tbody>
<tr><td>Name</td><td>Carryall Tool Builder</td></tr>
<tr><td>Description</td><td>Builds Carryall tracker and calculator tools from a plain-English description.</td></tr>
<tr><td>Instructions</td><td>All of the <a href="#instructions">instructions below</a> (${instructions.length.toLocaleString('en-GB')} characters, under the 8,000 limit).</td></tr>
<tr><td>Knowledge</td><td><a href="copilot/carryall-reference.md" download>carryall-reference.md</a> (${knowledgeKb} KB): upload it, or store it in a SharePoint folder and add that.</td></tr>
<tr><td>Starter prompts</td><td>"Build a new tool to track…" · "Change my tool: here is its definition…" · "The tool builder found these problems…"</td></tr>
</tbody></table></div>
<p>The instructions hold the rules Copilot must always follow, because an agent only reads the parts of a knowledge file that match
  the question. The knowledge file holds the full <a href="reference.html">definition reference</a> and two complete example definitions.</p>

<h2 id="instructions">Instructions</h2>
<p>Copy all of this into the agent's Instructions box.</p>
<div class="codeblock prose" data-label="Copy the agent instructions"><pre><code>${esc(instructions)}</code></pre></div>
<p><a class="btn" href="copilot/agent-instructions.md" download>Download the instructions</a>
  <a class="btn" href="copilot/carryall-reference.md" download>Download the knowledge file</a></p>

<h2 id="no-agent">No agent? Use Copilot Chat</h2>
<ol>
  <li>Download the <a href="copilot/carryall-reference.md" download>knowledge file</a>, start a new Copilot chat and attach it.</li>
  <li>Paste the instructions above as your first message, then add: <em>"Follow these instructions. I want to build: …"</em></li>
  <li>Carry on as in the <a href="guide.html">guide</a>. Start a new chat for each tool.</li>
</ol>

<h2 id="updates">When Carryall is updated</h2>
<p>Replace the agent's knowledge file with the new copy from this page, and its instructions if they have changed.</p>`,
});
copy('site/site.css', 'site.css', { rewrite: false });
copy('docs/copilot/agent-instructions.md', 'copilot/agent-instructions.md', { rewrite: false });
copy('docs/copilot/carryall-reference.md', 'copilot/carryall-reference.md', { rewrite: false });

// ── Tools ────────────────────────────────────────────────────────────────
copy('carryall.html', 'carryall.html');
for (const name of readdirSync(join(root, 'examples'))) {
  if (/\.(html|json)$/.test(name)) copy(`examples/${name}`, name);
}
for (const name of readdirSync(join(root, 'examples', 'fixtures'))) {
  if (name.endsWith('.html')) copy(`examples/fixtures/${name}`, `fixtures/${name}`);
}
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Built _site/ for ${base} (${rewritten} files had home URLs rewritten)`);
