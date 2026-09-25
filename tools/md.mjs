// A small Markdown renderer for the site's guide and reference pages: headings (with ids), paragraphs,
// lists, tables, fenced code, rules, bold, italic, inline code and links. Enough for our own docs;
// not a general-purpose implementation.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

// link(href) -> { href, download? } lets the caller map repository paths to site pages.
export function renderMarkdown(src, { link = href => ({ href }) } = {}) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const inline = s => s.split(/(`[^`]+`)/).map(part => {
    if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
    let t = esc(part);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
      const l = link(href.replace(/&amp;/g, '&'));
      return `<a href="${esc(l.href)}"${l.download ? ' download' : ''}>${text}</a>`;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,:;!?]|$)/g, '$1<em>$2</em>');
    return t;
  }).join('');
  const isBlockStart = l => /^(#{1,6}\s|```|\|)/.test(l) || /^\s*([-*]|\d+\.)\s+/.test(l) || /^---+\s*$/.test(l);
  const cells = l => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^```(\w*)/.exec(l))) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<div class="codeblock"><pre><code${m[1] ? ` class="language-${m[1]}"` : ''}>${esc(code.join('\n'))}</code></pre></div>`);
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      const level = m[1].length, html = inline(m[2]), id = slug(html);
      headings.push({ level, id, html });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\|/.test(l) && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1])) {
      const head = cells(l);
      const align = cells(lines[i + 1]).map(c => (/:$/.test(c) && /^:/.test(c) ? 'center' : /:$/.test(c) ? 'right' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}${tag === 'th' ? ' scope="col"' : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if ((m = /^(\s*)([-*]|\d+\.)\s+/.exec(l))) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length) {
        const x = lines[i];
        const im = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(x);
        if (im && /\d/.test(im[2]) === ordered) { items.push(im[3]); i++; continue; }
        if (x.trim() && /^\s{2,}\S/.test(x) && items.length) { items[items.length - 1] += ' ' + x.trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i]))) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { html: out.join('\n'), headings };
}
