/* Carryall core runtime. Do not edit inside an app file: this block is replaced
   wholesale by tools/sync-core.mjs when the core is upgraded. App code lives in
   <script id="ca-app">. See the README comment at the top of this file. */
(function () {
  'use strict';

  const CORE_VERSION = '0.2.0';
  const FORMAT = 'carryall/1';
  const PAGE = 500;                 // rows rendered before "show more"
  const SOFT_ROWS = 5000;           // size advisory thresholds
  const SOFT_BYTES = 5 * 1024 * 1024;
  const COLUMN_TYPES = ['text', 'longtext', 'number', 'currency', 'percent', 'date', 'boolean', 'choice', 'ref', 'computed'];
  const NUMERIC = ['number', 'currency', 'percent'];

  // ── State ──────────────────────────────────────────────────────────────
  const S = {
    app: null,            // normalised app definition
    plugins: [],
    viewTypes: {},        // plugin-registered view renderers
    data: null,           // the live document envelope
    dirty: false,
    readOnly: false,
    fileName: null,
    handle: null,         // FileSystemFileHandle for save-in-place (html only)
    tab: 0,
    viewState: {},
    undo: [], redo: [],
    shell: null,          // pristine <html> clone used to build exports
    isHome: false,
    isLocal: location.protocol === 'file:',
    banners: [],
    user: null,
    root: null,
    seeding: false,       // true while onNew fills a new document
    defineError: null,    // error thrown by Carryall.app(), shown instead of the app
    spec: null,           // the JSON tool definition, for tools built from one
    mode: null,           // 'builder' | 'preview' while the tool builder is open
    builder: null,
    calc: null,           // per-render cache of calculated values (WeakMap row -> Map)
    lastCalcError: null,
  };

  // ── Small utilities ────────────────────────────────────────────────────
  const ALPHA = '0123456789abcdefghjkmnpqrstvwxyz';
  function uid(n = 10) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(b, x => ALPHA[x & 31]).join('');
  }
  const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const nowISO = () => new Date().toISOString();
  const pad = n => String(n).padStart(2, '0');
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseDate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function daysBetween(a, b) {
    const x = parseDate(a), y = parseDate(b);
    return x && y ? Math.round((y - x) / 86400000) : null;
  }
  function yearsBetween(a, b) {
    const d = daysBetween(a, b);
    return d == null ? null : d / 365.25;
  }
  function addDays(iso, n) {
    const d = parseDate(iso);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addMonths(iso, n) {
    const d = parseDate(iso);
    if (!d) return null;
    d.setMonth(d.getMonth() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const titleCase = k => k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function cmpSemver(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
    return 0;
  }
  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function fmtBytes(n) {
    return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  }

  // DOM builder: h('div', {class: 'x', onclick: fn}, 'text', child, [more])
  function h(tag, props, ...kids) {
    if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'open', 'indeterminate'].includes(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false || k === true) continue;
      el.append(k instanceof Node ? k : String(k));
    }
    return el;
  }

  // ── App definition ─────────────────────────────────────────────────────
  function defineApp(def) {
    if (S.app) throw new Error('Carryall.app() called twice');
    try { return (S.app = buildApp(def)); } catch (e) { S.defineError = e; throw e; }
  }
  // Tables, columns and settings fields may also be written as arrays of objects
  // with an "id" (a shape LLMs often produce); they are keyed by that id here.
  function keyed(x, what, fail) {
    if (!Array.isArray(x)) return x || {};
    const out = {};
    x.forEach((item, i) => {
      const k = item && (item.id || item.key);
      if (!k) fail(`${what} ${i + 1} needs an "id"`);
      if (out[k]) fail(`${what} "${k}" is defined twice`);
      const { id: _id, key: _key, ...rest } = item;
      out[k] = rest;
    });
    return out;
  }
  function buildApp(def) {
    const fail = m => { throw new Error('Carryall app definition: ' + m); };
    if (!def || !def.id) fail('"id" is required');
    if (!Number.isInteger(def.schemaVersion) || def.schemaVersion < 1) fail('"schemaVersion" must be an integer >= 1');
    const app = {
      name: def.id, version: '0.0.0', description: '', locale: 'en-GB', currency: 'GBP',
      home: null, versionUrl: null, identity: null, migrations: {}, fixtures: [], views: [],
      ...def,
    };
    app.tables = {};
    for (const [tk, t] of Object.entries(keyed(def.tables, 'Table', fail))) app.tables[tk] = normTable(tk, t, fail);
    if (def.onNew != null && typeof def.onNew !== 'function') fail('"onNew" must be a function (doc, api) => { ... }');
    let settings = def.settings;
    if (settings && !settings.columns && settings.fields) {
      const { fields, defaults = {}, ...rest } = settings;
      const columns = keyed(fields, 'Settings field', fail);
      for (const [k, c] of Object.entries(columns)) if (c.default === undefined && defaults[k] !== undefined) c.default = defaults[k];
      settings = { ...rest, columns };
    }
    app.settings = settings ? normTable('settings', { label: 'Settings', ...settings }, fail) : null;
    if (!app.views.length) app.views = Object.keys(app.tables).map(t => ({ type: 'table', table: t }));
    app.views = app.views.map((v, i) => ({ title: v.title || (v.table && app.tables[v.table]?.label) || `View ${i + 1}`, ...v }));
    return app;
  }
  function normTable(key, t, fail) {
    const columns = {};
    for (const [ck, c] of Object.entries(keyed(t.columns, `Column in table "${key}"`, fail))) {
      const col = typeof c === 'string' ? { type: c } : { ...c };
      col.key = ck;
      col.type = col.type || 'text';
      col.label = col.label || titleCase(ck);
      if (!col.options && Array.isArray(col.choices)) col.options = col.choices;
      columns[ck] = col;
    }
    const keys = Object.keys(columns);
    return {
      key, label: t.label || titleCase(key), singular: t.singular || 'row', ...t, columns,
      display: t.display || keys.find(k => columns[k].type === 'text') || keys[0],
    };
  }

  // ── Document properties (common to every Carryall tool) ────────────────
  // Stored in doc.properties. Separate from meta.revision, which just counts saves.
  const PROPERTY_DEFAULTS = {
    projectNumber: null, projectName: null,
    createdBy: null, updatedBy: null,
    checkedBy: null, checkedAt: null, checkedHash: null,
    revisions: [],       // [{ rev, date, description, by, checkedBy }], oldest first
  };
  const propsOn = () => S.app.properties !== false;
  const requiredProps = () => (S.app.properties && S.app.properties.required) || ['projectNumber', 'projectName'];
  function currentUser() {
    if (S.user) return S.user;
    try { return localStorage.getItem('carryall.user') || null; } catch { return null; }
  }
  function setCurrentUser(name) {
    try { name ? localStorage.setItem('carryall.user', name) : localStorage.removeItem('carryall.user'); } catch { /* storage blocked */ }
  }
  // FNV-1a over the data (not the properties), used to tell whether a check is still current.
  function dataHash(doc = S.data) {
    const str = JSON.stringify([doc.tables, doc.settings]);
    let x = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x.toString(16).padStart(8, '0');
  }
  function checkState(doc = S.data) {
    const p = doc.properties;
    if (!p.checkedBy) return { state: 'unchecked' };
    return { state: p.checkedHash === dataHash(doc) ? 'checked' : 'stale', by: p.checkedBy, at: p.checkedAt };
  }
  const currentRevision = (doc = S.data) => doc.properties.revisions[doc.properties.revisions.length - 1] || null;
  function nextRevisionCode(prev) {
    if (!prev) return (S.app.properties && S.app.properties.firstRevision) || 'P01';
    const m = /^(.*?)(\d+)$/.exec(prev);
    if (m) return m[1] + String(+m[2] + 1).padStart(m[2].length, '0');
    if (/^[A-Y]$/i.test(prev)) return String.fromCharCode(prev.charCodeAt(0) + 1);
    return '';
  }
  // Wording follows the save mode: a plain download is not called "saving".
  const saveWord = () => (S.app.saveInPlace ? 'Save' : 'Download');
  const unsavedWord = () => (S.app.saveInPlace ? 'unsaved' : 'not downloaded');
  const missingProps = () => (propsOn() ? requiredProps().filter(k => !S.data.properties[k]) : []);

  // ── Document envelope ──────────────────────────────────────────────────
  function settingsDefaults() {
    const out = {};
    if (!S.app.settings) return out;
    for (const c of Object.values(S.app.settings.columns)) {
      if (c.type === 'computed') continue;
      out[c.key] = typeof c.default === 'function' ? c.default() : (c.default ?? null);
    }
    return out;
  }
  function newDocument() {
    const doc = {
      format: FORMAT,
      app: { id: S.app.id, version: S.app.version, schemaVersion: S.app.schemaVersion },
      meta: { docId: uid(16), revision: 0, created: nowISO(), savedAt: null, coreVersion: CORE_VERSION },
      properties: { createdBy: currentUser() },
      settings: settingsDefaults(),
      tables: Object.fromEntries(Object.keys(S.app.tables).map(k => [k, []])),
    };
    if (typeof S.app.onNew === 'function') {
      // Point the api at the new document so onNew can use api.insert/rows/update.
      // Seeding is not an edit: no undo entry, no unsaved marker, no re-render.
      const prev = S.data;
      S.data = doc; S.seeding = true;
      try { S.app.onNew(doc, makeApi()); } finally { S.data = prev; S.seeding = false; }
    }
    return normalise(doc);
  }
  function normalise(doc) {
    doc.format = doc.format || FORMAT;
    doc.app = doc.app || {};
    doc.meta = { revision: 0, savedAt: null, ...(doc.meta || {}) };
    if (!doc.meta.docId) doc.meta.docId = uid(16);
    doc.properties = { ...PROPERTY_DEFAULTS, ...(doc.properties || {}) };
    if (doc.meta.savedBy && !doc.properties.updatedBy) doc.properties.updatedBy = doc.meta.savedBy;
    delete doc.meta.savedBy;
    if (!Array.isArray(doc.properties.revisions)) doc.properties.revisions = [];
    doc.settings = { ...settingsDefaults(), ...(doc.settings || {}) };
    doc.tables = doc.tables || {};
    for (const tk of Object.keys(S.app.tables)) {
      if (!Array.isArray(doc.tables[tk])) doc.tables[tk] = [];
      const seen = new Set();
      for (const r of doc.tables[tk]) {
        if (!r.id || seen.has(r.id)) r.id = uid();
        seen.add(r.id);
      }
    }
    return doc; // unknown tables/columns are preserved untouched
  }
  function checkEnvelope(doc) {
    if (!doc || typeof doc !== 'object') throw new Error('No data found in this file.');
    if (doc.format && !String(doc.format).startsWith('carryall/')) throw new Error(`Unrecognised data format "${doc.format}".`);
    const id = doc.app && doc.app.id;
    if (id && id !== S.app.id) throw new Error(`This file belongs to the tool "${id}", not "${S.app.id}".`);
  }
  function migrate(doc) {
    const target = S.app.schemaVersion;
    const from = doc.app.schemaVersion || 1;
    const api = makeApi();
    for (let v = from + 1; v <= target; v++) {
      const fn = S.app.migrations[v];
      if (typeof fn !== 'function') throw new Error(`Missing migration to schema ${v}.`);
      doc = fn(doc, { uid, api, fromVersion: from }) || doc;
      doc.app.schemaVersion = v;
    }
    doc.meta = doc.meta || {};
    doc.meta.migrations = (doc.meta.migrations || []).concat({ from, to: target, at: nowISO(), appVersion: S.app.version });
    return doc;
  }

  // Serialise with one row per line: readable in a text editor and diff-friendly.
  function serialise(doc) {
    const j = v => JSON.stringify(v).replace(/</g, '\\u003c');
    const lines = ['{'];
    const keys = Object.keys(doc).filter(k => k !== 'tables');
    keys.forEach(k => lines.push(`  ${j(k)}: ${j(doc[k])},`));
    lines.push('  "tables": {');
    const tks = Object.keys(doc.tables || {});
    tks.forEach((tk, i) => {
      const rows = doc.tables[tk] || [];
      if (!rows.length) { lines.push(`    ${j(tk)}: []${i < tks.length - 1 ? ',' : ''}`); return; }
      lines.push(`    ${j(tk)}: [`);
      rows.forEach((r, ri) => lines.push(`      ${j(r)}${ri < rows.length - 1 ? ',' : ''}`));
      lines.push(`    ]${i < tks.length - 1 ? ',' : ''}`);
    });
    lines.push('  }', '}');
    return lines.join('\n');
  }
  function extractFromHtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html'); // never executes scripts
    const el = doc.getElementById('ca-data');
    if (!el) throw new Error('This HTML file is not a Carryall file (no data block found).');
    const raw = el.textContent.trim();
    if (!raw || raw === 'null') throw new Error('This file is a blank tool with no data in it.');
    return JSON.parse(raw);
  }

  // ── Loading ────────────────────────────────────────────────────────────
  async function loadDocument(doc, { fileName = null, handle = null, source = 'file' } = {}) {
    checkEnvelope(doc);
    doc = clone(doc);
    doc.app = doc.app || { id: S.app.id, schemaVersion: 1 };
    const fileSchema = doc.app.schemaVersion || 1;
    const fileAppVersion = doc.app.version || '?';
    let dirty = false, readOnly = false;
    clearBanners('load');
    if (fileSchema > S.app.schemaVersion) {
      readOnly = true;
      addBanner('load', 'warn', [
        h('strong', 'Read-only: '),
        `this file was saved by a newer version of ${S.app.name} (v${fileAppVersion}, schema ${fileSchema}). `,
        S.app.home && !S.isHome ? h('button', { class: 'ca-btn link', onclick: openInHome }, 'Open it in the latest tool') : 'Editing is disabled to protect it.',
      ]);
    } else if (fileSchema < S.app.schemaVersion) {
      doc = migrate(doc);
      dirty = true;
      addBanner('load', 'info', [
        h('strong', 'Upgraded: '),
        `data from v${fileAppVersion} (schema ${fileSchema}) was migrated to schema ${S.app.schemaVersion}. ${saveWord()} to keep the upgraded copy.`,
      ]);
    }
    normalise(doc);
    S.data = doc;
    S.readOnly = readOnly;
    S.dirty = dirty;
    S.fileName = fileName;
    S.handle = handle;
    S.undo = []; S.redo = [];
    S.viewState = {};
    if (S.tab >= S.app.views.length) S.tab = 0;
    sizeAdvisory();
    render();
    if (dirty) scheduleRecovery();
    await offerRecovery(source);
  }
  async function openFile(file, handle = null) {
    if (S.mode === 'builder') return builderLoadFile(file);
    const name = file.name || 'file';
    const ext = name.toLowerCase().split('.').pop();
    const text = await file.text();
    if (ext === 'csv') return importCsv(text, name);
    let doc;
    try {
      doc = ext === 'json' ? JSON.parse(text) : extractFromHtml(text);
    } catch (e) {
      return alertDialog('Could not open file', e.message);
    }
    if (!(await guardDirty())) return;
    try {
      await loadDocument(doc, { fileName: name, handle: ext === 'html' || ext === 'htm' ? handle : null, source: 'file' });
      toast(`Opened ${name}`);
    } catch (e) {
      alertDialog('Could not open file', e.message);
    }
  }
  // A plain file input works everywhere. The File System Access picker is only used when the
  // app saves in place (it needs a writable handle), and any refusal falls back to the input.
  function pickWithInput() {
    const input = h('input', { type: 'file', accept: '.html,.htm,.json,.csv', onchange: () => input.files[0] && openFile(input.files[0]) });
    input.click();
  }
  // After an await the browser may block opening a file input, so ask for a fresh click.
  function chooseAgain() {
    return dialog({ title: 'Choose the file again', body: h('p', 'This browser would not let the tool read the file directly. Choose it again to open it.'),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Choose file', primary: true, onClick: () => { pickWithInput(); } }] });
  }
  async function pickAndOpen() {
    if (!S.app.saveInPlace || !window.showOpenFilePicker) return pickWithInput();
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Carryall files', accept: { 'text/html': ['.html', '.htm'], 'application/json': ['.json'], 'text/csv': ['.csv'] } }],
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('[carryall] file picker unavailable, using file input', e);
      return chooseAgain();
    }
    let file;
    try { file = await handle.getFile(); } catch (e) {
      console.warn('[carryall] browser refused access to the picked file, using file input', e);
      return chooseAgain();
    }
    return openFile(file, handle);
  }
  async function startNew() {
    if (!(await guardDirty())) return;
    clearBanners('load'); clearBanners('recovery');
    let doc;
    try { doc = newDocument(); } catch (e) {
      console.error(e);
      addBanner('load', 'warn', `A new document could not be started because the tool's onNew failed: ${e.message}`);
      render();
      return;
    }
    S.data = doc;
    S.fileName = null; S.handle = null; S.readOnly = false; S.dirty = false;
    S.undo = []; S.redo = []; S.viewState = {}; S.tab = 0;
    render();
  }

  // ── Mutations & undo ───────────────────────────────────────────────────
  function snapshot() { return JSON.stringify({ tables: S.data.tables, settings: S.data.settings, properties: S.data.properties }); }
  function restore(snap) { const s = JSON.parse(snap); S.data.tables = s.tables; S.data.settings = s.settings; S.data.properties = s.properties; }
  function mutate(fn) {
    if (!S.data) throw new Error('No document is open.');
    if (S.seeding) return fn(S.data);
    if (S.readOnly) { toast('This file is read-only.'); return; }
    S.undo.push(snapshot());
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    const out = fn(S.data);
    markDirty();
    return out;
  }
  function undo() { if (!S.undo.length || S.readOnly) return; S.redo.push(snapshot()); restore(S.undo.pop()); markDirty(); }
  function redo() { if (!S.redo.length || S.readOnly) return; S.undo.push(snapshot()); restore(S.redo.pop()); markDirty(); }
  function markDirty() { S.dirty = true; scheduleRecovery(); render(); }

  function tableRows(t) {
    if (!S.data) return [];
    if (!S.app.tables[t]) throw new Error(`Unknown table "${t}"`);
    return S.data.tables[t];
  }
  function insertRow(t, row) {
    return mutate(d => {
      const r = { id: uid(), ...row };
      d.tables[t].push(r);
      return r.id;
    });
  }
  function updateRow(t, id, patch) {
    mutate(d => {
      const r = d.tables[t].find(x => x.id === id);
      if (!r) throw new Error(`Row ${id} not found in ${t}`);
      Object.assign(r, patch, { id });
    });
  }
  function removeRow(t, id) {
    mutate(d => { d.tables[t] = d.tables[t].filter(x => x.id !== id); });
  }
  function referencesTo(t, id) {
    let n = 0; const where = [];
    for (const [tk, tdef] of Object.entries(S.app.tables)) {
      for (const c of Object.values(tdef.columns)) {
        if (c.type !== 'ref' || c.table !== t) continue;
        const k = S.data.tables[tk].filter(r => r[c.key] === id).length;
        if (k) { n += k; where.push(`${k} in ${tdef.label}`); }
      }
    }
    return { n, where };
  }

  // ── Values & formatting ────────────────────────────────────────────────
  const nfCache = {};
  function nf(opts) {
    const k = JSON.stringify(opts);
    return nfCache[k] || (nfCache[k] = new Intl.NumberFormat(S.app.locale, opts));
  }
  let dfCache;
  function formatAs(type, v, col = {}) {
    if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
    switch (type) {
      case 'number': return nf({ maximumFractionDigits: col.decimals ?? 2, minimumFractionDigits: col.decimals ?? 0 }).format(v);
      case 'integer': return nf({ maximumFractionDigits: 0 }).format(v);
      case 'currency': return nf({ style: 'currency', currency: col.currency || S.app.currency }).format(v);
      case 'percent': return nf({ maximumFractionDigits: col.decimals ?? 1 }).format(v) + '%';
      case 'date': {
        const d = parseDate(v);
        dfCache = dfCache || new Intl.DateTimeFormat(S.app.locale, { day: 'numeric', month: 'long', year: 'numeric' });
        return d ? dfCache.format(d) : String(v);
      }
      case 'boolean': return v ? 'Yes' : 'No';
      default: return String(v);
    }
  }
  // Calculated values are cached for the length of one render (see withCalc), and a
  // calculation that comes back round to itself is stopped and shown as #ERR.
  const calcActive = new Map();
  const warned = new Set();
  function rawValue(t, row, key) {
    const col = colDef(t, key);
    if (!col || col.type !== 'computed') return row[key];
    const cache = S.calc && row && typeof row === 'object' ? S.calc.get(row) : null;
    if (cache && cache.has(key)) return cache.get(key);
    let active = calcActive.get(row);
    if (active && active.has(key)) throw new Error(`Circular calculation: "${col.label}" depends on itself`);
    if (!active) calcActive.set(row, active = new Set());
    active.add(key);
    let v;
    try { v = col.fn(row, makeApi()); }
    catch (e) {
      v = NaN;
      S.lastCalcError = `${col.label}: ${e.message}`;
      const w = `${t}.${key}: ${e.message}`;
      if (!warned.has(w)) { warned.add(w); console.warn(`[carryall] calculated column ${t}.${key} failed`, e); }
    } finally {
      active.delete(key);
      if (!active.size) calcActive.delete(row);
    }
    if (S.calc && row && typeof row === 'object') {
      let c = S.calc.get(row);
      if (!c) S.calc.set(row, c = new Map());
      c.set(key, v);
    }
    return v;
  }
  function withCalc(fn) {
    if (S.calc) return fn();
    S.calc = new WeakMap();
    try { return fn(); } finally { S.calc = null; }
  }
  const rowIndex = new WeakMap();
  function rowById(t, id) {
    const rows = tableRows(t);
    let ix = rowIndex.get(rows);
    if (!ix || ix.n !== rows.length) { ix = { n: rows.length, map: new Map(rows.map(r => [r.id, r])) }; rowIndex.set(rows, ix); }
    return ix.map.get(id) || null;
  }
  function colDef(t, key) { return t === 'settings' ? S.app.settings?.columns[key] : S.app.tables[t]?.columns[key]; }
  function displayOf(t, row) {
    if (!row) return '';
    const td = S.app.tables[t];
    return typeof td.display === 'function' ? td.display(row) : String(rawValue(t, row, td.display) ?? '');
  }
  function formatCell(t, row, key) {
    const col = colDef(t, key);
    const v = rawValue(t, row, key);
    if (!col) return v == null ? '' : String(v);
    if (col.type === 'ref') {
      const target = tableRows(col.table).find(r => r.id === v);
      if (!target) return v ? '(missing)' : '';
      return col.display ? String(rawValue(col.table, target, col.display) ?? '') : displayOf(col.table, target);
    }
    if (col.type === 'computed') {
      if (typeof v === 'number' && isNaN(v)) return '#ERR';
      return formatAs(col.format || (typeof v === 'number' ? 'number' : 'text'), v, col);
    }
    return formatAs(col.type, v, col);
  }
  function isNumericCol(col) {
    return NUMERIC.includes(col.type) || (col.type === 'computed' && ['number', 'integer', 'currency', 'percent'].includes(col.format));
  }
  function sortKey(t, row, key) {
    const col = colDef(t, key);
    if (col?.type === 'ref') return formatCell(t, row, key).toLowerCase();
    const v = rawValue(t, row, key);
    return typeof v === 'string' ? v.toLowerCase() : v;
  }

  // ── Public API handed to views, computed columns, plugins ──────────────
  let apiObj = null;
  function makeApi() {
    return apiObj || (apiObj = {
      get doc() { return S.data; },
      get app() { return S.app; },
      get settings() { return S.data ? S.data.settings : settingsDefaults(); },
      get readOnly() { return S.readOnly; },
      get today() { return todayISO(); },
      get properties() { return S.data ? S.data.properties : null; },
      get user() { return currentUser(); },
      get revision() { return S.data ? currentRevision() : null; },
      setProperties: patch => mutate(d => Object.assign(d.properties, patch)),
      openProperties,
      rows: tableRows,
      row: (t, id) => rowById(t, id),
      value: rawValue,
      display: displayOf,
      format: formatCell,
      formatAs,
      sum: (t, key, where) => tableRows(t).filter(where || (() => true)).reduce((s, r) => s + (Number(rawValue(t, r, key)) || 0), 0),
      count: (t, where) => tableRows(t).filter(where || (() => true)).length,
      insert: insertRow, update: updateRow, remove: removeRow,
      setSettings: patch => mutate(d => Object.assign(d.settings, patch)),
      openForm,
      toast, h, ui: UI, util: Util,
      rerender: render,
    });
  }

  // ── Recovery (IndexedDB autosave of unsaved work) ──────────────────────
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('carryall-recovery', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'key' });
        r.onsuccess = () => res(this.db = r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('docs', mode);
        const out = fn(t.objectStore('docs'));
        t.oncomplete = () => res(out && out.result);
        t.onerror = () => rej(t.error);
      });
    },
    put: v => IDB.tx('readwrite', s => s.put(v)),
    get: k => IDB.tx('readonly', s => s.get(k)),
    del: k => IDB.tx('readwrite', s => s.delete(k)),
    all: () => IDB.tx('readonly', s => s.getAll()),
  };
  const recKey = () => `${S.app.id}/${S.data.meta.docId}`;
  const scheduleRecovery = debounce(() => {
    if (!S.data || !S.dirty || S.mode === 'preview') return;
    IDB.put({ key: recKey(), appId: S.app.id, fileName: S.fileName, at: nowISO(), data: clone(S.data) }).catch(e => console.warn('[carryall] recovery save failed', e));
  }, 800);
  async function offerRecovery(source) {
    if (source === 'recovery') return;
    let rec;
    try { rec = await IDB.get(recKey()); } catch { return; }
    if (!rec) return;
    const same = JSON.stringify([rec.data.tables, rec.data.settings]) === JSON.stringify([S.data.tables, S.data.settings]);
    if (same || (S.data.meta.savedAt && rec.at < S.data.meta.savedAt)) return;
    addBanner('recovery', 'warn', [
      h('strong', 'Recovered changes: '),
      `this document has edits that were ${unsavedWord()}, from ${fmtDateTime(rec.at)}.`,
      h('span', { class: 'ca-spacer' }),
      h('button', { class: 'ca-btn primary', onclick: () => restoreRecovery(rec) }, 'Restore them'),
      h('button', { class: 'ca-btn', onclick: () => { IDB.del(rec.key); clearBanners('recovery'); render(); } }, 'Discard'),
    ]);
    render();
  }
  async function restoreRecovery(rec) {
    clearBanners('recovery');
    await loadDocument(rec.data, { fileName: rec.fileName, source: 'recovery' });
    S.dirty = true;
    render();
    toast(`Changes restored. Remember to ${saveWord().toLowerCase()}.`);
  }

  // ── Saving / exporting ─────────────────────────────────────────────────
  function captureShell() {
    const shell = document.documentElement.cloneNode(true);
    const keep = el => el.id?.startsWith('ca-') || ['META', 'TITLE', 'LINK'].includes(el.tagName) && !el.hasAttribute('data-ca-transient');
    for (const part of [shell.querySelector('head'), shell.querySelector('body')]) {
      if (!part) continue;
      for (const el of [...part.children]) if (!keep(el)) el.remove();
    }
    shell.querySelectorAll('[data-ca-transient]').forEach(el => el.remove());
    const root = shell.querySelector('#ca-root');
    if (root) root.textContent = '';
    for (const a of [...shell.attributes]) if (!['lang', 'dir'].includes(a.name) && !a.name.startsWith('data-ca-')) shell.removeAttribute(a.name);
    S.shell = shell;
  }
  function buildFile(doc) {
    const shell = S.shell.cloneNode(true);
    shell.setAttribute('data-ca-core', CORE_VERSION);
    shell.setAttribute('data-ca-app', S.app.id);
    shell.setAttribute('data-ca-app-version', S.app.version);
    const dataEl = shell.querySelector('#ca-data');
    dataEl.textContent = doc ? '\n' + serialise(doc) + '\n' : 'null';
    const snap = shell.querySelector('#ca-snapshot');
    if (snap) snap.textContent = doc ? snapshotHtml(doc) : '';
    const title = shell.querySelector('title');
    if (title) title.textContent = S.app.name;
    return '<!DOCTYPE html>\n' + shell.outerHTML + '\n';
  }
  // Static, script-free rendering of the data for readers without JavaScript.
  function snapshotHtml(doc) {
    const out = [`\n<div style="font-family:system-ui,sans-serif;padding:16px;max-width:1200px">`,
      `<h1>${esc(S.app.name)}</h1>`,
      `<p>Read-only snapshot (JavaScript is disabled). Saved ${esc(doc.meta.savedAt || '')}, revision ${esc(doc.meta.revision)}.`,
      S.app.home ? ` Open the live tool at <a href="${esc(S.app.home)}">${esc(S.app.home)}</a> and load this file.` : '',
      ` The raw data is the JSON inside &lt;script id="ca-data"&gt; in this file's source.</p>`];
    if (propsOn()) {
      const pr = doc.properties || {};
      const st = checkState(doc);
      const kv = [['Project number', pr.projectNumber], ['Project name', pr.projectName], ['Created by', pr.createdBy], ['Updated by', pr.updatedBy],
        ['Checked by', pr.checkedBy ? `${pr.checkedBy} (${(pr.checkedAt || '').slice(0, 10)})${st.state === 'stale' ? ', data changed since' : ''}` : 'not checked']];
      out.push('<table border="1" cellspacing="0" cellpadding="4">' + kv.map(([k, v]) => `<tr><th align="left">${esc(k)}</th><td>${esc(v || '')}</td></tr>`).join('') + '</table>');
      if ((pr.revisions || []).length) {
        out.push('<h2>Revisions</h2><table border="1" cellspacing="0" cellpadding="4"><tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th><th>Checked</th></tr>');
        for (const r of pr.revisions) out.push(`<tr><td>${esc(r.rev)}</td><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td>${esc(r.by)}</td><td>${esc(r.checkedBy)}</td></tr>`);
        out.push('</table>');
      }
    }
    for (const [tk, td] of Object.entries(S.app.tables)) {
      const cols = Object.values(td.columns).filter(c => !c.hidden);
      const rows = doc.tables[tk] || [];
      out.push(`<h2>${esc(td.label)} (${rows.length})</h2><table border="1" cellspacing="0" cellpadding="4"><thead><tr>`);
      out.push(cols.map(c => `<th>${esc(c.label)}</th>`).join(''), '</tr></thead><tbody>');
      const prev = S.data; S.data = doc;
      try {
        for (const r of rows) out.push('<tr>' + cols.map(c => `<td>${esc(formatCell(tk, r, c.key))}</td>`).join('') + '</tr>');
      } finally { S.data = prev; }
      out.push('</tbody></table>');
    }
    out.push('</div>\n');
    return out.join('\n');
  }
  function suggestedName() {
    if (S.fileName && /\.html?$/i.test(S.fileName)) return S.fileName;
    const pn = propsOn() && S.data.properties.projectNumber;
    const base = `${pn ? pn + ' ' : ''}${S.app.fileName || S.app.id}`;
    return base.replace(/[\\/:*?"<>|]+/g, '-') + '.html';
  }
  function prepareForSave() {
    const doc = clone(S.data);
    doc.format = FORMAT;
    doc.app = { id: S.app.id, version: S.app.version, schemaVersion: S.app.schemaVersion };
    doc.meta.revision = (doc.meta.revision || 0) + 1;
    doc.meta.savedAt = nowISO();
    doc.meta.coreVersion = CORE_VERSION;
    doc.properties.updatedBy = currentUser() || doc.properties.updatedBy || null;
    if (!doc.properties.createdBy) doc.properties.createdBy = doc.properties.updatedBy;
    return doc;
  }
  async function writeHandle(handle, text) {
    if (handle.requestPermission && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to write the file was not granted.');
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }
  function download(text, name, type = 'text/html') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function save({ as = false } = {}) {
    if (!S.data) return;
    if (S.readOnly) return alertDialog('Read-only', 'This file was saved by a newer version of the tool and cannot be saved from here.');
    if (propsOn() && (missingProps().length || !currentUser())) {
      if (!(await openProperties({ reason: `Please complete the document details before you ${saveWord().toLowerCase()}.` }))) return;
    }
    const doc = prepareForSave();
    const html = buildFile(doc);
    // Default: a plain download, which works everywhere. Apps may opt in to writing the
    // file in place (Edge/Chrome File System Access API); any refusal falls back to download.
    let how;
    const fallback = reason => {
      download(html, suggestedName());
      how = `Downloaded ${suggestedName()}${reason ? ` (${reason})` : ''}. Upload it to replace the previous copy.`;
    };
    if (!S.app.saveInPlace) fallback();
    else {
      try {
        if (!as && S.handle) {
          await writeHandle(S.handle, html);
          how = `Saved to ${S.handle.name}`;
        } else if (window.showSaveFilePicker) {
          const handle = await window.showSaveFilePicker({ suggestedName: suggestedName(), types: [{ description: 'Carryall file', accept: { 'text/html': ['.html'] } }] });
          await writeHandle(handle, html);
          S.handle = handle; S.fileName = handle.name;
          how = `Saved to ${handle.name}`;
        } else fallback();
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('[carryall] save in place failed, downloading instead', e);
        S.handle = null;
        fallback('could not write the file directly');
      }
    }
    IDB.del(recKey()).catch(() => {});
    S.data.meta = doc.meta;
    S.data.app = doc.app;
    S.data.properties = doc.properties;
    S.dirty = false;
    clearBanners('load'); clearBanners('recovery');
    sizeAdvisory(html.length);
    render();
    toast(how);
  }
  function exportJson() {
    download(serialise(prepareForSave()), `${S.app.fileName || S.app.id}.json`, 'application/json');
  }

  // ── CSV ────────────────────────────────────────────────────────────────
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  const csvCell = v => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  function exportCsv(t) {
    const td = S.app.tables[t];
    const cols = Object.values(td.columns);
    const lines = [['id', ...cols.map(c => c.label)].map(csvCell).join(',')];
    for (const r of tableRows(t)) {
      lines.push([r.id, ...cols.map(c => {
        if (c.type === 'ref') return formatCell(t, r, c.key);
        const v = rawValue(t, r, c.key);
        return v == null || (typeof v === 'number' && isNaN(v)) ? '' : String(v);
      })].map(csvCell).join(','));
    }
    download('﻿' + lines.join('\r\n'), `${S.app.fileName || S.app.id}-${t}.csv`, 'text/csv');
  }
  function coerce(col, s, t) {
    s = (s ?? '').trim();
    if (s === '') return null;
    switch (col.type) {
      case 'number': case 'currency': case 'percent': {
        const neg = /^\(.*\)$/.test(s);
        const n = parseFloat(s.replace(/[^0-9.\-eE]/g, ''));
        return isNaN(n) ? null : neg ? -n : n;
      }
      case 'boolean': return /^(true|yes|y|1|x|✓)$/i.test(s);
      case 'date': {
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
        if (!m) return null;
        const [d, mo] = S.app.locale === 'en-US' ? [m[2], m[1]] : [m[1], m[2]];
        return `${m[3]}-${pad(+mo)}-${pad(+d)}`;
      }
      case 'ref': {
        const rows = tableRows(col.table);
        const hit = rows.find(r => r.id === s) || rows.find(r => displayOf(col.table, r).toLowerCase() === s.toLowerCase());
        return hit ? hit.id : null;
      }
      default: return s;
    }
  }
  async function importCsv(text, name) {
    if (!S.data) S.data = newDocument();
    if (S.readOnly) return alertDialog('Read-only', 'This file cannot be edited.');
    const grid = parseCsv(text);
    if (grid.length < 2) return alertDialog('Import CSV', 'The CSV file has no data rows.');
    const tks = Object.keys(S.app.tables);
    let t = tks[0];
    if (tks.length > 1) {
      const sel = h('select', { class: 'ca-select' }, tks.map(k => h('option', { value: k }, S.app.tables[k].label)));
      const guess = tks.find(k => name.toLowerCase().includes(k.toLowerCase()));
      if (guess) sel.value = guess;
      const ok = await dialog({
        title: `Import ${name}`,
        body: h('div', { class: 'ca-form' }, makeField('Add rows to table', sel).wrap,
          h('p', { class: 'ca-muted' }, `${grid.length - 1} rows. Columns are matched by name; rows with a matching id are updated.`)),
        buttons: [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }],
      });
      if (!ok) return;
      t = sel.value;
    }
    const td = S.app.tables[t];
    const header = grid[0].map(x => x.trim().toLowerCase());
    const map = header.map(hd => hd === 'id' ? 'id' : Object.values(td.columns).find(c => c.type !== 'computed' && (c.key.toLowerCase() === hd || c.label.toLowerCase() === hd))?.key || null);
    const ignored = grid[0].filter((_, i) => !map[i]);
    let added = 0, updated = 0;
    mutate(d => {
      for (const line of grid.slice(1)) {
        const rec = {};
        map.forEach((k, i) => { if (k && k !== 'id') rec[k] = coerce(td.columns[k], line[i], t); });
        const idIdx = map.indexOf('id');
        const existing = idIdx >= 0 && d.tables[t].find(r => r.id === line[idIdx]);
        if (existing) { Object.assign(existing, rec); updated++; }
        else { d.tables[t].push({ id: uid(), ...rec }); added++; }
      }
    });
    toast(`Imported into ${td.label}: ${added} added, ${updated} updated${ignored.length ? `. Ignored columns: ${ignored.join(', ')}` : ''}`);
  }

  // ── Home / hand-off / update check ─────────────────────────────────────
  function homeUrl() { try { return S.app.home ? new URL(S.app.home, location.href) : null; } catch { return null; } }
  function computeIsHome() {
    const u = homeUrl();
    if (!u) return false;
    const norm = p => p.replace(/\/index\.html?$/i, '/');
    return u.origin === location.origin && norm(u.pathname) === norm(location.pathname);
  }
  function openInHome() {
    const u = homeUrl();
    if (!u) return;
    u.hash = 'ca-handoff';
    const w = window.open(u.href, '_blank');
    if (!w) return alertDialog('Pop-up blocked', `Allow pop-ups for this file, or open ${S.app.home} and load this file there.`);
    if (!S.data) return;
    const payload = { type: 'carryall:handoff', appId: S.app.id, fileName: S.fileName, data: clone(S.data) };
    const onMsg = e => {
      if (e.source !== w || e.data?.type !== 'carryall:ready') return;
      w.postMessage(payload, u.origin);
      window.removeEventListener('message', onMsg);
      toast('Sent to the latest version of the tool.');
    };
    window.addEventListener('message', onMsg);
    setTimeout(() => window.removeEventListener('message', onMsg), 120000);
  }
  function listenForHandoff() {
    if (location.hash !== '#ca-handoff' || !window.opener) return;
    history.replaceState(null, '', location.pathname + location.search);
    const onMsg = async e => {
      if (e.source !== window.opener || e.data?.type !== 'carryall:handoff' || e.data.appId !== S.app.id) return;
      window.removeEventListener('message', onMsg);
      const ok = await confirmDialog(`Load data from ${e.data.fileName || 'a saved copy'}?`,
        'A saved copy of this tool sent its data here. Only the data is loaded; nothing from the other file runs. After loading, use ' + saveWord() + ' and replace the original file with the new copy.', 'Load data');
      if (!ok) return;
      if (!(await guardDirty())) return;
      try { await loadDocument(e.data.data, { fileName: e.data.fileName, source: 'handoff' }); }
      catch (err) { alertDialog('Could not load data', err.message); }
    };
    window.addEventListener('message', onMsg);
    window.opener.postMessage({ type: 'carryall:ready', appId: S.app.id }, '*');
  }
  async function checkForUpdate() {
    if (!S.app.versionUrl || S.isHome) return;
    try {
      const r = await fetch(S.app.versionUrl, { cache: 'no-store' });
      const j = await r.json();
      if (j.version && cmpSemver(j.version, S.app.version) > 0) {
        addBanner('update', 'info', [`A newer version of ${S.app.name} is available (v${j.version}; this copy is v${S.app.version}).`,
          h('button', { class: 'ca-btn link', onclick: openInHome }, 'Open in the latest version')]);
        render();
      }
    } catch { /* offline or blocked: stay quiet */ }
  }
  async function identify() {
    if (S.app.identity !== 'azure-swa' || S.isLocal) return;
    try {
      const r = await fetch('/.auth/me');
      const j = await r.json();
      S.user = j.clientPrincipal?.userDetails || null;
    } catch { /* not signed in */ }
  }

  // ── Banners, toast, dialogs ────────────────────────────────────────────
  function addBanner(id, kind, content) { clearBanners(id); S.banners.push({ id, kind, content }); }
  function clearBanners(id) { S.banners = S.banners.filter(b => b.id !== id); }
  function sizeAdvisory(bytes) {
    if (!S.data) return;
    const rows = Object.values(S.data.tables).reduce((n, t) => n + t.length, 0);
    bytes = bytes || serialise(S.data).length;
    clearBanners('size');
    if (rows > SOFT_ROWS || bytes > SOFT_BYTES) {
      addBanner('size', 'warn', `This file is getting large (${rows.toLocaleString()} rows, ${fmtBytes(bytes)}). Carryall is designed for up to a few thousand rows; consider archiving old rows or moving to a database.`);
    }
  }
  let toastTimer;
  function toast(msg) {
    document.querySelector('.ca-toast')?.remove();
    const el = h('div', { class: 'ca-toast', role: 'status' }, msg);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 4000);
  }
  let dialogSeq = 0;
  // buttons: [{label, value, primary, danger, left, onClick}] - onClick returning false keeps dialog open
  function dialog({ title, body, buttons = [{ label: 'Close', value: null }], wide = false }) {
    return new Promise(resolve => {
      let result = null;
      const headId = 'ca-dlg' + (++dialogSeq);
      const dlg = h('dialog', { class: 'ca-dialog', 'aria-labelledby': headId, style: wide ? { width: 'min(52rem, calc(100vw - 2rem))' } : null });
      const form = h('form', { onsubmit: e => { e.preventDefault(); const p = buttons.find(b => b.primary); if (p) click(p); } });
      async function click(b) {
        if (b.onClick) { const r = await b.onClick(); if (r === false) return; if (r !== undefined) { result = r; dlg.close(); return; } }
        result = b.value; dlg.close();
      }
      const btns = buttons.map(b => h('button', { type: b.primary ? 'submit' : 'button', class: `ca-btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, onclick: b.primary ? null : () => click(b) }, b.label));
      const left = buttons.map((b, i) => b.left ? btns[i] : null).filter(Boolean);
      const right = buttons.map((b, i) => b.left ? null : btns[i]).filter(Boolean);
      form.append(
        h('h2', { class: 'ca-dialog-head', id: headId }, title),
        h('div', { class: 'ca-dialog-body' }, body),
        h('div', { class: 'ca-dialog-foot' }, left, h('span', { class: 'ca-spacer' }), right));
      dlg.append(form);
      dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }
  const alertDialog = (title, msg) => dialog({ title, body: h('p', msg), buttons: [{ label: 'Close', value: true, primary: true }] });
  const confirmDialog = (title, msg, ok = 'Continue', danger = false) =>
    dialog({ title, body: h('p', msg), buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }] }).then(Boolean);
  async function guardDirty() {
    if (!S.dirty) return true;
    return confirmDialog('Discard your changes?', `The current document has changes that are ${unsavedWord()}. They will be lost (a recovery copy is kept in this browser).`, 'Discard', true);
  }

  // ── Accessible field wrapper ───────────────────────────────────────────
  // Ties the label to the control and links help and error text (aria-describedby).
  let fieldSeq = 0;
  function makeField(label, control, { required = false, help = null } = {}) {
    const id = 'ca-f' + (++fieldSeq);
    const target = control && control.matches && (control.matches('input, select, textarea') ? control : control.querySelector('input, select, textarea'));
    const err = h('div', { class: 'ca-error', id: id + '-err', 'aria-live': 'polite' });
    const helpEl = help ? h('div', { class: 'ca-help', id: id + '-help' }, help) : null;
    const mark = required ? h('span', { 'aria-hidden': 'true' }, ' *') : '';
    const isCheck = target && target.type === 'checkbox';
    let lab;
    if (target && !isCheck) lab = h('label', { for: id }, label, mark);
    else lab = h('div', { class: 'ca-label', id: id + '-lbl' }, label, mark);
    if (target) {
      target.id = id;
      target.setAttribute('aria-describedby', [helpEl && id + '-help', id + '-err'].filter(Boolean).join(' '));
      if (required) target.setAttribute('aria-required', 'true');
      if (isCheck) target.setAttribute('aria-labelledby', id + '-lbl');
    }
    const wrap = h('div', { class: 'ca-field' }, lab, control, helpEl, err);
    return {
      wrap, target,
      setError(msg) {
        err.textContent = msg || '';
        wrap.classList.toggle('invalid', !!msg);
        if (target) { if (msg) target.setAttribute('aria-invalid', 'true'); else target.removeAttribute('aria-invalid'); }
      },
    };
  }
  // Show errors on a set of fields and move focus to the first invalid one.
  function showErrors(fields, errs) {
    let first = null;
    for (const [k, f] of Object.entries(fields)) { f.setError(errs[k]); if (errs[k] && !first) first = f.target; }
    if (first) first.focus();
    return !first;
  }
  const emptyText = 'Not set';

  // ── Record form ────────────────────────────────────────────────────────
  function fieldInput(col, value, onChange) {
    const set = v => onChange(v);
    switch (col.type) {
      case 'longtext':
        return h('textarea', { class: 'ca-textarea', value: value ?? '', oninput: e => set(e.target.value || null) });
      case 'number': case 'currency': case 'percent':
        return h('input', { class: 'ca-input', type: 'number', step: col.step ?? 'any', min: col.min, max: col.max, value: value ?? '',
          oninput: e => set(e.target.value === '' ? null : Number(e.target.value)) });
      case 'date':
        return h('input', { class: 'ca-input', type: 'date', value: value ?? '', oninput: e => set(e.target.value || null) });
      case 'boolean':
        return h('label', { class: 'ca-check' }, h('input', { type: 'checkbox', checked: !!value, onchange: e => set(e.target.checked) }), col.checkLabel || 'Yes');
      case 'choice':
        return h('select', { class: 'ca-select', onchange: e => set(e.target.value || null) },
          h('option', { value: '' }, emptyText),
          (col.options || []).map(o => h('option', { value: o, selected: o === value }, o)));
      case 'ref': {
        const opts = tableRows(col.table).map(r => [r.id, displayOf(col.table, r)]).sort((a, b) => a[1].localeCompare(b[1]));
        return h('select', { class: 'ca-select', onchange: e => set(e.target.value || null) },
          h('option', { value: '' }, emptyText), opts.map(([id, label]) => h('option', { value: id, selected: id === value }, label)));
      }
      default:
        return h('input', { class: 'ca-input', type: 'text', value: value ?? '', maxlength: col.maxLength, oninput: e => set(e.target.value || null) });
    }
  }
  function validateRow(t, row) {
    const errs = {};
    const td = t === 'settings' ? S.app.settings : S.app.tables[t];
    for (const c of Object.values(td.columns)) {
      const v = row[c.key];
      if (c.type === 'computed') continue;
      const name = c.label.toLowerCase();
      if (c.required && (v == null || v === '')) errs[c.key] = ['choice', 'ref'].includes(c.type) ? `Choose the ${name}` : `Enter the ${name}`;
      else if (typeof v === 'number' && c.min != null && v < c.min) errs[c.key] = `${c.label} must be ${c.min} or more`;
      else if (typeof v === 'number' && c.max != null && v > c.max) errs[c.key] = `${c.label} must be ${c.max} or less`;
      else if (c.unique && v != null && t !== 'settings' && S.data.tables[t].some(r => r.id !== row.id && r[c.key] === v)) errs[c.key] = `${c.label} "${v}" is already used by another ${td.singular}`;
    }
    if (typeof td.validate === 'function') {
      const out = td.validate(row, makeApi());
      if (typeof out === 'string' && out) errs._form = out; // a plain message applies to the whole form
      else if (out && typeof out === 'object') Object.assign(errs, out);
    }
    return errs;
  }
  function openForm(t, id, preset = {}) {
    const td = S.app.tables[t];
    const existing = id ? tableRows(t).find(r => r.id === id) : null;
    const draft = existing ? clone(existing) : { id: null, ...defaultsFor(td), ...preset };
    const ro = S.readOnly || td.readOnly;
    const fields = {};
    const computedEls = [];
    const refreshComputed = () => computedEls.forEach(([el, c]) => { el.textContent = formatCell(t, draft, c.key) || emptyText; });
    const body = h('div', { class: 'ca-form' }, Object.values(td.columns).filter(c => !c.hidden && !c.hideInForm).map(c => {
      if (c.type === 'computed') {
        const el = h('div', { class: 'ca-readonly', 'aria-live': 'polite' });
        computedEls.push([el, c]);
        return makeField(c.label + ' (calculated)', el).wrap;
      }
      const input = ro ? h('div', { class: 'ca-readonly' }, formatCell(t, draft, c.key) || emptyText) : fieldInput(c, draft[c.key], v => { draft[c.key] = v; refreshComputed(); });
      const f = makeField(c.label, input, { required: c.required && !ro, help: c.help });
      fields[c.key] = f;
      return f.wrap;
    }));
    const formErr = h('div', { class: 'ca-error', role: 'alert' });
    body.append(formErr);
    refreshComputed();
    const buttons = [];
    if (existing && !ro) buttons.push({ label: 'Delete', danger: true, left: true, onClick: async () => {
      const refs = referencesTo(t, id);
      if (refs.n) { await alertDialog(`Can't delete this ${td.singular}`, `It is still used (${refs.where.join(', ')}). Change those first.`); return false; }
      if (!(await confirmDialog(`Delete ${displayOf(t, existing) || 'this ' + td.singular}?`, 'It will be removed from the document. You can undo this until you close the page.', `Delete ${td.singular}`, true))) return false;
      removeRow(t, id);
      toast('Deleted. Undo with Ctrl+Z.');
      return true;
    } });
    buttons.push({ label: ro ? 'Close' : 'Cancel', value: false });
    if (!ro) buttons.push({ label: existing ? 'Save changes' : `Add ${td.singular}`, primary: true, onClick: () => {
      const errs = validateRow(t, draft);
      formErr.textContent = errs._form || '';
      if (!showErrors(fields, errs) || errs._form) return false;
      if (typeof td.onSave === 'function') td.onSave(draft, existing ? clone(existing) : null, makeApi());
      const { id: _id, ...rest } = draft;
      if (existing) updateRow(t, id, rest); else insertRow(t, rest);
      return true;
    } });
    return dialog({ title: `${existing ? (ro ? 'View' : 'Edit') : 'New'} ${td.singular}`, body, buttons });
  }
  function defaultsFor(td) {
    const out = {};
    for (const c of Object.values(td.columns)) {
      if (c.type === 'computed' || c.default === undefined) continue;
      out[c.key] = typeof c.default === 'function' ? c.default(makeApi()) : clone(c.default);
    }
    return out;
  }

  // ── Document properties dialog ─────────────────────────────────────────
  // Resolves true when the user applies valid details, otherwise false/null.
  function openProperties({ reason } = {}) {
    const p = S.data.properties;
    const ro = S.readOnly;
    const req = requiredProps();
    const draft = { projectNumber: p.projectNumber, projectName: p.projectName, createdBy: p.createdBy };
    const fields = {};
    const field = (key, label, input, help) => {
      const f = makeField(label, input, { required: !ro && (req.includes(key) || key === 'user'), help });
      fields[key] = f;
      return f.wrap;
    };
    const text = key => ro ? h('div', { class: 'ca-readonly' }, draft[key] || emptyText)
      : h('input', { class: 'ca-input', type: 'text', value: draft[key] ?? '', oninput: e => { draft[key] = e.target.value.trim() || null; } });
    const userInput = h('input', { class: 'ca-input', type: 'text', value: currentUser() || '', disabled: !!S.user, autocomplete: 'name' });
    const fmtWhen = iso => (iso ? new Date(iso).toLocaleString(S.app.locale, { dateStyle: 'medium', timeStyle: 'short' }) : '');

    const checkBox = h('div');
    function drawCheck() {
      const st = checkState();
      const status = st.state === 'checked' ? UI.pill(`Checked by ${st.by}, ${fmtWhen(st.at)}`, 'green')
        : st.state === 'stale' ? UI.pill(`Changed since checked by ${st.by}, ${fmtWhen(st.at)}`, 'amber')
        : UI.pill('Not checked', 'grey');
      const name = h('input', { class: 'ca-input', type: 'text', placeholder: "Checker's name", value: currentUser() || '', 'aria-label': "Checker's name", style: { maxWidth: '200px' } });
      checkBox.replaceChildren(h('div', { class: 'ca-row' }, status,
        !ro && st.state !== 'checked' && name,
        !ro && st.state !== 'checked' && h('button', { class: 'ca-btn', type: 'button', onclick: () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          mutate(d => Object.assign(d.properties, { checkedBy: n, checkedAt: nowISO(), checkedHash: dataHash(d) }));
          drawCheck(); drawRevs();
        } }, 'Mark as checked'),
        !ro && st.state !== 'unchecked' && h('button', { class: 'ca-btn link', type: 'button', onclick: () => {
          mutate(d => Object.assign(d.properties, { checkedBy: null, checkedAt: null, checkedHash: null }));
          drawCheck();
        } }, 'Clear check')),
        h('div', { class: 'ca-help' }, 'Records who checked the data. Any later change to the data shows it as changed since checked.'));
    }

    const revBox = h('div');
    function drawRevs() {
      const revs = S.data.properties.revisions;
      revBox.replaceChildren(
        revs.length ? h('div', { class: 'ca-table-wrap' }, h('table', { class: 'ca-table' },
          h('thead', h('tr', ['Rev', 'Date', 'Description', 'By', 'Checked'].map(x => h('th', x)))),
          h('tbody', [...revs].reverse().map(r => h('tr', h('td', r.rev), h('td', formatAs('date', r.date)), h('td', r.description || ''), h('td', r.by || ''), h('td', r.checkedBy || ''))))))
          : h('p', { class: 'ca-muted', style: { margin: 0 } }, 'No revisions issued yet.'),
        !ro && h('button', { class: 'ca-btn', type: 'button', style: { marginTop: '0.5rem' }, onclick: addRevision }, 'Issue new revision…'));
    }
    async function addRevision() {
      const last = currentRevision();
      const st = checkState();
      const r = { rev: nextRevisionCode(last && last.rev), date: todayISO(), description: '', by: userInput.value.trim() || currentUser() || '', checkedBy: st.state === 'checked' ? st.by : '' };
      const inp = (k, type = 'text') => h('input', { class: 'ca-input', type, value: r[k], oninput: e => { r[k] = e.target.value; } });
      const revField = makeField('Revision', inp('rev'), { required: true, help: 'For example P01, P02 or A, B.' });
      const ok = await dialog({ title: 'Issue new revision', body: h('div', { class: 'ca-form' },
        h('div', { class: 'ca-grid2' }, revField.wrap, makeField('Date', inp('date', 'date')).wrap),
        makeField('Description', h('textarea', { class: 'ca-textarea', style: { minHeight: '4rem' }, oninput: e => { r.description = e.target.value; } })).wrap,
        h('div', { class: 'ca-grid2' }, makeField('By', inp('by')).wrap, makeField('Checked by', inp('checkedBy')).wrap)),
        buttons: [{ label: 'Cancel', value: false }, { label: 'Add revision', value: true, primary: true, onClick: () => {
          const code = r.rev.trim();
          const msg = !code ? 'Enter a revision code' : S.data.properties.revisions.some(x => x.rev === code) ? `Revision ${code} already exists. Enter a new code.` : '';
          revField.setError(msg);
          if (msg) { revField.target.focus(); return false; }
        } }] });
      if (!ok) return;
      const clean = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v).trim() || null]));
      mutate(d => d.properties.revisions.push(clean));
      drawRevs();
    }
    drawCheck(); drawRevs();

    const body = h('div', { class: 'ca-form' },
      reason && h('div', { class: 'ca-banner warn', style: { borderRadius: '6px', border: '1px solid var(--ca-warn-border)' } }, reason),
      h('div', { class: 'ca-grid2' },
        field('projectNumber', 'Project number', text('projectNumber')),
        field('projectName', 'Project name', text('projectName'))),
      h('div', { class: 'ca-grid2' },
        field('user', 'Your name', ro ? h('div', { class: 'ca-readonly' }, currentUser() || emptyText) : userInput,
          S.user ? 'From your sign-in.' : `Remembered in this browser; recorded as "updated by" each time you ${saveWord().toLowerCase()}.`),
        field('createdBy', 'Created by', text('createdBy'))),
      h('p', { class: 'ca-muted', style: { margin: 0, fontSize: '13px' } },
        p.updatedBy || S.data.meta.savedAt ? `Last updated by ${p.updatedBy || 'unknown'}${S.data.meta.savedAt ? ', ' + fmtWhen(S.data.meta.savedAt) : ''} (save ${S.data.meta.revision}).` : 'Not saved yet.'),
      h('h3', { class: 'ca-subhead' }, 'Check'), checkBox,
      h('h3', { class: 'ca-subhead' }, 'Revisions'), revBox);

    return dialog({ title: 'Document properties', body, wide: true, buttons: ro ? [{ label: 'Close', value: false, primary: true }] : [
      { label: 'Cancel', value: false },
      { label: 'Apply', value: true, primary: true, onClick: () => {
        const errs = {};
        const names = { projectNumber: 'project number', projectName: 'project name', createdBy: 'name of who created it' };
        for (const k of req) if (!draft[k]) errs[k] = `Enter the ${names[k] || k}`;
        const user = userInput.value.trim();
        if (!user) errs.user = 'Enter your name so downloads record who updated the document';
        if (!showErrors(fields, errs)) return false;
        if (!S.user) setCurrentUser(user);
        if (Object.keys(draft).some(k => draft[k] !== S.data.properties[k])) mutate(d => Object.assign(d.properties, draft));
        else render();
      } }] });
  }

  // ── Built-in UI helpers (also exposed as Carryall.ui) ──────────────────
  const UI = {
    // Horizontal bar chart built from HTML, so text stays full size in any width and prints.
    // items: [{label, value}]
    barChart(items, { format = v => String(v), title } = {}) {
      const max = Math.max(0, ...items.map(i => i.value || 0)) || 1;
      if (!items.length) return h('div', { class: 'ca-bars-empty ca-muted' }, 'No data');
      return h('div', { class: 'ca-bars', role: 'img', 'aria-label': title || 'Bar chart' }, items.map(it => {
        const label = String(it.label ?? '');
        const pct = Math.max(0, Math.min(100, 100 * (it.value || 0) / max));
        return [
          h('span', { class: 'ca-bar-label', title: label }, label),
          h('span', { class: 'ca-bar-track' }, h('span', { class: 'ca-bar-fill', style: { width: pct + '%' } })),
          h('span', { class: 'ca-bar-value' }, format(it.value)),
        ];
      }));
    },
    // Chart series colours in style-guide order, as CSS custom property references.
    palette: ['red', 'purple', 'blue-dark', 'teal', 'pink', 'green', 'blue-bright', 'sage', 'orange', 'slate'].map(c => `var(--ca-${c})`),
    pill(text, color) { return h('span', { class: `ca-pill${color ? ' ' + color : ''}` }, text); },
    kpi(label, value) { return h('div', { class: 'ca-kpi' }, h('div', { class: 'ca-kpi-label' }, label), h('div', { class: 'ca-kpi-value' }, value)); },
    card(title, ...kids) { return h('div', { class: 'ca-card' }, title && h('h2', title), kids); },
    dialog, alert: alertDialog, confirm: confirmDialog,
  };
  const Util = { uid, clone, todayISO, parseDate, daysBetween, yearsBetween, addDays, addMonths, esc, parseCsv, cmpSemver };

  // ── Views ──────────────────────────────────────────────────────────────
  const VIEWS = {
    table: renderTableView,
    summary: renderSummary,
    kpi: renderKpis,
    dashboard: renderDashboard,
    settings: renderSettings,
    sheet: renderSheet,
    matrix: renderMatrix,
    custom: (el, v, api) => v.render(el, api),
  };
  function renderView(el, view, key) {
    const fn = VIEWS[view.type] || S.viewTypes[view.type];
    if (!fn) { el.append(h('div', { class: 'ca-card' }, `Unknown view type "${view.type}".`)); return; }
    try { fn(el, view, makeApi(), key); }
    catch (e) { console.error(e); el.append(h('div', { class: 'ca-card' }, h('strong', 'This view failed to render: '), e.message)); }
  }
  function cellNode(t, row, col) {
    const text = formatCell(t, row, col.key);
    if (col.type === 'choice' && col.colors && text) return UI.pill(text, col.colors[row[col.key]]);
    if (col.type === 'computed' && col.colors) {
      const v = rawValue(t, row, col.key);
      const color = typeof col.colors === 'function' ? col.colors(v, row) : col.colors[v];
      return text ? UI.pill(text, color) : '';
    }
    if (col.type === 'boolean') return row[col.key] ? 'Yes' : 'No';
    if (col.mono) return h('span', { class: 'ca-mono' }, text);
    if (col.type === 'longtext' && text.length > 80) return text.slice(0, 79) + '…';
    return text;
  }
  function renderTableView(el, view, api, key) {
    const t = view.table, td = S.app.tables[t];
    if (!td) throw new Error(`Table "${t}" is not defined`);
    const vs = S.viewState[key] = S.viewState[key] || { q: '', sort: view.sort ? { ...view.sort } : null, filters: {}, limit: PAGE };
    const cols = (view.columns || Object.keys(td.columns).filter(k => !td.columns[k].hidden)).map(k => {
      if (!td.columns[k]) throw new Error(`Column "${k}" is not defined on ${t}`);
      return td.columns[k];
    });
    const count = h('span', { class: 'ca-muted' });
    const tbody = h('tbody'), tfoot = h('tfoot');
    const filters = (view.filters || []).map(fk => {
      const c = td.columns[fk];
      const opts = c.type === 'choice' ? c.options.map(o => [o, o])
        : c.type === 'ref' ? tableRows(c.table).map(r => [r.id, displayOf(c.table, r)])
        : c.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']]
        : [...new Set(tableRows(t).map(r => rawValue(t, r, fk)).filter(v => v != null && v !== ''))].sort().map(v => [String(v), String(v)]);
      return h('select', { class: 'ca-select', 'aria-label': `Filter by ${c.label}`, onchange: e => { vs.filters[fk] = e.target.value; vs.limit = PAGE; refresh(); } },
        h('option', { value: '' }, `Any ${c.label.toLowerCase()}`), opts.map(([v, l]) => h('option', { value: v, selected: vs.filters[fk] === v }, l)));
    });
    const ro = S.readOnly || td.readOnly || view.readOnly;
    el.append(h('div', { class: 'ca-tv-bar' },
      view.search !== false && h('input', { class: 'ca-input', type: 'search', placeholder: 'Search…', value: vs.q, 'aria-label': 'Search', oninput: e => { vs.q = e.target.value; vs.limit = PAGE; refresh(); } }),
      filters, h('span', { class: 'ca-spacer' }), count,
      !ro && view.add !== false && h('button', { class: 'ca-btn primary', onclick: () => openForm(t, null, view.preset) }, `+ Add ${td.singular}`)));
    const thead = h('thead', h('tr', cols.map(c => {
      const active = vs.sort && vs.sort.key === c.key;
      return h('th', { class: `sortable${isNumericCol(c) ? ' num' : ''}`, scope: 'col', 'aria-sort': active ? (vs.sort.dir === 'desc' ? 'descending' : 'ascending') : null },
        h('button', { class: 'ca-sort-btn', type: 'button', dataset: { caFocus: `sort.${key}.${c.key}` },
          onclick: () => { vs.sort = active && vs.sort.dir === 'asc' ? { key: c.key, dir: 'desc' } : active ? null : { key: c.key, dir: 'asc' }; render(); } },
          c.label, h('span', { class: 'ca-sort', 'aria-hidden': 'true' }, active ? (vs.sort.dir === 'asc' ? '▲' : '▼') : '')));
    })));
    el.append(h('div', { class: 'ca-table-wrap' }, h('table', { class: 'ca-table' }, thead, tbody, tfoot)));
    const more = h('div', { style: { textAlign: 'center', marginTop: '10px' } });
    el.append(more);

    const refresh = () => withCalc(refreshRows);
    function refreshRows() {
      const all = tableRows(t);
      let rows = all.filter(r => (!view.where || view.where(r, api)) && Object.entries(vs.filters).every(([fk, fv]) => !fv || String(rawValue(t, r, fk)) === fv));
      if (vs.q) {
        const q = vs.q.toLowerCase();
        rows = rows.filter(r => cols.some(c => formatCell(t, r, c.key).toLowerCase().includes(q)));
      }
      if (vs.sort) rows = sortRows(t, rows, vs.sort);
      tbody.replaceChildren(...(rows.length ? rows.slice(0, vs.limit).map(r => h('tr', { class: 'clickable', tabindex: 0, onclick: () => openForm(t, r.id), onkeydown: e => { if (e.key === 'Enter') openForm(t, r.id); } },
        cols.map(c => h('td', { class: `${isNumericCol(c) ? 'num' : ''}${c.type === 'computed' ? ' ca-computed' : ''}${c.type === 'longtext' ? ' ca-long' : ''}` }, cellNode(t, r, c)))))
        : [h('tr', h('td', { class: 'ca-empty', colspan: cols.length }, all.length ? 'No matching rows' : `No ${td.label.toLowerCase()} yet`))]));
      if (view.totals?.length && rows.length) {
        tfoot.replaceChildren(h('tr', cols.map((c, i) => {
          if (!view.totals.includes(c.key)) return h('td', i === 0 ? 'Total' : '');
          const sum = rows.reduce((s, r) => s + (Number(rawValue(t, r, c.key)) || 0), 0);
          return h('td', { class: 'num' }, formatAs(c.type === 'computed' ? c.format || 'number' : c.type, sum, c));
        })));
      } else tfoot.replaceChildren();
      count.textContent = rows.length === all.length ? `${all.length} ${all.length === 1 ? td.singular : td.label.toLowerCase()}` : `${rows.length} of ${all.length}`;
      more.replaceChildren(rows.length > vs.limit ? h('button', { class: 'ca-btn', onclick: () => { vs.limit += PAGE; refresh(); } }, `Show more (${rows.length - vs.limit} remaining)`) : '');
    }
    refresh();
  }
  function groupLabel(t, row, col, bucket) {
    if ((col.type === 'date' || (col.type === 'computed' && col.format === 'date')) && bucket) {
      const v = rawValue(t, row, col.key);
      if (!v) return ['', '(no date)'];
      if (bucket === 'year') return [v.slice(0, 4), v.slice(0, 4)];
      const d = parseDate(v);
      return [v.slice(0, 7), d.toLocaleDateString(S.app.locale, { month: 'long', year: 'numeric' })];
    }
    if (col.type === 'ref') return [row[col.key] || '', formatCell(t, row, col.key) || '(none)'];
    const v = rawValue(t, row, col.key);
    return [v == null ? '' : String(v), formatCell(t, row, col.key) || '(none)'];
  }
  function metricValue(t, rows, m) {
    if (m.op === 'count' || !m.op) return rows.length;
    const vals = rows.map(r => Number(rawValue(t, r, m.column))).filter(v => isFinite(v));
    if (m.op === 'sum') return vals.reduce((a, b) => a + b, 0);
    if (!vals.length) return null;
    if (m.op === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length;
    if (m.op === 'min') return Math.min(...vals);
    if (m.op === 'max') return Math.max(...vals);
    throw new Error(`Unknown metric op "${m.op}"`);
  }
  function metricFormat(t, m) {
    if (m.format) return m.format;
    if (m.op === 'count' || !m.op) return 'integer';
    const c = colDef(t, m.column);
    return c?.type === 'computed' ? c.format || 'number' : c?.type || 'number';
  }
  function renderSummary(el, view, api) {
    const t = view.table, td = S.app.tables[t];
    const col = td.columns[view.groupBy];
    if (!col) throw new Error(`groupBy column "${view.groupBy}" is not defined on ${t}`);
    const metrics = view.metrics || [{ label: 'Count', op: 'count' }];
    const rows = tableRows(t).filter(r => !view.where || view.where(r, api));
    const groups = new Map();
    for (const r of rows) {
      const [k, label] = groupLabel(t, r, col, view.bucket);
      if (!groups.has(k)) groups.set(k, { key: k, label, rows: [] });
      groups.get(k).rows.push(r);
    }
    let list = [...groups.values()].map(g => ({ ...g, values: metrics.map(m => metricValue(t, g.rows, m)) }));
    if (col.type === 'choice' && !view.sortBy) list.sort((a, b) => col.options.indexOf(a.key) - col.options.indexOf(b.key));
    else if (col.type === 'date' || col.format === 'date' || view.sortBy === 'label') list.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    else list.sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0));
    const fmts = metrics.map(m => metricFormat(t, m));
    const card = h('div', { class: 'ca-card' }, view.title && h('h2', view.title));
    if (view.chart !== false) {
      const mi = typeof view.chart === 'number' ? view.chart : 0;
      card.append(UI.barChart(list.map(g => ({ label: g.label, value: g.values[mi] || 0 })), { format: v => formatAs(fmts[mi], v), title: view.title }));
    }
    if (view.showTable !== false) {
      const totals = metrics.map(m => metricValue(t, rows, m));
      card.append(h('div', { class: 'ca-table-wrap', style: { marginTop: '0.75rem' } }, h('table', { class: 'ca-table' },
        h('thead', h('tr', h('th', col.label), metrics.map(m => h('th', { class: 'num' }, m.label || m.op)))),
        h('tbody', list.map(g => h('tr', h('td', g.label), g.values.map((v, i) => h('td', { class: 'num' }, formatAs(fmts[i], v)))))),
        h('tfoot', h('tr', h('td', 'Total'), totals.map((v, i) => h('td', { class: 'num' }, metrics[i].op === 'sum' || metrics[i].op === 'count' || !metrics[i].op ? formatAs(fmts[i], v) : '')))))));
    }
    el.append(card);
  }
  function renderKpis(el, view, api) {
    el.append(h('div', { class: 'ca-kpis' }, (view.items || []).map(it => {
      let v;
      try { v = it.value(api); } catch (e) { console.warn(e); v = NaN; }
      return UI.kpi(it.label, typeof v === 'number' && isNaN(v) ? '#ERR' : formatAs(it.format || 'number', v, it));
    })));
  }
  // KPI rows and blocks marked wide span the full width; others flow into a card grid.
  function renderDashboard(el, view, api, key) {
    let grid = null;
    (view.blocks || []).forEach((b, i) => {
      const box = h('div');
      renderView(box, b, `${key}.${i}`);
      if (b.type === 'kpi' || b.wide) { grid = null; el.append(box); return; }
      if (!grid) { grid = h('div', { class: 'ca-grid' }); el.append(grid); }
      grid.append(box);
    });
  }
  function renderSettings(el, view) {
    const sd = S.app.settings;
    if (!sd) throw new Error('No "settings" defined on the app');
    const keys = view.fields || Object.keys(sd.columns);
    const pending = {};
    const commit = () => setTimeout(() => {
      const patch = Object.fromEntries(Object.entries(pending).filter(([k, v]) => S.data.settings[k] !== v));
      for (const k of Object.keys(pending)) delete pending[k];
      if (Object.keys(patch).length) mutate(d => Object.assign(d.settings, patch));
    });
    el.append(h('div', { class: 'ca-card', style: { maxWidth: '36rem' } }, view.title && h('h2', view.title), view.intro && h('p', { class: 'ca-muted' }, view.intro),
      h('div', { class: 'ca-form', onchange: commit }, keys.map(k => {
        const c = sd.columns[k];
        if (c.type === 'computed') return makeField(c.label + ' (calculated)', h('div', { class: 'ca-readonly' }, formatCell('settings', S.data.settings, k))).wrap;
        const input = S.readOnly ? h('div', { class: 'ca-readonly' }, formatCell('settings', S.data.settings, k) || emptyText)
          : fieldInput(c, S.data.settings[k], v => { pending[k] = v; });
        const focusable = input.matches('input, select, textarea') ? input : input.querySelector('input');
        if (focusable) focusable.dataset.caFocus = 'settings.' + k;
        return makeField(c.label, input, { help: c.help }).wrap;
      }))));
  }

  // ── Page rendering ─────────────────────────────────────────────────────
  function render() { withCalc(renderPage); }
  function renderPage() {
    const root = S.root;
    if (!root) return;
    const focusKey = document.activeElement?.dataset?.caFocus;
    const skip = h('a', { class: 'ca-skip', href: '#ca-main', onclick: e => { e.preventDefault(); document.getElementById('ca-main')?.focus(); } }, 'Skip to content');
    if (S.mode === 'builder') {
      root.replaceChildren(skip, renderBuilderHeader(), h('main', { class: 'ca-main', id: 'ca-main', tabindex: '-1' }, renderBuilder()),
        h('footer', { class: 'ca-footer' }, h('div', { class: 'ca-footer-inner' }, h('span', `Carryall ${CORE_VERSION}`),
          h('a', { href: GUIDE_URL, target: '_blank', rel: 'noopener' }, 'Guide to building tools with Copilot'))));
      if (focusKey) root.querySelector(`[data-ca-focus="${focusKey}"]`)?.focus();
      document.title = S.builder.previous ? `Change ${S.builder.previous.name}` : 'Carryall tool builder';
      return;
    }
    const panel = S.data ? h('div', S.app.views.length > 1 ? { role: 'tabpanel', id: 'ca-panel', 'aria-labelledby': `ca-tab-${S.tab}` } : null, renderCurrentView()) : renderLanding();
    root.replaceChildren(skip, renderHeader(), renderBanners(), S.data ? renderTabs() : '',
      h('main', { class: 'ca-main', id: 'ca-main', tabindex: '-1' }, panel), renderFooter());
    if (focusKey) root.querySelector(`[data-ca-focus="${focusKey}"]`)?.focus();
    document.title = S.mode === 'preview' ? `Preview: ${S.app.name}` : `${S.dirty ? '• ' : ''}${S.fileName ? S.fileName + ' – ' : ''}${S.app.name}`;
  }
  function renderBuilderHeader() {
    const b = S.builder;
    return h('header', { class: 'ca-header' }, h('div', { class: 'ca-header-main' },
      h('div', { class: 'ca-titles' }, h('h1', { class: 'ca-title' }, b.previous ? `Tool builder: ${b.previous.name}` : 'Carryall tool builder')),
      b.saved && h('div', { class: 'ca-toolbar', role: 'toolbar', 'aria-label': 'Builder actions' },
        h('button', { class: 'ca-btn', onclick: closeBuilder }, `Back to ${b.previous.name}`))));
  }
  function renderHeader() {
    if (S.mode === 'preview') {
      return h('header', { class: 'ca-header' }, h('div', { class: 'ca-header-main' },
        h('div', { class: 'ca-titles' }, h('h1', { class: 'ca-title' }, S.app.name),
          h('div', { class: 'ca-meta' }, h('span', 'Preview. Nothing you enter here is kept.'))),
        h('div', { class: 'ca-toolbar', role: 'toolbar', 'aria-label': 'Preview actions' },
          h('button', { class: 'ca-btn', onclick: backToBuilder }, 'Back to the builder'),
          h('button', { class: 'ca-btn primary', onclick: downloadTool }, 'Download the tool'))));
    }
    const has = !!S.data;
    const btn = (label, onclick, opts = {}) => h('button', { class: `ca-btn${opts.primary ? ' primary' : ''}`, onclick, disabled: opts.disabled, title: opts.title }, label);
    const menu = h('details', { class: 'ca-menu' }, h('summary', { class: 'ca-btn' }, 'More', h('span', { 'aria-hidden': 'true' }, ' ▾')), h('div', { class: 'ca-menu-list' },
      has && Object.entries(S.app.tables).map(([k, td]) => h('button', { onclick: () => exportCsv(k) }, `Export ${td.label} (CSV)`)),
      has && h('button', { onclick: exportJson }, 'Export data (JSON)'),
      has && !S.readOnly && h('button', { onclick: () => h('input', { type: 'file', accept: '.csv', onchange: e => e.target.files[0]?.text().then(tx => importCsv(tx, e.target.files[0].name)) }).click() }, 'Import CSV…'),
      has && propsOn() && h('button', { onclick: () => openProperties() }, 'Document properties…'),
      has && h('button', { onclick: () => window.print() }, 'Print'),
      S.app.home && !S.isHome && h('button', { onclick: openInHome }, S.data ? 'Open data in latest tool' : 'Go to latest tool'),
      h('button', { onclick: startNew }, 'Start new document'),
      S.spec && h('button', { onclick: openBuilder }, 'Change this tool…'),
      h('button', { onclick: showAbout }, 'About this file')));
    // Row 1: tool name + actions. Row 2 (meta line): document properties and file state.
    return h('header', { class: 'ca-header' },
      h('div', { class: 'ca-header-main' },
        h('div', { class: 'ca-titles' },
          h('h1', { class: 'ca-title' }, S.app.name),
          has && h('div', { class: 'ca-meta' }, propsOn() && renderDocLine(), renderFileState())),
        h('div', { class: 'ca-toolbar', role: 'toolbar', 'aria-label': 'File actions' },
          btn('Open…', pickAndOpen, { title: 'Open a saved Carryall file, JSON or CSV' }),
          has && btn(S.app.saveInPlace ? 'Save' : 'Download', () => save(), { primary: true, disabled: S.readOnly,
            title: !S.app.saveInPlace ? 'Download a copy of this file with your data (Ctrl+S)' : S.handle ? `Save to ${S.handle.name} (Ctrl+S)` : 'Choose where to save (Ctrl+S)' }),
          has && S.app.saveInPlace && btn('Save as…', () => save({ as: true }), { disabled: S.readOnly }),
          has && h('div', { class: 'ca-btn-group', role: 'group', 'aria-label': 'History' },
            btn('Undo', undo, { disabled: !S.undo.length || S.readOnly, title: 'Undo the last change (Ctrl+Z)' }),
            btn('Redo', redo, { disabled: !S.redo.length || S.readOnly, title: 'Redo (Ctrl+Y)' })),
          menu)));
  }
  function renderFileState() {
    return h('span', { class: 'ca-file' },
      h('span', { class: 'ca-file-name', title: S.fileName || '' }, S.fileName || 'Untitled document'),
      S.readOnly ? UI.pill('Read-only', 'amber')
        : S.dirty ? h('span', { class: 'ca-state' }, h('span', { class: 'ca-dirty', 'aria-hidden': 'true' }), `Changes ${unsavedWord()}`)
        : S.data.meta.savedAt ? h('span', { class: 'ca-state' }, 'No changes') : null);
  }
  function renderDocLine() {
    const p = S.data.properties;
    const rev = currentRevision();
    const st = checkState();
    const parts = [p.projectNumber, p.projectName, rev && `Rev ${rev.rev}`].filter(Boolean);
    return h('button', { class: 'ca-docline', type: 'button', onclick: () => openProperties(), title: 'Edit document properties' },
      parts.length ? h('span', parts.join(' · ')) : h('span', { class: 'ca-docline-empty' }, 'Add project details'),
      st.state === 'checked' && UI.pill(`Checked by ${st.by}`, 'green'),
      st.state === 'stale' && UI.pill('Changed since check', 'amber'));
  }
  function fmtDateTime(iso) {
    return iso ? new Date(iso).toLocaleString(S.app.locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function renderBanners() {
    const wrap = c => (Array.isArray(c) ? groupText(c) : [h('span', c)]);
    const list = [...S.banners];
    if (S.app.home && !S.isHome && !S.homeBannerDismissed && S.mode !== 'preview') {
      list.unshift({ id: 'home', kind: 'info', content: [
        `This is ${S.isLocal ? 'a saved copy' : 'a copy'} of ${S.app.name}. For the latest version of the tool, use the hosted site.`,
        h('span', { class: 'ca-spacer' }),
        h('button', { class: 'ca-btn primary', onclick: openInHome }, S.data ? 'Open data in latest tool' : 'Go to latest tool'),
        h('button', { class: 'ca-btn', onclick: () => { S.homeBannerDismissed = true; render(); } }, 'Dismiss')] });
    }
    return h('div', { class: 'ca-banners' }, list.map(b => h('div', { class: `ca-banner ${b.kind}`, role: 'status' }, wrap(b.content))));
  }
  // Merge leading text/strong parts into one span so they flow as a sentence.
  function groupText(parts) {
    const out = []; let span = null;
    for (const p of parts) {
      const inline = typeof p === 'string' || (p instanceof Node && p.tagName === 'STRONG');
      if (inline) { if (!span) out.push(span = h('span')); span.append(p); }
      else { span = null; out.push(p); }
    }
    return out;
  }
  function renderTabs() {
    if (S.app.views.length < 2) return '';
    const n = S.app.views.length;
    const go = i => { S.tab = (i + n) % n; render(); document.getElementById(`ca-tab-${S.tab}`)?.focus(); };
    return h('nav', { class: 'ca-tabs', role: 'tablist', 'aria-label': 'Views' }, S.app.views.map((v, i) =>
      h('button', { class: 'ca-tab', role: 'tab', id: `ca-tab-${i}`, 'aria-selected': String(i === S.tab), 'aria-controls': 'ca-panel',
        tabindex: i === S.tab ? '0' : '-1', onclick: () => { S.tab = i; render(); },
        onkeydown: e => {
          if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
          else if (e.key === 'Home') { e.preventDefault(); go(0); }
          else if (e.key === 'End') { e.preventDefault(); go(n - 1); }
        } }, v.title)));
  }
  function renderCurrentView() {
    const el = h('div');
    renderView(el, S.app.views[S.tab], String(S.tab));
    return el;
  }
  function renderLanding() {
    const rec = h('div');
    IDB.all().then(list => {
      list = list.filter(r => r.appId === S.app.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
      if (!list.length) return;
      rec.append(h('div', { class: 'ca-card', style: { textAlign: 'left' } }, h('h2', 'Recover work that was not downloaded'),
        list.map(r => h('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.375rem 0' } },
          h('span', { style: { flex: 1 } }, `${r.fileName || 'Untitled'} `, h('span', { class: 'ca-muted' }, fmtDateTime(r.at))),
          h('button', { class: 'ca-btn', onclick: () => restoreRecovery(r) }, 'Restore'),
          h('button', { class: 'ca-btn', onclick: () => IDB.del(r.key).then(render) }, 'Discard')))));
    }).catch(() => {});
    return h('div', { class: 'ca-landing' },
      h('h2', S.app.name),
      S.app.description && h('p', { class: 'ca-muted' }, S.app.description),
      h('div', { class: 'ca-actions' },
        h('button', { class: 'ca-btn primary', onclick: pickAndOpen }, 'Open a saved file…'),
        h('button', { class: 'ca-btn', onclick: startNew }, 'Start new')),
      h('div', { class: 'ca-drop-hint' }, 'Or drag a saved copy (.html), a JSON export or a CSV onto this page.'),
      h('p', { class: 'ca-muted', style: { fontSize: '0.875rem', marginTop: '1rem' } }, 'Everything runs in your browser. Nothing is uploaded: your data leaves this page only as a file you download.'),
      rec);
  }
  function renderFooter() {
    const m = S.data?.meta;
    const who = S.data?.properties?.updatedBy;
    const docInfo = !m ? 'No document open'
      : m.savedAt ? `Last downloaded ${fmtDateTime(m.savedAt)}${who ? ' by ' + who : ''} · save ${m.revision}`
      : 'Not downloaded yet';
    return h('footer', { class: 'ca-footer' },
      h('div', { class: 'ca-footer-inner' },
        h('span', docInfo),
        h('span', { class: 'ca-footer-end' },
          h('span', `${S.app.name} ${S.app.version} · schema ${S.app.schemaVersion} · Carryall ${CORE_VERSION}`),
          h('button', { class: 'ca-btn link', onclick: showAbout }, 'About this file'))));
  }
  function showAbout() {
    const m = S.data?.meta || {};
    const rows = S.data ? Object.entries(S.app.tables).map(([k, td]) => `${td.label}: ${S.data.tables[k].length}`).join(', ') : '-';
    const bytes = S.data ? serialise(S.data).length : 0;
    const kv = [['Tool', `${S.app.name} (${S.app.id})`], ['Tool version', S.app.version], ['Schema version', S.app.schemaVersion], ['Carryall core', CORE_VERSION],
      ['Home', S.app.home || '(none)'], ['Running from', S.isHome ? 'home site' : S.isLocal ? 'local file' : location.origin],
      ['File', S.fileName || '-'], ['Document id', m.docId || '-'], ['Save count', m.revision ?? '-'], ['Created', m.created || '-'],
      ['Last saved', m.savedAt || '-'], ['Updated by', S.data?.properties.updatedBy || '-'], ['Rows', rows], ['Data size', fmtBytes(bytes)],
      ['Migrations', (m.migrations || []).map(x => `${x.from}→${x.to} (${x.at.slice(0, 10)})`).join(', ') || '-']];
    dialog({ title: 'About this file', wide: true,
      body: h('div', h('dl', { class: 'ca-kv' }, kv.map(([k, v]) => [h('dt', k), h('dd', String(v))])),
        S.app.description && h('p', { class: 'ca-muted' }, S.app.description)),
      buttons: [{ label: 'Run self-test', left: true, onClick: () => { selfTest(true); return false; } }, { label: 'Close', value: null, primary: true }] });
  }

  // ── Self-test (for app authors and LLMs) ───────────────────────────────
  function selfTest(show = false) { return withCalc(() => runSelfTest(show)); }
  function runSelfTest(show) {
    const res = [];
    const ok = (name, pass, detail = '') => res.push({ pass: !!pass, name, detail });
    const app = S.app;
    const temp = !S.data;
    if (temp) S.data = newDocument();
    try {
      for (const [tk, td] of Object.entries(app.tables)) {
        for (const c of Object.values(td.columns)) {
          const where = `${tk}.${c.key}`;
          ok(`${where} type`, COLUMN_TYPES.includes(c.type), c.type);
          if (c.type === 'choice') ok(`${where} options`, Array.isArray(c.options) && c.options.length);
          if (c.type === 'ref') ok(`${where} ref target`, !!app.tables[c.table], c.table);
          if (c.type === 'computed') ok(`${where} fn`, typeof c.fn === 'function');
        }
        ok(`${tk} display column`, typeof td.display === 'function' || !!td.columns[td.display], String(td.display));
      }
      for (let v = 2; v <= app.schemaVersion; v++) ok(`migration to v${v}`, typeof app.migrations[v] === 'function');
      const extra = Object.keys(app.migrations).map(Number).filter(v => v < 2 || v > app.schemaVersion);
      ok('no stray migrations', !extra.length, extra.join(','));
      const probe = h('div');
      app.views.forEach((v, i) => {
        const errs = [];
        const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
        try { renderView(probe, v, `selftest.${i}`); } finally { console.error = orig; }
        ok(`view "${v.title}" renders`, !errs.length && !probe.textContent.includes('failed to render') && !probe.textContent.includes('Unknown view type'), errs.join('; '));
        probe.textContent = '';
      });
      // Starting rows (onNew) must calculate and pass the tables' own checks.
      for (const [tk, td] of Object.entries(app.tables)) {
        const rows = S.data.tables[tk];
        if (!rows.length) continue;
        for (const c of Object.values(td.columns)) {
          if (c.type !== 'computed') continue;
          S.lastCalcError = null;
          const bad = rows.find(r => { const v = rawValue(tk, r, c.key); return typeof v === 'number' && isNaN(v); });
          ok(`${tk}.${c.key} calculates for the starting rows`, !bad, bad ? `${displayOf(tk, bad) || bad.id}: ${S.lastCalcError || 'invalid number'}` : '');
        }
        const invalid = rows.map(r => [r, validateRow(tk, r)]).find(([, e]) => Object.keys(e).length);
        ok(`${tk} starting rows are valid`, !invalid, invalid ? `${displayOf(tk, invalid[0]) || invalid[0].id}: ${Object.values(invalid[1]).join('; ')}` : '');
      }
      const saved = S.data;
      for (const fx of app.fixtures || []) {
        S.lastCalcError = null;
        try {
          let d = clone(fx.doc);
          if ((d.app?.schemaVersion || 1) < app.schemaVersion) d = migrate(d);
          normalise(d);
          S.data = d;
          let bad = 0;
          for (const [tk, td] of Object.entries(app.tables)) for (const r of d.tables[tk]) for (const c of Object.values(td.columns)) {
            if (c.type === 'computed') { const v = rawValue(tk, r, c.key); if (typeof v === 'number' && isNaN(v)) bad++; }
            if (c.type === 'ref' && r[c.key] && !d.tables[c.table].some(x => x.id === r[c.key])) bad++;
          }
          ok(`fixture "${fx.name}" migrates cleanly`, !bad, bad ? `${bad} bad values${S.lastCalcError ? ` (${S.lastCalcError})` : ''}` : '');
          if (fx.expect) {
            const out = fx.expect(d, makeApi());
            ok(`fixture "${fx.name}" expectations`, out !== false && typeof out !== 'string', typeof out === 'string' ? out : '');
          }
        } catch (e) { ok(`fixture "${fx.name}"`, false, e.message); }
        finally { S.data = saved; }
      }
      if (S.data && !temp) {
        const html = buildFile(prepareForSave());
        const back = extractFromHtml(html);
        ok('export round-trip preserves data', JSON.stringify(back.tables) === JSON.stringify(S.data.tables) && JSON.stringify(back.settings) === JSON.stringify(S.data.settings));
        ok('export round-trip preserves document properties', JSON.stringify(back.properties.revisions) === JSON.stringify(S.data.properties.revisions) && back.properties.projectNumber === S.data.properties.projectNumber);
        ok('export contains core + app scripts', /id="ca-core"/.test(html) && /id="ca-app"/.test(html));
      }
    } catch (e) { ok('self-test crashed', false, e.stack || e.message); }
    finally { if (temp) S.data = null; }
    const failed = res.filter(r => !r.pass);
    console[failed.length ? 'warn' : 'log'](`[carryall] self-test: ${res.length - failed.length}/${res.length} passed`, failed);
    if (show) {
      dialog({ title: `Self-test: ${res.length - failed.length}/${res.length} passed`, wide: true,
        body: h('table', { class: 'ca-table' }, h('tbody', res.map(r => h('tr', h('td', r.pass ? 'Pass' : UI.pill('Fail', 'red')), h('td', r.name), h('td', { class: 'ca-muted' }, r.detail))))) });
    }
    return { passed: res.length - failed.length, failed: failed.length, results: res };
  }

  // ── Formulas ───────────────────────────────────────────────────────────
  // A small spreadsheet-like language for tool definitions: calculated columns, conditions,
  // KPIs and rules. It is parsed and interpreted here; nothing is ever passed to eval.
  const FX_RESERVED = ['and', 'or', 'not', 'in', 'where', 'true', 'false', 'null', 'blank', 'this', 'settings', 'before', 'id'];
  const FX_TABLE_FNS = ['SUM', 'COUNT', 'AVERAGE', 'MIN', 'MAX', 'NEXTREF'];
  // name: [fewest arguments, most arguments, result type]
  const FX_FNS = {
    IF: [2, 3], IFS: [2, 99], SWITCH: [3, 99], AND: [1, 99, 'boolean'], OR: [1, 99, 'boolean'], NOT: [1, 1, 'boolean'],
    ISBLANK: [1, 1, 'boolean'], IFBLANK: [2, 2], COALESCE: [1, 99], BLANK: [0, 0],
    ROUND: [1, 2, 'number'], ROUNDUP: [1, 2, 'number'], ROUNDDOWN: [1, 2, 'number'], ABS: [1, 1, 'number'], SQRT: [1, 1, 'number'],
    POWER: [2, 2, 'number'], MOD: [2, 2, 'number'], INT: [1, 1, 'number'], CEILING: [1, 2, 'number'], FLOOR: [1, 2, 'number'],
    SUM: [1, 99, 'number'], AVERAGE: [1, 99, 'number'], MIN: [1, 99], MAX: [1, 99], COUNT: [1, 1, 'number'],
    CONCAT: [1, 99, 'text'], LEN: [1, 1, 'number'], UPPER: [1, 1, 'text'], LOWER: [1, 1, 'text'], TRIM: [1, 1, 'text'],
    LEFT: [1, 2, 'text'], RIGHT: [1, 2, 'text'], CONTAINS: [2, 2, 'boolean'], VALUE: [1, 1, 'number'],
    TODAY: [0, 0, 'date'], USER: [0, 0, 'text'], DAYS: [2, 2, 'number'], YEARFRAC: [2, 2, 'number'], EDATE: [2, 2, 'date'],
    ADDDAYS: [2, 2, 'date'], YEAR: [1, 1, 'number'], MONTH: [1, 1, 'number'], DAY: [1, 1, 'number'], DATE: [3, 3, 'date'],
    NEXTREF: [3, 3, 'text'],
  };
  const FX_ALIASES = { AVG: 'AVERAGE', IFNULL: 'IFBLANK', NVL: 'IFBLANK', ISNULL: 'ISBLANK', ISEMPTY: 'ISBLANK', CONCATENATE: 'CONCAT', LENGTH: 'LEN' };
  const FX_HINTS = {
    SUMIF: 'Use SUM(table.column WHERE condition).', SUMIFS: 'Use SUM(table.column WHERE condition AND condition).',
    COUNTIF: 'Use COUNT(table WHERE condition).', COUNTIFS: 'Use COUNT(table WHERE condition AND condition).',
    AVERAGEIF: 'Use AVERAGE(table.column WHERE condition).', COUNTA: 'Use COUNT(table WHERE NOT(ISBLANK(column))).',
    NOW: 'Use TODAY().', DATEDIF: 'Use DAYS(end, start) or YEARFRAC(start, end).', IIF: 'Use IF(condition, value if true, value if false).',
    LOOKUP: 'Follow a link column instead, for example site.name.', VLOOKUP: 'Follow a link column instead, for example site.name.',
    XLOOKUP: 'Follow a link column instead, for example site.name.', INDEX: 'Follow a link column instead, for example site.name.',
  };
  class FxError extends Error { constructor(msg, at) { super(msg); this.at = at; } }
  const isIsoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const QUOTES = { "'": "'", '"': '"', '‘': '’', '“': '”', '’': '’', '”': '”' };

  function fxTokens(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i], at = i;
      if (/\s/.test(c)) { i++; continue; }
      if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
        const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        out.push({ t: 'num', v: parseFloat(m[0]), at }); i += m[0].length; continue;
      }
      if (QUOTES[c]) {
        const close = QUOTES[c];
        let s = ''; i++;
        for (;;) {
          if (i >= src.length) throw new FxError('A piece of text is missing its closing quote', at);
          if (src[i] === close) { if (src[i + 1] === close) { s += close; i += 2; continue; } i++; break; }
          s += src[i++];
        }
        out.push({ t: 'str', v: s, at }); continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        out.push({ t: 'id', v: m[0], at }); i += m[0].length; continue;
      }
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '<>', '!=', '==', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two, at }); i += 2; continue; }
      const one = { ';': ',', '≤': '<=', '≥': '>=', '≠': '<>', '−': '-', '×': '*', '÷': '/' }[c] || c;
      if (['+', '-', '*', '/', '^', '&', '=', '<', '>', '(', ')', ',', '.', '!', '%', '<=', '>=', '<>'].includes(one)) { out.push({ t: 'op', v: one, at }); i++; continue; }
      throw new FxError(`"${c}" is not allowed in a formula`, at);
    }
    out.push({ t: 'end', at: src.length });
    return out;
  }

  function fxParse(src) {
    if (typeof src !== 'string' || !src.trim()) throw new FxError('The formula is empty', 0);
    const tk = fxTokens(src);
    let p = 0;
    const peek = (o = 0) => tk[Math.min(p + o, tk.length - 1)];
    const isOp = (v, o = 0) => peek(o).t === 'op' && peek(o).v === v;
    const isKw = (v, o = 0) => peek(o).t === 'id' && peek(o).v.toUpperCase() === v;
    const desc = t => (t.t === 'end' ? 'the end of the formula' : `"${t.t === 'str' ? "'" + t.v + "'" : t.v}"`);
    const fail = (m, t = peek()) => { throw new FxError(m, t.at); };
    const eat = v => { if (!isOp(v)) fail(`Expected "${v}" but found ${desc(peek())}`); return tk[p++]; };
    const expr = () => or();
    function or() { let a = and(); while (isKw('OR') || isOp('||')) { const at = tk[p++].at; a = { t: 'bin', op: 'OR', a, b: and(), at }; } return a; }
    function and() { let a = not(); while (isKw('AND') || isOp('&&')) { const at = tk[p++].at; a = { t: 'bin', op: 'AND', a, b: not(), at }; } return a; }
    function not() {
      if ((isKw('NOT') && !isKw('IN', 1)) || isOp('!')) { const at = tk[p++].at; return { t: 'not', a: not(), at }; }
      return cmp();
    }
    function cmp() {
      let a = cat();
      for (;;) {
        const t = peek();
        if (t.t === 'op' && ['=', '==', '<>', '!=', '<', '>', '<=', '>='].includes(t.v)) {
          p++;
          a = { t: 'bin', op: { '==': '=', '!=': '<>' }[t.v] || t.v, a, b: cat(), at: t.at };
        } else if (isKw('IN') || (isKw('NOT') && isKw('IN', 1))) {
          const neg = isKw('NOT');
          if (neg) p++;
          const at = tk[p++].at;
          eat('(');
          const list = [expr()];
          while (isOp(',')) { p++; list.push(expr()); }
          eat(')');
          a = { t: 'in', a, list, neg, at };
        } else return a;
      }
    }
    function cat() { let a = add(); while (isOp('&')) { const at = tk[p++].at; a = { t: 'bin', op: '&', a, b: add(), at }; } return a; }
    function add() { let a = mul(); while (isOp('+') || isOp('-')) { const t = tk[p++]; a = { t: 'bin', op: t.v, a, b: mul(), at: t.at }; } return a; }
    function mul() { let a = pow(); while (isOp('*') || isOp('/')) { const t = tk[p++]; a = { t: 'bin', op: t.v, a, b: pow(), at: t.at }; } return a; }
    function pow() { const a = unary(); if (isOp('^')) { const t = tk[p++]; return { t: 'bin', op: '^', a, b: pow(), at: t.at }; } return a; }
    function unary() {
      if (isOp('-') || isOp('+')) { const t = tk[p++]; const a = unary(); return t.v === '-' ? { t: 'neg', a, at: t.at } : a; }
      let a = primary();
      while (isOp('%')) { const t = tk[p++]; a = { t: 'bin', op: '/', a, b: { t: 'lit', v: 100, at: t.at }, at: t.at }; }
      return a;
    }
    function primary() {
      const t = peek();
      if (t.t === 'num' || t.t === 'str') { p++; return { t: 'lit', v: t.v, at: t.at }; }
      if (isOp('(')) { p++; const a = expr(); eat(')'); return a; }
      if (t.t === 'id') {
        const up = t.v.toUpperCase();
        if (isOp('(', 1)) return call();
        if (up === 'TRUE' || up === 'FALSE') { p++; return { t: 'lit', v: up === 'TRUE', at: t.at }; }
        if (up === 'NULL' || up === 'BLANK') { p++; return { t: 'lit', v: null, at: t.at }; }
        if (['AND', 'OR', 'NOT', 'IN', 'WHERE'].includes(up)) fail(`"${t.v}" is in the wrong place. Check the formula around it`);
        const parts = [t.v];
        p++;
        while (isOp('.')) {
          p++;
          if (peek().t !== 'id') fail(`Expected a column name after "${parts.join('.')}."`);
          parts.push(tk[p++].v);
        }
        return { t: 'path', parts, at: t.at };
      }
      fail(t.t === 'end' ? 'The formula ends too early. Check for a missing value or bracket' : `Unexpected ${desc(t)}`);
    }
    function call() {
      const t = tk[p++];
      p++;
      const args = [];
      let where = null;
      if (!isOp(')')) {
        for (;;) {
          args.push(expr());
          if (isKw('WHERE')) {
            if (args.length > 1 || where) fail('WHERE can only follow the first argument, as in SUM(table.column WHERE condition)');
            p++;
            where = expr();
          }
          if (isOp(',')) { p++; continue; }
          break;
        }
      }
      eat(')');
      return { t: 'call', name: t.v.toUpperCase(), raw: t.v, args, where, at: t.at };
    }
    const ast = expr();
    if (peek().t !== 'end') fail(`Unexpected ${desc(peek())}. Check for a missing operator, comma or bracket`);
    return ast;
  }

  // ── Formula checking (against the tool's tables) ───────────────────────
  // sch: { tables: { key: { cols: { key: col } } }, settings: { key: col } }
  // sc:  { sch, table, thisTable, where, before, raw, deps }
  const TYPE_OF = { text: 'text', longtext: 'text', choice: 'text', number: 'number', currency: 'number', percent: 'number', date: 'date', boolean: 'boolean' };
  const FORMAT_TYPE = { number: 'number', integer: 'number', currency: 'number', percent: 'number', date: 'date', text: 'text', boolean: 'boolean' };
  function colInfo(col) {
    if (col.type === 'ref') return { type: 'ref', ref: col.table };
    if (col.type === 'computed') return { type: (col.format && FORMAT_TYPE[col.format]) || col._type || 'any' };
    return { type: TYPE_OF[col.type] || 'any' };
  }
  function closest(name, options) {
    const lev = (a, b) => {
      const d = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        let prev = d[0]; d[0] = i;
        for (let j = 1; j <= b.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
      }
      return d[b.length];
    };
    const n = String(name).toLowerCase();
    let best = null, score = Infinity;
    for (const o of options) {
      const s = lev(n, String(o).toLowerCase());
      if (s < score) { best = o; score = s; }
    }
    return best != null && score <= Math.max(2, Math.floor(n.length / 3)) ? best : null;
  }
  function unknownMsg(what, name, options, extra = '') {
    const best = closest(name, options);
    const list = options.length && options.length <= 15 ? ` Known: ${options.join(', ')}.` : '';
    return `Unknown ${what}.${best ? ` Did you mean "${best}"?` : list}${extra ? ' ' + extra : ''}`;
  }
  function fxCheck(n, sc) {
    const fail = m => { throw new FxError(m, n.at); };
    switch (n.t) {
      case 'lit': return { type: n.v === null ? 'any' : typeof n.v === 'number' ? 'number' : typeof n.v === 'boolean' ? 'boolean' : isIsoDate(n.v) ? 'date' : 'text' };
      case 'neg': fxCheck(n.a, sc); return { type: 'number' };
      case 'not': fxCheck(n.a, sc); return { type: 'boolean' };
      case 'in': { const a = fxCheck(n.a, sc); n.list.forEach(x => fxCheckCompare(n, a, fxCheck(x, sc), sc)); return { type: 'boolean' }; }
      case 'bin': {
        const a = fxCheck(n.a, sc), b = fxCheck(n.b, sc);
        n.types = [a.type, b.type];
        if (n.op === '=' || n.op === '<>') fxCheckCompare(n, a, b, sc);
        if (['AND', 'OR', '=', '<>', '<', '>', '<=', '>='].includes(n.op)) return { type: 'boolean' };
        if (n.op === '&') return { type: 'text' };
        if (n.op === '+' || n.op === '-') {
          if (a.type === 'date' && b.type === 'date') {
            if (n.op === '+') fail('Two dates cannot be added. To find the days between them, subtract one from the other');
            return { type: 'number' };
          }
          if (a.type === 'date' || (b.type === 'date' && n.op === '+')) return { type: 'date' };
          if (b.type === 'date') fail('A date cannot be taken away from a number');
          return { type: a.type === 'text' || b.type === 'text' ? 'any' : 'number' };
        }
        if (a.type === 'date' || b.type === 'date') fail(`Dates cannot be used with "${n.op}". Use DAYS(end, start) to get a number of days`);
        return { type: 'number' };
      }
      case 'path': return fxCheckPath(n, sc);
      case 'call': return fxCheckCall(n, sc);
    }
    fail('This formula could not be read');
  }
  // Comparing a link column with "id" inside WHERE is the classic mistake: that "id" is the
  // row being tested, not the row that owns the formula. "this" is what is meant.
  function fxCheckCompare(n, a, b, sc) {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (sc.where && x.type === 'ref' && x.col && !x.outer && y.bareId) {
        throw new FxError(`Inside WHERE, "id" is the id of the ${sc.table} row being tested, so this is never true. To match the row this formula belongs to, use "this", for example ${x.text} = this`, n.at);
      }
      if (x.type === 'ref' && y.type === 'ref' && x.ref && y.ref && x.ref !== y.ref && (x.col || y.col)) {
        throw new FxError(`${x.text} links to "${x.ref}" but ${y.text} is a "${y.ref}" row, so they never match. Check the column names`, n.at);
      }
    }
  }
  function fxCheckPath(n, sc) {
    const fail = m => { throw new FxError(m, n.at); };
    const [head, ...rest] = n.parts;
    const low = head.toLowerCase();
    const text = n.parts.join('.');
    let table, parts;
    if (low === 'this') {
      if (!sc.thisTable) fail('"this" only works in formulas that belong to a table, such as a calculated column');
      if (!rest.length) return { type: 'ref', ref: sc.thisTable, isThis: true, text };
      table = sc.thisTable; parts = rest;
      if (sc.deps && rest[0] !== 'id') sc.deps.add(rest[0]);
    } else if (low === 'settings') {
      const keys = Object.keys(sc.sch.settings);
      if (!rest.length) fail(`Name a setting, for example settings.${keys[0] || 'name'}`);
      const col = sc.sch.settings[rest[0]];
      if (!col) fail(unknownMsg(`setting "${rest[0]}"`, rest[0], keys, keys.length ? '' : 'This tool has no settings. Add them to the "settings" list.'));
      if (rest.length > 1) fail(`settings.${rest[0]} is not a link, so ".${rest[1]}" cannot follow it`);
      return colInfo(col);
    } else if (low === 'before') {
      if (!sc.before) fail('"before" only works in onSave rules, where it means the row as it was before the edit');
      if (!rest.length) fail('Name a column, for example before.status');
      table = sc.table; parts = rest;
    } else {
      if (sc.raw) return { type: 'any' }; // migrations work on old data, so names are not checked
      if (!sc.table) {
        if (sc.sch.tables[head]) fail(`"${head}" is a table. Here, use a total such as COUNT(${head}) or SUM(${head}.column WHERE condition)`);
        fail(`"${head}" is not known here. This formula does not belong to a table row, so it can use settings, TODAY() and table totals such as SUM(table.column)`);
      }
      table = sc.table; parts = n.parts;
      if (sc.deps && !sc.where && head !== 'id') sc.deps.add(head);
    }
    let info = null;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      const td = sc.sch.tables[table];
      if (key === 'id') {
        if (i < parts.length - 1) fail('"id" cannot be followed by "."');
        return { type: 'ref', ref: table, bareId: i === 0 && low !== 'this' && low !== 'before', text };
      }
      const col = td.cols[key];
      if (!col) {
        const isTable = i === 0 && sc.sch.tables[key];
        fail(unknownMsg(`column "${key}" in table "${table}"`, key, Object.keys(td.cols),
          isTable ? `"${key}" is a table: add up its rows with SUM(${key}.column WHERE condition) or count them with COUNT(${key} WHERE condition).` : ''));
      }
      info = { ...colInfo(col), col: true, outer: low === 'this', text };
      if (i < parts.length - 1) {
        if (col.type !== 'ref') fail(`"${key}" is not a link to another table, so ".${parts[i + 1]}" cannot follow it`);
        table = col.table;
      }
    }
    return info;
  }
  function fxCheckCall(n, sc) {
    const fail = m => { throw new FxError(m, n.at); };
    const name = FX_ALIASES[n.name] || n.name;
    n.fn = name;
    const sig = FX_FNS[name];
    if (!sig) fail(FX_HINTS[n.name] ? `${n.raw}() is not available. ${FX_HINTS[n.name]}` : unknownMsg(`function ${n.raw}()`, name, Object.keys(FX_FNS)));
    const head = n.args[0] && n.args[0].t === 'path' ? n.args[0].parts : null;
    const tableForm = FX_TABLE_FNS.includes(name) && head && !!sc.sch.tables[head[0]];
    const anyTable = Object.keys(sc.sch.tables)[0] || 'table';
    if (name === 'COUNT' && !tableForm) fail(`COUNT counts the rows of a table, for example COUNT(${anyTable} WHERE condition).${head ? ` "${head[0]}" is not a table.` : ''}`);
    if (name === 'NEXTREF' && !tableForm) fail(`NEXTREF needs a table column first, for example NEXTREF(${anyTable}.ref, 'REF-', 3)`);
    if (n.where && !tableForm) fail(`WHERE needs a table first, for example SUM(${anyTable}.column WHERE condition).${head ? ` "${head[0]}" is not a table.` : ''}`);
    if (n.args.length < sig[0] || n.args.length > sig[1]) {
      const want = sig[0] === sig[1] ? `${sig[0]}` : sig[1] === 99 ? `at least ${sig[0]}` : `${sig[0]} or ${sig[1]}`;
      fail(`${name}() needs ${want} value${want === '1' ? '' : 's'} inside its brackets, but has ${n.args.length}`);
    }
    if (tableForm) {
      if (sc.raw) fail('Table totals cannot be used in a migration step');
      n.agg = true;
      n.table = head[0];
      n.field = head[1] || null;
      if (head.length > 2) fail(`Only one column can follow the table name, as in ${name}(${head[0]}.${head[1]} WHERE ...)`);
      const td = sc.sch.tables[n.table];
      let info = { type: 'number' };
      if (n.field && n.field !== 'id') {
        const col = td.cols[n.field];
        if (!col) fail(unknownMsg(`column "${n.field}" in table "${n.table}"`, n.field, Object.keys(td.cols)));
        info = colInfo(col);
        if ((name === 'SUM' || name === 'AVERAGE') && ['text', 'date', 'boolean', 'ref'].includes(info.type)) fail(`${name} needs a number column, but "${n.table}.${n.field}" is ${col.type === 'computed' ? 'not a number' : col.type}`);
      }
      if ((name === 'SUM' || name === 'AVERAGE' || name === 'NEXTREF') && !n.field) fail(`${name} needs a column after the table name, for example ${name}(${n.table}.${Object.keys(td.cols)[0] || 'column'})`);
      if (n.where) fxCheck(n.where, { ...sc, table: n.table, where: true });
      n.args.slice(1).forEach(a => fxCheck(a, sc));
      if (name === 'MIN' || name === 'MAX') return { type: info.type === 'ref' ? 'any' : info.type };
      return { type: sig[2] };
    }
    const types = n.args.map(a => fxCheck(a, sc).type);
    if (sig[2]) return { type: sig[2] };
    if (name === 'IF') return { type: types.length > 2 && types[1] !== types[2] && types[2] !== 'any' ? (types[1] === 'any' ? types[2] : 'any') : types[1] };
    if (['IFBLANK', 'COALESCE', 'MIN', 'MAX'].includes(name)) return { type: types.find(t => t !== 'any') || 'any' };
    return { type: 'any' };
  }

  // ── Formula evaluation ─────────────────────────────────────────────────
  // cx: { table, row, thisTable, thisRow, before, raw, settings }
  const fxBlank = v => v == null || v === '';
  function fxTruthy(v) {
    if (typeof v === 'number') return v !== 0 && !isNaN(v);
    if (typeof v === 'string') return v !== '' && !['false', 'no', '0'].includes(v.trim().toLowerCase());
    return !!v;
  }
  function fxNum(v, n) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const s = String(v).trim();
    if (isIsoDate(s)) throw new FxError(`The date ${s} cannot be used as a number here. Use DAYS(end, start) for a number of days`, n && n.at);
    const x = Number(s.replace(/,/g, ''));
    if (s === '' || isNaN(x)) throw new FxError(`"${s}" is text, not a number`, n && n.at);
    return x;
  }
  function fxStr(v) {
    if (v == null) return '';
    if (typeof v === 'number') return isFinite(v) ? String(+v.toFixed(10)) : '';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  }
  function fxEq(a, b) {
    if (fxBlank(a) || fxBlank(b)) {
      if (fxBlank(a) && fxBlank(b)) return true;
      const o = fxBlank(a) ? b : a;
      return o === 0 || o === false;
    }
    if (typeof a === 'number' || typeof b === 'number') { const x = Number(a), y = Number(b); return !isNaN(x) && !isNaN(y) && Math.abs(x - y) < 1e-9 * Math.max(1, Math.abs(x)); }
    if (typeof a === 'boolean' || typeof b === 'boolean') return fxTruthy(a) === fxTruthy(b);
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }
  function fxCmp(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const x = Number(a), y = Number(b);
    if (typeof a !== 'string' || typeof b !== 'string') { if (!isNaN(x) && !isNaN(y)) return x - y; }
    const s = String(a).toLowerCase(), t = String(b).toLowerCase();
    return s < t ? -1 : s > t ? 1 : 0;
  }
  function fxRound(x, places, mode) {
    const f = Math.pow(10, Math.trunc(places));
    const s = Math.sign(x), m = Math.abs(x) * f;
    const r = mode === 'up' ? Math.ceil(m - 1e-9) : mode === 'down' ? Math.floor(m + 1e-9) : Math.round(m + 1e-9);
    return s * r / f;
  }
  function fxEval(n, cx) {
    switch (n.t) {
      case 'lit': return n.v;
      case 'neg': return -fxNum(fxEval(n.a, cx), n);
      case 'not': return !fxTruthy(fxEval(n.a, cx));
      case 'in': { const v = fxEval(n.a, cx); const hit = n.list.some(x => fxEq(v, fxEval(x, cx))); return n.neg ? !hit : hit; }
      case 'bin': return fxBinary(n, cx);
      case 'path': return fxPathValue(n, cx);
      case 'call': return n.agg ? fxAggregate(n, cx) : fxCallValue(n, cx);
    }
    throw new FxError('This formula could not be evaluated', n.at);
  }
  function fxBinary(n, cx) {
    if (n.op === 'AND') return fxTruthy(fxEval(n.a, cx)) && fxTruthy(fxEval(n.b, cx));
    if (n.op === 'OR') return fxTruthy(fxEval(n.a, cx)) || fxTruthy(fxEval(n.b, cx));
    const a = fxEval(n.a, cx), b = fxEval(n.b, cx);
    const isText = v => typeof v === 'string' && !isIsoDate(v) && v.trim() !== '' && isNaN(Number(v));
    switch (n.op) {
      case '=': return fxEq(a, b);
      case '<>': return !fxEq(a, b);
      // Ordering with a blank never matches, so "due < TODAY()" is false while due is empty.
      case '<': return !fxBlank(a) && !fxBlank(b) && fxCmp(a, b) < 0;
      case '>': return !fxBlank(a) && !fxBlank(b) && fxCmp(a, b) > 0;
      case '<=': return !fxBlank(a) && !fxBlank(b) && fxCmp(a, b) <= 0;
      case '>=': return !fxBlank(a) && !fxBlank(b) && fxCmp(a, b) >= 0;
      case '&': return fxStr(a) + fxStr(b);
      case '+': case '-': {
        const [ta, tb] = n.types || [];
        if ((ta === 'date' && fxBlank(a)) || (tb === 'date' && fxBlank(b))) return null;
        if (isIsoDate(a) && isIsoDate(b)) return n.op === '-' ? daysBetween(b, a) : fxNum(a, n.a);
        if (isIsoDate(a)) return addDays(a, (n.op === '-' ? -1 : 1) * fxNum(b, n.b));
        if (isIsoDate(b) && n.op === '+') return addDays(b, fxNum(a, n.a));
        if (n.op === '+' && (isText(a) || isText(b))) return fxStr(a) + fxStr(b);
        return n.op === '+' ? fxNum(a, n.a) + fxNum(b, n.b) : fxNum(a, n.a) - fxNum(b, n.b);
      }
      case '*': return fxNum(a, n.a) * fxNum(b, n.b);
      case '/': { const d = fxNum(b, n.b); return d === 0 ? null : fxNum(a, n.a) / d; }
      case '^': return Math.pow(fxNum(a, n.a), fxNum(b, n.b));
    }
    throw new FxError(`Unknown operator "${n.op}"`, n.at);
  }
  function fxPathValue(n, cx) {
    const [head, ...rest] = n.parts;
    const low = head.toLowerCase();
    let row, table, parts;
    if (low === 'this') {
      row = cx.thisRow; table = cx.thisTable; parts = rest;
      if (!parts.length) return row ? row.id ?? null : null;
    } else if (low === 'settings') {
      const s = cx.settings || (S.data ? S.data.settings : settingsDefaults());
      return s[rest[0]] ?? null;
    } else if (low === 'before') {
      row = cx.before; table = cx.table; parts = rest;
    } else {
      row = cx.row; table = cx.table; parts = n.parts;
    }
    if (cx.raw) return row && parts.length === 1 ? row[parts[0]] ?? null : null;
    for (let i = 0; i < parts.length; i++) {
      if (!row) return null;
      const key = parts[i];
      const v = key === 'id' ? row.id : rawValue(table, row, key);
      if (i === parts.length - 1) return v === undefined ? null : v;
      table = colDef(table, key).table;
      row = v ? rowById(table, v) : null;
    }
    return null;
  }
  function fxAggregate(n, cx) {
    let rows = tableRows(n.table);
    if (n.where) rows = rows.filter(r => fxTruthy(fxEval(n.where, { table: n.table, row: r, thisTable: cx.thisTable, thisRow: cx.thisRow })));
    const val = r => (n.field === 'id' ? r.id : rawValue(n.table, r, n.field));
    if (n.fn === 'COUNT') return n.field ? rows.filter(r => !fxBlank(val(r))).length : rows.length;
    if (n.fn === 'NEXTREF') {
      const prefix = fxStr(fxEval(n.args[1], cx)), width = fxNum(fxEval(n.args[2], cx), n.args[2]);
      const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
      let max = 0;
      for (const r of rows) { const m = re.exec(String(val(r) ?? '')); if (m) max = Math.max(max, +m[1]); }
      return prefix + String(max + 1).padStart(width, '0');
    }
    const vals = rows.map(val).filter(v => !fxBlank(v));
    if (n.fn === 'SUM') return vals.reduce((s, v) => s + fxNum(v, n), 0);
    if (!vals.length) return null;
    if (n.fn === 'AVERAGE') return vals.reduce((s, v) => s + fxNum(v, n), 0) / vals.length;
    return vals.reduce((m, v) => ((n.fn === 'MIN' ? fxCmp(v, m) < 0 : fxCmp(v, m) > 0) ? v : m));
  }
  function fxCallValue(n, cx) {
    const A = n.args;
    const ev = i => fxEval(A[i], cx);
    switch (n.fn) {
      case 'IF': return fxTruthy(ev(0)) ? ev(1) : A.length > 2 ? ev(2) : null;
      case 'IFS': for (let i = 0; i + 1 < A.length; i += 2) if (fxTruthy(ev(i))) return ev(i + 1); return null;
      case 'SWITCH': {
        const v = ev(0);
        let i = 1;
        for (; i + 1 < A.length; i += 2) if (fxEq(v, ev(i))) return ev(i + 1);
        return i < A.length ? ev(i) : null;
      }
      case 'AND': return A.every((_, i) => fxTruthy(ev(i)));
      case 'OR': return A.some((_, i) => fxTruthy(ev(i)));
      case 'NOT': return !fxTruthy(ev(0));
      case 'ISBLANK': return fxBlank(ev(0));
      case 'IFBLANK': { const v = ev(0); return fxBlank(v) ? ev(1) : v; }
      case 'COALESCE': for (let i = 0; i < A.length; i++) { const v = ev(i); if (!fxBlank(v)) return v; } return null;
      case 'BLANK': return null;
      case 'TODAY': return todayISO();
      case 'USER': return currentUser() || '';
    }
    const v = A.map((_, i) => ev(i));
    const num = i => fxNum(v[i], A[i]);
    const present = v.filter(x => !fxBlank(x));
    const date = i => (fxBlank(v[i]) ? null : parseDate(v[i]));
    switch (n.fn) {
      case 'ROUND': return fxRound(num(0), A.length > 1 ? num(1) : 0);
      case 'ROUNDUP': return fxRound(num(0), A.length > 1 ? num(1) : 0, 'up');
      case 'ROUNDDOWN': return fxRound(num(0), A.length > 1 ? num(1) : 0, 'down');
      case 'ABS': return Math.abs(num(0));
      case 'SQRT': { const x = num(0); if (x < 0) throw new FxError('SQRT of a negative number', n.at); return Math.sqrt(x); }
      case 'POWER': return Math.pow(num(0), num(1));
      case 'MOD': { const d = num(1); return d === 0 ? null : num(0) - d * Math.floor(num(0) / d); }
      case 'INT': return Math.floor(num(0));
      case 'CEILING': case 'FLOOR': {
        const sig = A.length > 1 ? num(1) : 1;
        if (!sig) return null;
        return (n.fn === 'CEILING' ? Math.ceil(num(0) / sig - 1e-9) : Math.floor(num(0) / sig + 1e-9)) * sig;
      }
      case 'SUM': return v.reduce((s, x, i) => s + fxNum(x, A[i]), 0);
      case 'AVERAGE': return present.length ? present.reduce((s, x) => s + fxNum(x, n), 0) / present.length : null;
      case 'MIN': case 'MAX': return present.length ? present.reduce((m, x) => ((n.fn === 'MIN' ? fxCmp(x, m) < 0 : fxCmp(x, m) > 0) ? x : m)) : null;
      case 'CONCAT': return v.map(fxStr).join('');
      case 'LEN': return fxStr(v[0]).length;
      case 'UPPER': return fxStr(v[0]).toUpperCase();
      case 'LOWER': return fxStr(v[0]).toLowerCase();
      case 'TRIM': return fxStr(v[0]).trim();
      case 'LEFT': return fxStr(v[0]).slice(0, A.length > 1 ? num(1) : 1);
      case 'RIGHT': { const s = fxStr(v[0]), k = A.length > 1 ? num(1) : 1; return k > 0 ? s.slice(-k) : ''; }
      case 'CONTAINS': return fxStr(v[0]).toLowerCase().includes(fxStr(v[1]).toLowerCase());
      case 'VALUE': { if (fxBlank(v[0])) return null; const x = Number(String(v[0]).replace(/[^0-9.eE+-]/g, '')); return isNaN(x) ? null : x; }
      case 'DAYS': return fxBlank(v[0]) || fxBlank(v[1]) ? null : daysBetween(v[1], v[0]);
      case 'YEARFRAC': return fxBlank(v[0]) || fxBlank(v[1]) ? null : yearsBetween(v[0], v[1]);
      case 'EDATE': return fxBlank(v[0]) ? null : addMonths(v[0], Math.trunc(num(1)));
      case 'ADDDAYS': return fxBlank(v[0]) ? null : addDays(v[0], Math.trunc(num(1)));
      case 'YEAR': { const d = date(0); return d ? d.getFullYear() : null; }
      case 'MONTH': { const d = date(0); return d ? d.getMonth() + 1 : null; }
      case 'DAY': { const d = date(0); return d ? d.getDate() : null; }
      case 'DATE': { const d = new Date(num(0), num(1) - 1, num(2)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    }
    throw new FxError(`${n.fn}() is not available`, n.at);
  }
  // Parse and check in one step. Returns the checked AST; throws FxError.
  function fxCompile(src, sc) {
    const ast = fxParse(src);
    fxCheck(ast, sc);
    return ast;
  }
  // Point at the problem in a formula for error messages.
  function fxWhere(src, e) {
    const s = String(src);
    const at = typeof e.at === 'number' ? e.at : -1;
    if (at < 0 || s.length <= 60) return `"${s}"`;
    const from = Math.max(0, at - 25), to = Math.min(s.length, at + 25);
    return `"${from > 0 ? '…' : ''}${s.slice(from, to)}${to < s.length ? '…' : ''}"`;
  }

  // ── Tool definitions (JSON) ────────────────────────────────────────────
  // A tool can be defined by JSON in <script id="ca-spec"> instead of JavaScript. This is the
  // no-code route: Copilot writes the JSON, the tool builder checks it and names every problem.
  // text -> parseLoose -> specNormalise (tidy common variations) -> specCheck -> specCompile,
  // which produces the same definition object that Carryall.app() takes.

  // Lenient JSON: also accepts comments, trailing commas, single-quoted text and unquoted keys,
  // ignores anything before the first "{" (such as a code fence) and after the matching "}".
  function parseLoose(text) {
    const src = String(text || '');
    let i = src.indexOf('{');
    const fail = (m, at = i) => {
      const pre = src.slice(0, at);
      const line = pre.split('\n').length, col = at - pre.lastIndexOf('\n');
      const e = new Error(`${m} (line ${line}, column ${col}).`);
      e.line = line; e.col = col;
      throw e;
    };
    if (i < 0) {
      const e = new Error(src.trim() ? 'No tool definition found. It is JSON that starts with { and ends with }.' : 'Paste a tool definition first.');
      throw e;
    }
    const ws = () => {
      for (;;) {
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; }
        else if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); if (e < 0) fail('A /* comment is not closed'); i = e + 2; }
        else return;
      }
    };
    const OPEN = { '"': '"', "'": "'", '“': '”', '‘': '’' };
    function str() {
      const start = i, close = OPEN[src[i++]];
      let s = '';
      while (i < src.length) {
        const c = src[i++];
        if (c === close) return s;
        if (c === '\\') {
          const e = src[i++];
          if (e === 'u') { s += String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); i += 4; }
          else s += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[e] ?? e;
        } else if (c === '\n') fail('A piece of text runs past the end of its line. Check for a missing closing quote', start);
        else s += c;
      }
      fail('A piece of text is missing its closing quote', start);
    }
    function value() {
      ws();
      const c = src[i];
      if (c === '{') return obj();
      if (c === '[') return arr();
      if (OPEN[c]) return str();
      const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
      if (num) { i += num[0].length; return Number(num[0]); }
      const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 40));
      if (word) {
        const w = word[0];
        if (w === 'true' || w === 'false' || w === 'null') { i += w.length; return w === 'true' ? true : w === 'false' ? false : null; }
        if (w === 'function' || /^\s*\([^)]*\)\s*=>|^\w+\s*=>/.test(src.slice(i, i + 60))) fail('This looks like JavaScript, not JSON. In a tool definition, calculations are formulas in quotes, such as "formula": "quantity * rate"');
        fail(`Unexpected word "${w}". Text values need double quotes, for example "${w}"`);
      }
      if (c === undefined) fail('The definition ends too early. Check that every { and [ has a matching } and ]');
      if (c === '(' || (c === '=' && src[i + 1] === '>')) fail('This looks like JavaScript, not JSON. In a tool definition, calculations are formulas in quotes, such as "formula": "quantity * rate"');
      fail(`Unexpected "${c}"`);
    }
    function obj() {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (src[i] === '}') { i++; return o; }
        let k;
        if (OPEN[src[i]]) k = str();
        else {
          const m = /^[A-Za-z_$][\w$-]*/.exec(src.slice(i, i + 80));
          if (!m) fail(src[i] === undefined ? 'The definition ends too early. Check that every { has a matching }' : `Expected a property name in double quotes but found "${src[i]}"`);
          k = m[0]; i += k.length;
        }
        ws();
        if (src[i] !== ':') fail(`Expected ":" after "${k}"`);
        i++;
        o[k] = value();
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return o; }
        fail(src[i] === undefined ? 'The definition ends too early. Check that every { has a matching }' : `Expected "," or "}" after the value of "${k}". Check for a missing comma`);
      }
    }
    function arr() {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; return a; }
        a.push(value());
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; return a; }
        fail(src[i] === undefined ? 'The definition ends too early. Check that every [ has a matching ]' : 'Expected "," or "]" in a list. Check for a missing comma');
      }
    }
    return value();
  }

  // Readable JSON: short objects and lists stay on one line.
  const inlineJson = v => (v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? '[' + v.map(inlineJson).join(', ') + ']'
    : Object.keys(v).length ? '{ ' + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => JSON.stringify(k) + ': ' + inlineJson(x)).join(', ') + ' }' : '{}');
  function prettyJson(v, escapeHtml = false, indent = '') {
    const one = inlineJson(v);
    let out;
    if (v === null || typeof v !== 'object' || one.length + indent.length <= 100) out = one;
    else {
      const inner = indent + '  ';
      out = Array.isArray(v)
        ? '[\n' + v.map(x => inner + prettyJson(x, false, inner)).join(',\n') + '\n' + indent + ']'
        : '{\n' + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => inner + JSON.stringify(k) + ': ' + prettyJson(x, false, inner)).join(',\n') + '\n' + indent + '}';
    }
    return escapeHtml ? out.replace(/</g, '\\u003c') : out;
  }

  const PILL_COLOURS = ['grey', 'green', 'amber', 'red', 'blue', 'purple', 'teal', 'pink'];
  const FORMATS = ['number', 'integer', 'currency', 'percent', 'date', 'text', 'boolean'];
  const ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
  const TYPE_ALIASES = {
    string: 'text', str: 'text', varchar: 'text', shorttext: 'text', textarea: 'longtext', multiline: 'longtext', memo: 'longtext',
    note: 'longtext', notes: 'longtext', paragraph: 'longtext', richtext: 'longtext', int: 'number', integer: 'number', float: 'number',
    decimal: 'number', double: 'number', numeric: 'number', num: 'number', money: 'currency', price: 'currency', percentage: 'percent',
    pct: 'percent', datetime: 'date', timestamp: 'date', bool: 'boolean', checkbox: 'boolean', yesno: 'boolean', select: 'choice',
    enum: 'choice', dropdown: 'choice', list: 'choice', option: 'choice', options: 'choice', lookup: 'ref', link: 'ref',
    reference: 'ref', relation: 'ref', foreignkey: 'ref', fk: 'ref', formula: 'computed', calculated: 'computed', calc: 'computed',
    calculation: 'computed', derived: 'computed',
  };
  const VIEW_ALIASES = {
    list: 'table', grid: 'table', datagrid: 'table', records: 'table', chart: 'summary', group: 'summary', groupby: 'summary',
    breakdown: 'summary', kpis: 'kpi', stats: 'kpi', cards: 'kpi', figures: 'kpi', overview: 'dashboard', home: 'dashboard',
    config: 'settings', preferences: 'settings', report: 'sheet', print: 'sheet', printable: 'sheet', detail: 'sheet',
    crosstab: 'matrix', pivot: 'matrix',
  };
  const TOP_KEYS = ['id', 'name', 'description', 'version', 'schemaVersion', 'locale', 'currency', 'home', 'versionUrl', 'identity',
    'fileName', 'saveInPlace', 'properties', 'settings', 'tables', 'views', 'seed', 'migrations', 'tests'];
  const TABLE_KEYS = ['id', 'label', 'singular', 'description', 'display', 'displayFormula', 'columns', 'checks', 'onSave', 'readOnly'];
  const COL_COMMON = ['id', 'label', 'type', 'required', 'unique', 'help', 'hidden', 'hideInForm', 'mono', 'default', 'defaultFormula'];
  const COL_BY_TYPE = {
    text: ['maxLength'], longtext: [], number: ['min', 'max', 'decimals', 'step'], currency: ['min', 'max', 'currency', 'step'],
    percent: ['min', 'max', 'decimals', 'step'], date: [], boolean: ['checkLabel'], choice: ['options', 'colors'],
    ref: ['table', 'display'], computed: ['formula', 'format', 'decimals', 'currency', 'colors', 'colorFormula'],
  };
  const ALL_COL_KEYS = [...new Set([...COL_COMMON, ...Object.values(COL_BY_TYPE).flat()])];
  const VIEW_KEYS = {
    table: ['table', 'columns', 'sort', 'totals', 'filters', 'where', 'add', 'readOnly', 'preset', 'search'],
    summary: ['table', 'groupBy', 'bucket', 'metrics', 'chart', 'showTable', 'where', 'sortBy'],
    kpi: ['items'], dashboard: ['blocks'], settings: ['fields', 'intro'],
    sheet: ['table', 'fields', 'sort', 'where', 'child'],
    matrix: ['table', 'rows', 'columns', 'metrics', 'where'],
  };
  const STEP_OPS = {
    renameField: [['table', 'from', 'to'], []], removeField: [['table', 'field'], []],
    setField: [['table', 'field'], ['value', 'formula', 'when']], renameTable: [['from', 'to'], []],
    textToRef: [['table', 'field', 'to', 'target', 'match'], ['blankValue']], mapValues: [['table', 'field', 'map'], []],
  };
  const KEY_HINTS = {
    choices: 'Use "options" for the list of choices.', values: 'Use "options" for the list of choices.',
    fn: 'Use "formula" with a formula in quotes, such as "quantity * rate".', expression: 'Use "formula".', calc: 'Use "formula".',
    fields: 'Use "columns".', onNew: 'Put starting rows in "seed": { "tableId": [ { ... } ] }.', fixtures: 'Use "tests".',
    validate: 'Use "checks": [ { "errorIf": "formula", "message": "What to do" } ].',
    validation: 'Use "checks": [ { "errorIf": "formula", "message": "What to do" } ].',
    render: 'Custom JavaScript views are not possible in a tool definition. Use a sheet, matrix, summary or dashboard view.',
    references: 'Use "table" for the table a link points to.', refTable: 'Use "table" for the table a link points to.',
    defaultValue: 'Use "default".', condition: 'Use "where" for a filter, or "errorIf" in checks.',
  };
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const toCamel = s => String(s).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z]+/, '').replace(/^./, c => c.toLowerCase()) || 'name';
  const toKebab = s => String(s).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-tool';

  function specNormalise(raw) {
    const notes = [];
    const fixed = (where, message) => notes.push({ level: 'fixed', where, message });
    if (!isObj(raw)) throw new Error('A tool definition is one JSON object that starts with { and ends with }.');
    for (const k of ['tool', 'app', 'definition', 'spec']) {
      if (isObj(raw[k]) && raw[k].tables && !raw.tables) {
        const inner = specNormalise(raw[k]);
        inner.notes.unshift({ level: 'fixed', where: 'definition', message: `Used the definition inside "${k}"` });
        return inner;
      }
    }
    const spec = clone(raw);
    const rename = (o, from, to, where) => {
      if (isObj(o) && from in o && !(to in o)) {
        const entries = Object.entries(o).map(([k, v]) => [k === from ? to : k, v]);
        for (const k of Object.keys(o)) delete o[k];
        Object.assign(o, Object.fromEntries(entries));
        fixed(where, `Renamed "${from}" to "${to}"`);
      }
    };
    const toList = (x, what, where) => {
      if (!isObj(x)) return x;
      if (what === 'column' && Array.isArray(x.columns)) return x;
      fixed(where, `Changed ${what === 'column' ? 'columns' : what + 's'} from an object to a list`);
      return Object.entries(x).map(([k, v]) => (isObj(v) ? { id: k, ...v } : what === 'column' && typeof v === 'string' ? { id: k, type: v } : { id: k, value: v }));
    };
    rename(spec, 'title', 'name', 'definition');
    rename(spec, 'fixtures', 'tests', 'definition');
    rename(spec, 'schema_version', 'schemaVersion', 'definition');
    if (typeof spec.schemaVersion === 'string' && /^\d+$/.test(spec.schemaVersion)) { spec.schemaVersion = +spec.schemaVersion; fixed('schemaVersion', 'Changed schemaVersion from text to a number'); }
    if (typeof spec.version === 'number') { spec.version = String(spec.version).includes('.') ? `${spec.version}.0` : `${spec.version}.0.0`; fixed('version', 'Changed version to text such as "1.0.0"'); }
    for (const k of ['seedData', 'initialData', 'sampleData', 'startingRows']) rename(spec, k, 'seed', 'definition');

    const normCol = (c, where) => {
      if (!isObj(c)) return c;
      if (!c.id && typeof c.key === 'string') rename(c, 'key', 'id', where);
      if (!c.id && typeof c.name === 'string') { rename(c, 'name', 'id', where); }
      else if (c.id && typeof c.name === 'string' && !c.label) rename(c, 'name', 'label', where);
      where = where.replace(/"#\d+"$/, `"${c.id}"`);
      if (typeof c.type === 'string') {
        const t = c.type.trim().toLowerCase().replace(/[\s_-]/g, '');
        const to = COLUMN_TYPES.includes(t) ? t : TYPE_ALIASES[t];
        if (to && to !== c.type) { if (to !== c.type.toLowerCase()) fixed(where, `Changed type "${c.type}" to "${to}"`); c.type = to; }
      }
      for (const k of ['choices', 'values', 'enum', 'items', 'list']) if (Array.isArray(c[k])) rename(c, k, 'options', where);
      for (const k of ['fn', 'expression', 'calc', 'calculation', 'compute', 'formulae', 'expr']) if (typeof c[k] === 'string') rename(c, k, 'formula', where);
      for (const k of ['refTable', 'references', 'target', 'targetTable', 'linkTo', 'lookup', 'ref', 'foreignTable']) if (typeof c[k] === 'string') rename(c, k, 'table', where);
      rename(c, 'defaultValue', 'default', where);
      rename(c, 'description', 'help', where);
      rename(c, 'isRequired', 'required', where);
      if (!c.type && typeof c.formula === 'string') { c.type = 'computed'; fixed(where, 'Set type to "computed" because the column has a formula'); }
      if (typeof c.formula === 'string' && /^\s*=/.test(c.formula)) { c.formula = c.formula.replace(/^\s*=\s*/, ''); fixed(where, 'Removed the "=" at the start of the formula'); }
      if (typeof c.default === 'string' && /^\s*=/.test(c.default) && !('defaultFormula' in c)) { c.defaultFormula = c.default.replace(/^\s*=\s*/, ''); delete c.default; fixed(where, 'Moved the "=" default to "defaultFormula"'); }
      return c;
    };
    spec.tables = toList(spec.tables, 'table', 'tables');
    if (Array.isArray(spec.tables)) spec.tables.forEach((t, i) => {
      if (!isObj(t)) return;
      const where = `table "${t.id || '#' + (i + 1)}"`;
      if (!t.id && typeof t.key === 'string') rename(t, 'key', 'id', where);
      if (!t.id && typeof t.name === 'string' && ID_RE.test(t.name)) rename(t, 'name', 'id', where);
      else if (typeof t.name === 'string' && !t.label) rename(t, 'name', 'label', where);
      rename(t, 'fields', 'columns', where);
      rename(t, 'displayColumn', 'display', where);
      rename(t, 'validations', 'checks', where);
      t.columns = toList(t.columns, 'column', where);
      if (Array.isArray(t.columns)) t.columns.forEach((c, j) => normCol(c, `${where} › column "${(isObj(c) && (c.id || c.name || c.key)) || '#' + (j + 1)}"`));
    });
    if (isObj(spec.settings)) {
      if (Array.isArray(spec.settings.fields)) {
        const defaults = isObj(spec.settings.defaults) ? spec.settings.defaults : {};
        spec.settings = spec.settings.fields.map(f => (isObj(f) && f.default === undefined && f.id in defaults ? { ...f, default: defaults[f.id] } : f));
        fixed('settings', 'Changed settings to a list of fields with their defaults');
      } else if (isObj(spec.settings.columns) || Array.isArray(spec.settings.columns)) {
        spec.settings = Array.isArray(spec.settings.columns) ? spec.settings.columns : toList(spec.settings.columns, 'column', 'settings');
      } else spec.settings = toList(spec.settings, 'column', 'settings');
    }
    if (Array.isArray(spec.settings)) spec.settings.forEach((c, j) => normCol(c, `setting "${(isObj(c) && (c.id || c.name)) || '#' + (j + 1)}"`));

    const normSort = (o, where) => {
      if (!isObj(o)) return;
      for (const k of ['sortBy', 'orderBy', 'order']) if (o.type !== 'summary' || k !== 'sortBy') rename(o, k, 'sort', where);
      if (typeof o.sort === 'string') { const d = o.sort.startsWith('-'); o.sort = { column: o.sort.replace(/^-/, ''), dir: d ? 'desc' : 'asc' }; fixed(where, 'Changed sort to { "column", "dir" }'); }
      if (isObj(o.sort)) { for (const k of ['key', 'field', 'by']) rename(o.sort, k, 'column', where); for (const k of ['direction', 'order']) rename(o.sort, k, 'dir', where); if (typeof o.sort.dir === 'string') o.sort.dir = o.sort.dir.toLowerCase().startsWith('desc') ? 'desc' : 'asc'; }
    };
    const normMetrics = (list, where) => {
      if (!Array.isArray(list)) return;
      for (const m of list) {
        if (!isObj(m)) continue;
        for (const k of ['field', 'key']) rename(m, k, 'column', where);
        rename(m, 'name', 'label', where);
        for (const k of ['fn', 'function', 'aggregate', 'agg']) rename(m, k, 'op', where);
        if (typeof m.op === 'string') {
          const op = { average: 'avg', mean: 'avg', total: 'sum', minimum: 'min', maximum: 'max' }[m.op.toLowerCase()] || m.op.toLowerCase();
          if (op !== m.op) { fixed(where, `Changed metric op "${m.op}" to "${op}"`); m.op = op; }
        }
      }
    };
    const normView = (v, where) => {
      if (!isObj(v)) return v;
      for (const k of ['name', 'label', 'heading']) rename(v, k, 'title', where);
      if (typeof v.type === 'string') {
        const t = v.type.trim().toLowerCase().replace(/[\s_-]/g, '');
        const to = VIEW_KEYS[t] ? t : VIEW_ALIASES[t];
        if (to && to !== v.type) { if (to !== t) fixed(where, `Changed view type "${v.type}" to "${to}"`); v.type = to; }
      }
      normSort(v, where);
      for (const k of ['filter', 'condition']) if (typeof v[k] === 'string') rename(v, k, 'where', where);
      if (v.type === 'summary') for (const k of ['group', 'groupby', 'groupedBy', 'by']) rename(v, k, 'groupBy', where);
      normMetrics(v.metrics, where);
      if (v.type === 'kpi') {
        for (const k of ['metrics', 'kpis', 'cards']) rename(v, k, 'items', where);
        if (Array.isArray(v.items)) for (const it of v.items) if (isObj(it)) { for (const k of ['value', 'expression', 'calc']) if (typeof it[k] === 'string') rename(it, k, 'formula', where); rename(it, 'title', 'label', where); rename(it, 'name', 'label', where); }
      }
      if (v.type === 'dashboard') {
        for (const k of ['views', 'widgets', 'items', 'children', 'sections']) rename(v, k, 'blocks', where);
        if (Array.isArray(v.blocks)) v.blocks = v.blocks.map((b, j) => normView(b, `${where} › block ${j + 1}`));
      }
      if (v.type === 'sheet' && isObj(v.child)) { normSort(v.child, where); for (const k of ['linkColumn', 'via', 'parent', 'ref']) rename(v.child, k, 'link', where); }
      return v;
    };
    if (isObj(spec.views)) { spec.views = Object.entries(spec.views).map(([k, v]) => (isObj(v) ? { title: k, ...v } : v)); fixed('views', 'Changed views from an object to a list'); }
    if (Array.isArray(spec.views)) spec.views = spec.views.map((v, i) => normView(v, `view "${(isObj(v) && (v.title || v.name)) || '#' + (i + 1)}"`));

    if (Array.isArray(spec.seed)) {
      if (spec.seed.every(s => isObj(s) && typeof s.table === 'string' && Array.isArray(s.rows))) {
        spec.seed = Object.fromEntries(spec.seed.map(s => [s.table, s.rows]));
        fixed('seed', 'Changed seed to { "tableId": [rows] }');
      }
    }
    if (isObj(spec.seed) && isObj(spec.seed.tables)) { spec.seed = spec.seed.tables; fixed('seed', 'Used the tables inside seed'); }
    if (isObj(spec.migrations)) {
      spec.migrations = Object.entries(spec.migrations).map(([k, v]) => ({ to: +k, ...(Array.isArray(v) ? { steps: v } : isObj(v) ? v : {}) }));
      fixed('migrations', 'Changed migrations to a list of { "to", "steps" }');
    }
    if (Array.isArray(spec.migrations)) for (const m of spec.migrations) {
      if (!isObj(m)) continue;
      for (const k of ['version', 'toVersion', 'schemaVersion']) rename(m, k, 'to', 'migrations');
      if (Array.isArray(m.steps)) for (const s of m.steps) if (isObj(s)) for (const k of ['type', 'action', 'operation']) rename(s, k, 'op', 'migrations');
    }
    if (Array.isArray(spec.tests)) for (const t of spec.tests) {
      if (!isObj(t)) continue;
      if (!t.tables && isObj(t.data)) { t.tables = isObj(t.data.tables) ? t.data.tables : t.data; delete t.data; fixed(`test "${t.name}"`, 'Moved "data" to "tables"'); }
      for (const k of ['expected', 'expects', 'assertions', 'checks']) rename(t, k, 'expect', `test "${t.name}"`);
    }
    return { spec, notes };
  }

  function specCheck(spec) {
    const problems = [];
    const err = (where, message) => problems.push({ level: 'error', where, message });
    const warn = (where, message) => problems.push({ level: 'warning', where, message });
    const sch = { tables: {}, settings: {} };
    const keysOk = (o, allowed, where, hints = {}) => {
      for (const k of Object.keys(o)) {
        if (allowed.includes(k)) continue;
        const hint = hints[k] || KEY_HINTS[k];
        const best = closest(k, allowed);
        err(where, `Unknown property "${k}".${hint ? ' ' + hint : best ? ` Did you mean "${best}"?` : ` Allowed here: ${allowed.join(', ')}.`}`);
      }
    };
    const formula = (src, where, sc, label = 'a formula') => {
      if (typeof src !== 'string' || !src.trim()) { err(where, `Add ${label} as text in quotes.`); return null; }
      try { const ast = fxParse(src); return fxCheck(ast, { sch, ...sc }); }
      catch (e) { if (!(e instanceof FxError)) throw e; err(where, `${e.message.replace(/\.?$/, '.')} Formula: ${fxWhere(src, e)}.`); return null; }
    };
    try {
      if (!isObj(spec)) { err('definition', 'A tool definition is one JSON object.'); return { problems, sch }; }
      keysOk(spec, TOP_KEYS, 'definition', { app: 'Put the tool\'s properties at the top level of the definition.' });

      // Tool properties
      if (typeof spec.id !== 'string' || !spec.id) err('id', 'Add an "id": lower case words joined by hyphens, for example "snagging-tracker". Never change it once the tool is in use.');
      else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.id)) err('id', `"${spec.id}" is not a valid id. Use lower case letters and numbers joined by hyphens, for example "${toKebab(spec.id)}".`);
      if (typeof spec.name !== 'string' || !spec.name.trim()) err('name', 'Add a "name": the tool\'s title, for example "Snagging tracker".');
      if (spec.version == null) err('version', 'Add "version": "1.0.0". Increase it every time the tool changes.');
      else if (typeof spec.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(spec.version)) err('version', `"version" must look like "1.0.0", not "${spec.version}".`);
      if (!Number.isInteger(spec.schemaVersion) || spec.schemaVersion < 1) err('schemaVersion', 'Add "schemaVersion": 1. Increase it by 1 only when stored data changes shape, and add a migration.');
      for (const k of ['description', 'locale', 'fileName']) if (spec[k] != null && typeof spec[k] !== 'string') err(k, `"${k}" must be text.`);
      if (spec.currency != null && !/^[A-Z]{3}$/.test(spec.currency)) err('currency', 'Use a three-letter currency code, for example "GBP".');
      for (const k of ['home', 'versionUrl']) if (spec[k] != null && (typeof spec[k] !== 'string' || /\s/.test(spec[k]))) err(k, `"${k}" must be a web address, or null.`);
      if (spec.identity != null && spec.identity !== 'azure-swa') err('identity', 'Use "azure-swa" or leave "identity" out.');
      if (spec.saveInPlace != null && typeof spec.saveInPlace !== 'boolean') err('saveInPlace', 'Use true or false.');
      if (spec.properties != null && spec.properties !== false) {
        if (!isObj(spec.properties)) err('properties', 'Use false, or { "required": ["projectNumber", "projectName"], "firstRevision": "P01" }.');
        else {
          keysOk(spec.properties, ['required', 'firstRevision'], 'properties');
          if (spec.properties.required != null && !(Array.isArray(spec.properties.required) && spec.properties.required.every(x => ['projectNumber', 'projectName'].includes(x)))) err('properties', '"required" can list "projectNumber" and "projectName".');
        }
      }

      // Columns (shared by tables and settings)
      const refChecks = [];
      const checkColumn = (c, where, kind) => {
        if (!isObj(c)) { err(where, 'Each column is an object such as { "id": "title", "label": "Title", "type": "text" }.'); return false; }
        if (typeof c.id !== 'string' || !c.id) { err(where, 'Add an "id": the column\'s key in the saved data, for example "title".'); return false; }
        let ok = true;
        if (c.id === 'id') { err(where, 'Every row already has an "id". Remove this column, or rename it, for example "reference".'); ok = false; }
        else if (!ID_RE.test(c.id)) { err(where, `Column id "${c.id}" can only use letters, numbers and _, starting with a letter. Try "${toCamel(c.id)}".`); ok = false; }
        else if (FX_RESERVED.includes(c.id.toLowerCase())) { err(where, `"${c.id}" is a reserved word in formulas. Choose another id, for example "${c.id}Value".`); ok = false; }
        if (!COLUMN_TYPES.includes(c.type)) {
          err(where, c.type == null ? `Add a "type": one of ${COLUMN_TYPES.join(', ')}.` : `Unknown type "${c.type}". Use one of ${COLUMN_TYPES.join(', ')}.`);
          return false;
        }
        if (kind === 'settings' && (c.type === 'ref' || c.type === 'computed')) err(where, 'Settings cannot be links or calculated. Use text, number, currency, percent, date, choice or boolean.');
        const allowed = COL_COMMON.concat(COL_BY_TYPE[c.type]);
        for (const k of Object.keys(c)) {
          if (allowed.includes(k)) continue;
          if (ALL_COL_KEYS.includes(k)) warn(where, `"${k}" does not apply to a ${c.type} column, so it is ignored.`);
          else { const hint = KEY_HINTS[k], best = closest(k, allowed); err(where, `Unknown property "${k}".${hint ? ' ' + hint : best ? ` Did you mean "${best}"?` : ''}`); }
        }
        for (const k of ['label', 'help']) if (c[k] != null && typeof c[k] !== 'string') err(where, `"${k}" must be text.`);
        for (const k of ['required', 'unique', 'hidden', 'hideInForm', 'mono']) if (c[k] != null && typeof c[k] !== 'boolean') err(where, `"${k}" must be true or false, without quotes.`);
        for (const k of ['min', 'max', 'step']) if (c[k] != null && typeof c[k] !== 'number') err(where, `"${k}" must be a number, without quotes.`);
        if (c.decimals != null && !(Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= 10)) err(where, '"decimals" must be a whole number from 0 to 10.');
        if (c.type === 'choice') {
          if (!Array.isArray(c.options) || !c.options.length) err(where, 'Add "options": the list of choices, for example ["Open", "Closed"].');
          else {
            if (!c.options.every(o => typeof o === 'string' && o.trim())) err(where, 'Each option must be text in quotes.');
            const dup = c.options.find((o, i) => c.options.indexOf(o) !== i);
            if (dup != null) err(where, `The option "${dup}" is listed twice.`);
          }
        }
        if (c.colors != null) {
          if (!isObj(c.colors)) err(where, '"colors" maps values to colours, for example { "Open": "blue", "Closed": "green" }.');
          else for (const [k, v] of Object.entries(c.colors)) {
            if (!PILL_COLOURS.includes(v)) err(where, `"${v}" is not a colour. Use one of ${PILL_COLOURS.join(', ')}.`);
            if (c.type === 'choice' && Array.isArray(c.options) && !c.options.includes(k)) warn(where, `"colors" has "${k}", which is not one of the options.`);
          }
        }
        if (c.type === 'computed') {
          if (c.formula == null) err(where, 'Add a "formula", for example "quantity * rate".');
          if (c.format != null && !FORMATS.includes(c.format)) err(where, `Unknown format "${c.format}". Use one of ${FORMATS.join(', ')}.`);
          if (c.required || c.unique || c.default !== undefined || c.defaultFormula) warn(where, 'Calculated columns are never typed in, so required, unique and default are ignored.');
        }
        if (c.type === 'ref') refChecks.push([c, where]);
        if (c.default !== undefined && c.default !== null && c.type !== 'computed') {
          const d = c.default;
          const bad = NUMERIC.includes(c.type) ? typeof d !== 'number'
            : c.type === 'date' ? !isIsoDate(d)
            : c.type === 'boolean' ? typeof d !== 'boolean'
            : c.type === 'choice' ? !(Array.isArray(c.options) && c.options.includes(d))
            : typeof d !== 'string';
          if (bad) {
            if (typeof d === 'string' && /\(\s*\)|^[A-Z]+\(/.test(d)) err(where, `Use "defaultFormula" for a calculated default, for example "defaultFormula": "${d}".`);
            else err(where, c.type === 'choice' ? `The default "${d}" is not one of the options.` : c.type === 'date' ? 'A date default must be written "YYYY-MM-DD". For today\'s date use "defaultFormula": "TODAY()".' : `The default does not suit a ${c.type} column.`);
          }
        }
        return ok;
      };

      // Settings
      if (spec.settings != null) {
        if (!Array.isArray(spec.settings)) err('settings', 'Make "settings" a list of fields, written like table columns.');
        else {
          const seen = new Set();
          spec.settings.forEach((c, i) => {
            const where = `setting "${(isObj(c) && c.id) || '#' + (i + 1)}"`;
            if (!checkColumn(c, where, 'settings')) return;
            if (seen.has(c.id)) err(where, `The setting "${c.id}" is defined twice.`);
            seen.add(c.id);
            sch.settings[c.id] = { ...c };
          });
        }
      }

      // Tables and columns
      if (!Array.isArray(spec.tables) || !spec.tables.length) err('tables', 'Add "tables": a list with at least one table, each with "id", "label", "singular" and "columns".');
      const tables = Array.isArray(spec.tables) ? spec.tables.filter(isObj) : [];
      tables.forEach((t, i) => {
        const where = `table "${t.id || '#' + (i + 1)}"`;
        keysOk(t, TABLE_KEYS, where, { rules: 'Use "checks" for validation, or "onSave" for values set automatically.' });
        if (typeof t.id !== 'string' || !t.id) { err(where, 'Add an "id" for this table, for example "comments".'); return; }
        let tid = t.id;
        if (!ID_RE.test(t.id)) {
          // Keep checking under the suggested id, so one round reports as much as possible.
          tid = toCamel(t.id);
          err(where, `Table id "${t.id}" can only use letters, numbers and _, starting with a letter. Use "${tid}" here and everywhere this table is named.`);
        } else if (FX_RESERVED.includes(t.id.toLowerCase())) { err(where, `"${t.id}" is a reserved word. Choose another table id.`); return; }
        if (sch.tables[tid]) { err(where, `The table "${tid}" is defined twice.`); return; }
        if (!t.singular) warn(where, `Add "singular", the name for one row, for example "${String(t.label || t.id).replace(/s$/i, '').toLowerCase()}". Buttons use it, such as "Add ${String(t.label || t.id).replace(/s$/i, '').toLowerCase()}".`);
        const td = sch.tables[tid] = { cols: {}, label: t.label || tid, id: tid };
        if (!Array.isArray(t.columns) || !t.columns.length) { err(where, 'Add "columns": a list with at least one column.'); return; }
        const lower = new Set();
        t.columns.forEach((c, j) => {
          const cw = `${where} › column "${(isObj(c) && c.id) || '#' + (j + 1)}"`;
          if (!checkColumn(c, cw, 'table')) return;
          if (lower.has(c.id.toLowerCase())) { err(cw, `The column "${c.id}" is defined twice in this table.`); return; }
          lower.add(c.id.toLowerCase());
          td.cols[c.id] = { ...c };
        });
      });
      for (const [c, where] of refChecks) {
        if (!sch.tables[c.table]) err(where, c.table ? unknownMsg(`table "${c.table}"`, c.table, Object.keys(sch.tables), 'A link column\'s "table" is the id of the table it points to.') : 'Add "table": the id of the table this column links to.');
        else if (c.display != null && !sch.tables[c.table].cols[c.display]) err(where, unknownMsg(`display column "${c.display}" in table "${c.table}"`, c.display, Object.keys(sch.tables[c.table].cols)));
      }

      // Formulas: infer the types of calculated columns first, then check them properly.
      const tid = t => (typeof t.id === 'string' ? (ID_RE.test(t.id) ? t.id : toCamel(t.id)) : null);
      const computed = [];
      for (const t of tables) if (sch.tables[tid(t)]) for (const c of Object.values(sch.tables[tid(t)].cols)) if (c.type === 'computed' && typeof c.formula === 'string') computed.push([tid(t), c]);
      for (let pass = 0; pass < 3; pass++) for (const [tk, c] of computed) {
        try { c._type = fxCheck(fxParse(c.formula), { sch, table: tk, thisTable: tk }).type; } catch { /* reported below */ }
      }
      const deps = {};
      for (const [tk, c] of computed) {
        const d = new Set();
        formula(c.formula, `table "${tk}" › column "${c.id}" › formula`, { table: tk, thisTable: tk, deps: d });
        deps[`${tk}.${c.id}`] = [...d].filter(k => sch.tables[tk].cols[k]?.type === 'computed').map(k => `${tk}.${k}`);
      }
      const state = {};
      const visit = (node, trail) => {
        if (state[node] === 2) return;
        if (state[node] === 1) {
          const loop = trail.slice(trail.indexOf(node)).concat(node).map(x => x.split('.')[1]);
          err(`table "${node.split('.')[0]}" › column "${node.split('.')[1]}" › formula`, `Circular calculation: ${loop.map((x, k) => (k === 0 ? `"${x}"` : `uses "${x}"`)).join(', which ')}. A column cannot depend on itself.`);
          state[node] = 2;
          return;
        }
        state[node] = 1;
        for (const n of deps[node] || []) visit(n, trail.concat(node));
        state[node] = 2;
      };
      Object.keys(deps).forEach(k => visit(k, []));

      for (const t of tables) {
        const td = sch.tables[tid(t)];
        if (!td) continue;
        const where = `table "${t.id}"`;
        const rowSc = { table: td.id, thisTable: td.id };
        for (const c of Object.values(td.cols)) {
          if (c.defaultFormula != null) formula(c.defaultFormula, `${where} › column "${c.id}" › defaultFormula`, {}, 'a default formula');
          if (c.colorFormula != null) formula(c.colorFormula, `${where} › column "${c.id}" › colorFormula`, rowSc);
        }
        if (t.display != null) {
          if (typeof t.display !== 'string' || !td.cols[t.display]) err(where, typeof t.display === 'string' && /[\s&(+'"]/.test(t.display) ? `"display" names one column. For a formula use "displayFormula": "${t.display}".` : unknownMsg(`display column "${t.display}"`, String(t.display), Object.keys(td.cols)));
        }
        if (t.displayFormula != null) formula(t.displayFormula, `${where} › displayFormula`, rowSc);
        if (t.checks != null) {
          if (!Array.isArray(t.checks)) err(where, '"checks" must be a list of { "errorIf", "message", "field" }.');
          else t.checks.forEach((ch, j) => {
            const cw = `${where} › check ${j + 1}`;
            if (!isObj(ch)) { err(cw, 'Each check is { "errorIf": "formula", "message": "What to do", "field": "column" }.'); return; }
            keysOk(ch, ['errorIf', 'message', 'field'], cw, { when: 'Use "errorIf": a formula that is true when the row is wrong.', if: 'Use "errorIf".', condition: 'Use "errorIf".', rule: 'Use "errorIf".' });
            formula(ch.errorIf, `${cw} › errorIf`, rowSc, 'an "errorIf" formula');
            if (typeof ch.message !== 'string' || !ch.message.trim()) err(cw, 'Add a "message" that says what to do, for example "Add the response before marking it responded."');
            if (ch.field != null && (!td.cols[ch.field] || td.cols[ch.field].type === 'computed')) err(cw, unknownMsg(`field "${ch.field}"`, String(ch.field), Object.keys(td.cols).filter(k => td.cols[k].type !== 'computed')));
          });
        }
        if (t.onSave != null) {
          if (!Array.isArray(t.onSave)) err(where, '"onSave" must be a list of { "when", "field", "value" or "formula" }.');
          else t.onSave.forEach((r, j) => {
            const rw = `${where} › onSave ${j + 1}`;
            if (!isObj(r)) { err(rw, 'Each onSave rule is { "when": "formula", "field": "column", "value": ... } or with "formula" instead of "value".'); return; }
            keysOk(r, ['when', 'field', 'value', 'formula'], rw, { set: 'Use "field" for the column to set, and "value" or "formula".', if: 'Use "when".', condition: 'Use "when".' });
            if (!td.cols[r.field] || td.cols[r.field].type === 'computed') err(rw, r.field == null ? 'Add "field": the column this rule sets.' : unknownMsg(`field "${r.field}"`, String(r.field), Object.keys(td.cols).filter(k => td.cols[k].type !== 'computed')));
            if (('value' in r) === ('formula' in r)) err(rw, 'Give either "value" (a fixed value) or "formula" (calculated), not both.');
            if (r.when != null) formula(r.when, `${rw} › when`, { ...rowSc, before: true });
            if ('formula' in r) formula(r.formula, `${rw} › formula`, { ...rowSc, before: true });
          });
        }
      }
      for (const [k, c] of Object.entries(sch.settings)) if (c.defaultFormula != null) formula(c.defaultFormula, `setting "${k}" › defaultFormula`, {}, 'a default formula');

      // Views
      const isNum = info => ['number', 'any'].includes(info.type);
      const checkView = (v, where, inDashboard) => {
        if (!isObj(v)) { err(where, 'Each view is an object with a "type", such as { "type": "table", "title": "Items", "table": "items" }.'); return; }
        const type = v.type;
        if (!VIEW_KEYS[type]) {
          if (S.viewTypes[type]) return; // a plugin's view: free-form
          err(where, type == null ? 'Add a "type": table, summary, kpi, dashboard, settings, sheet or matrix.'
            : type === 'custom' ? 'Custom views need JavaScript, which a tool definition cannot hold. Use a table, summary, kpi, dashboard, sheet or matrix view.'
            : `Unknown view type "${type}". Use table, summary, kpi, dashboard, settings, sheet or matrix.`);
          return;
        }
        keysOk(v, ['type', 'title', 'wide', ...VIEW_KEYS[type]], where);
        if (!inDashboard && !v.title && !['table', 'summary'].includes(type)) warn(where, 'Add a "title": it is the name on the view\'s tab.');
        let td = null;
        if (['table', 'summary', 'sheet', 'matrix'].includes(type)) {
          if (sch.tables[v.table]) td = sch.tables[v.table];
          else err(where, v.table == null ? 'Add "table": the id of the table this view shows.' : unknownMsg(`table "${v.table}"`, String(v.table), Object.keys(sch.tables)));
        }
        const colOk = (key, what, t = td, tk = v.table, numeric = null) => {
          if (!t) return false;
          if (typeof key !== 'string' || !t.cols[key]) { err(where, key == null ? `Add ${what}.` : unknownMsg(`${what} "${key}" in table "${tk}"`, String(key), Object.keys(t.cols))); return false; }
          if (numeric && !isNum(colInfo(t.cols[key]))) { err(where, `"${key}" is not a number column, so it cannot be ${numeric}.`); return false; }
          return true;
        };
        const listOk = (list, what, numeric) => {
          if (list == null) return;
          if (!Array.isArray(list)) { err(where, `"${what}" must be a list of column ids.`); return; }
          list.forEach(k => colOk(k, what === 'totals' ? 'totals column' : what === 'filters' ? 'filter column' : 'column', td, v.table, numeric));
        };
        const sortOk = (s, t, tk) => {
          if (s == null) return;
          if (!isObj(s)) { err(where, '"sort" is { "column": "id", "dir": "asc" or "desc" }.'); return; }
          keysOk(s, ['column', 'dir'], `${where} › sort`);
          colOk(s.column, 'sort column', t, tk);
          if (s.dir != null && !['asc', 'desc'].includes(s.dir)) err(where, 'Sort "dir" must be "asc" or "desc".');
        };
        const metricsOk = (list, allowWhere) => {
          if (list == null) return;
          if (!Array.isArray(list) || !list.length) { err(where, '"metrics" is a list such as [ { "label": "Count", "op": "count" } ].'); return; }
          list.forEach((m, j) => {
            const mw = `${where} › metric ${j + 1}`;
            if (!isObj(m)) { err(mw, 'Each metric is { "label", "op", "column" }.'); return; }
            keysOk(m, ['label', 'op', 'column', 'format', ...(allowWhere ? ['where'] : [])], mw);
            const op = m.op || 'count';
            if (!['count', 'sum', 'avg', 'min', 'max'].includes(op)) err(mw, `Unknown op "${m.op}". Use count, sum, avg, min or max.`);
            else if (op !== 'count') colOk(m.column, `a "column" for ${op}`, td, v.table, op === 'sum' || op === 'avg' ? `added up (${op})` : null);
            if (m.format != null && !FORMATS.includes(m.format)) err(mw, `Unknown format "${m.format}".`);
            if (allowWhere && m.where != null && td) formula(m.where, `${mw} › where`, { table: v.table, thisTable: v.table });
          });
        };
        if (v.where != null && td) formula(v.where, `${where} › where`, { table: v.table, thisTable: v.table });
        switch (type) {
          case 'table':
            listOk(v.columns, 'columns');
            listOk(v.totals, 'totals', 'totalled');
            listOk(v.filters, 'filters');
            sortOk(v.sort, td, v.table);
            if (v.preset != null) { if (!isObj(v.preset)) err(where, '"preset" is an object of column values for new rows.'); else Object.keys(v.preset).forEach(k => colOk(k, 'preset column')); }
            for (const k of ['add', 'readOnly', 'search']) if (v[k] != null && typeof v[k] !== 'boolean') err(where, `"${k}" must be true or false.`);
            break;
          case 'summary':
            if (colOk(v.groupBy, '"groupBy" (the column to group by)') && v.bucket != null) {
              const info = colInfo(td.cols[v.groupBy]);
              if (!['month', 'year'].includes(v.bucket)) err(where, '"bucket" must be "month" or "year".');
              else if (info.type !== 'date') err(where, '"bucket" only works when grouping by a date column.');
            }
            metricsOk(v.metrics, false);
            if (v.chart != null && v.chart !== false && !(Number.isInteger(v.chart) && v.chart >= 0 && v.chart < (Array.isArray(v.metrics) ? v.metrics.length : 1))) err(where, '"chart" is false, or the position of the metric to chart (0 for the first).');
            if (v.sortBy != null && v.sortBy !== 'label') err(where, '"sortBy" can only be "label".');
            break;
          case 'kpi':
            if (!Array.isArray(v.items) || !v.items.length) { err(where, 'Add "items": a list such as [ { "label": "Open", "formula": "COUNT(items WHERE status = \'Open\')", "format": "integer" } ].'); break; }
            v.items.forEach((it, j) => {
              const iw = `${where} › item ${j + 1}`;
              if (!isObj(it)) { err(iw, 'Each item is { "label", "formula", "format" }.'); return; }
              keysOk(it, ['label', 'formula', 'format', 'decimals'], iw);
              if (typeof it.label !== 'string' || !it.label) err(iw, 'Add a "label".');
              formula(it.formula, `${iw} › formula`, {});
              if (it.format != null && !FORMATS.includes(it.format)) err(iw, `Unknown format "${it.format}". Use one of ${FORMATS.join(', ')}.`);
            });
            break;
          case 'dashboard':
            if (inDashboard) { err(where, 'A dashboard cannot contain another dashboard.'); break; }
            if (!Array.isArray(v.blocks) || !v.blocks.length) { err(where, 'Add "blocks": a list of kpi, summary, table, sheet or matrix views.'); break; }
            v.blocks.forEach((b, j) => checkView(b, `${where} › block ${j + 1}${isObj(b) && b.title ? ` "${b.title}"` : ''}`, true));
            break;
          case 'settings':
            if (!Object.keys(sch.settings).length) err(where, 'This view shows settings, but the tool has none. Add a "settings" list or remove this view.');
            if (v.fields != null) { if (!Array.isArray(v.fields)) err(where, '"fields" must be a list of setting ids.'); else v.fields.forEach(k => { if (!sch.settings[k]) err(where, unknownMsg(`setting "${k}"`, String(k), Object.keys(sch.settings))); }); }
            break;
          case 'sheet': {
            listOk(v.fields, 'fields');
            sortOk(v.sort, td, v.table);
            if (v.child == null) break;
            const cw = `${where} › child`;
            if (!isObj(v.child)) { err(cw, '"child" is { "table", "link", "columns" }: the rows listed under each record.'); break; }
            keysOk(v.child, ['table', 'link', 'columns', 'sort', 'where'], cw);
            const ct = sch.tables[v.child.table];
            if (!ct) { err(cw, v.child.table == null ? 'Add "table": the table of rows to list.' : unknownMsg(`table "${v.child.table}"`, String(v.child.table), Object.keys(sch.tables))); break; }
            const links = Object.values(ct.cols).filter(c => c.type === 'ref' && c.table === v.table).map(c => c.id);
            if (!ct.cols[v.child.link] || ct.cols[v.child.link].type !== 'ref' || ct.cols[v.child.link].table !== v.table) {
              err(cw, links.length ? `"link" must be the column in "${v.child.table}" that links to "${v.table}": ${links.map(x => `"${x}"`).join(' or ')}.` : `"${v.child.table}" has no link column pointing to "${v.table}". Add a ref column to it first.`);
            }
            if (v.child.columns != null) { if (!Array.isArray(v.child.columns)) err(cw, '"columns" must be a list of column ids.'); else v.child.columns.forEach(k => colOk(k, 'column', ct, v.child.table)); }
            sortOk(v.child.sort, ct, v.child.table);
            if (v.child.where != null) formula(v.child.where, `${cw} › where`, { table: v.child.table, thisTable: v.child.table });
            break;
          }
          case 'matrix':
            if (!td) break;
            for (const k of ['rows', 'columns']) formula(v[k], `${where} › ${k}`, { table: v.table, thisTable: v.table }, `"${k}": a column (or formula) whose values label the ${k}`);
            metricsOk(v.metrics, true);
            break;
        }
      };
      if (spec.views != null && !Array.isArray(spec.views)) err('views', 'Make "views" a list.');
      (Array.isArray(spec.views) ? spec.views : []).forEach((v, i) => checkView(v, `view ${i + 1}${isObj(v) && v.title ? ` "${v.title}"` : ''}`, false));

      // Rows: seed rows and test data
      const valueOk = (col, v, where, k, ids) => {
        if (v === null || v === '') return;
        switch (col.type) {
          case 'number': case 'currency': case 'percent':
            if (typeof v !== 'number') err(where, `"${k}" must be a number without quotes or units, for example 12.5.`); break;
          case 'date': if (!isIsoDate(v)) err(where, `"${k}" must be a date written "YYYY-MM-DD", for example "2026-09-01".`); break;
          case 'boolean': if (typeof v !== 'boolean') err(where, `"${k}" must be true or false, without quotes.`); break;
          case 'choice': if (!Array.isArray(col.options) || !col.options.includes(v)) err(where, `"${v}" is not one of the options for "${k}"${Array.isArray(col.options) ? `: ${col.options.join(', ')}` : ''}.`); break;
          case 'ref':
            if (typeof v !== 'string') err(where, `"${k}" links to another row, so it holds that row's "id" in quotes.`);
            else if (ids && !(ids[col.table] && ids[col.table].has(v))) err(where, `"${k}" links to "${v}", but no "${col.table}" row has that id. Give the ${col.table} row "id": "${v}", or correct the link.`);
            break;
          default: if (typeof v !== 'string') err(where, `"${k}" must be text in quotes.`);
        }
      };
      const checkRows = (tablesData, where, strict) => {
        const ids = {};
        for (const [tk, rows] of Object.entries(tablesData)) ids[tk] = new Set((Array.isArray(rows) ? rows : []).map(r => isObj(r) && typeof r.id === 'string' ? r.id : null).filter(Boolean));
        for (const [tk, rows] of Object.entries(tablesData)) {
          const tw = `${where} › ${tk}`;
          const td = sch.tables[tk];
          if (!td) { err(tw, unknownMsg(`table "${tk}"`, tk, Object.keys(sch.tables))); continue; }
          if (!Array.isArray(rows)) { err(tw, 'List the rows inside [ ].'); continue; }
          const seen = new Set();
          rows.forEach((r, i) => {
            const rw = `${tw} › row ${i + 1}`;
            if (!isObj(r)) { err(rw, 'Each row is an object of column values.'); return; }
            if ('id' in r) {
              if (typeof r.id !== 'string' || !r.id) err(rw, 'A row "id" must be text in quotes.');
              else if (seen.has(r.id)) err(rw, `The id "${r.id}" is used twice.`);
              seen.add(r.id);
            }
            for (const [k, v] of Object.entries(r)) {
              if (k === 'id') continue;
              const col = td.cols[k];
              if (!col) { err(rw, unknownMsg(`column "${k}"`, k, Object.keys(td.cols))); continue; }
              if (col.type === 'computed') { err(rw, `"${k}" is calculated, so leave it out of the row.`); continue; }
              valueOk(col, v, rw, k, ids);
            }
            if (strict) for (const col of Object.values(td.cols)) {
              if (col.required && col.type !== 'computed' && fxBlank(r[col.id]) && col.default == null && !col.defaultFormula) err(rw, `Give "${col.id}" a value: it is required.`);
            }
          });
        }
      };
      if (spec.seed != null) {
        if (!isObj(spec.seed)) err('seed', 'Make "seed" an object of table ids and their starting rows, for example { "disciplines": [ { "code": "AR", "name": "Architecture" } ] }.');
        else checkRows(spec.seed, 'seed', true);
      }

      // Migrations
      const sv = Number.isInteger(spec.schemaVersion) ? spec.schemaVersion : 1;
      const got = new Set();
      if (spec.migrations != null && !Array.isArray(spec.migrations)) err('migrations', 'Make "migrations" a list, for example [ { "to": 2, "steps": [ ... ] } ].');
      (Array.isArray(spec.migrations) ? spec.migrations : []).forEach((m, i) => {
        const where = `migration ${isObj(m) && m.to != null ? 'to ' + m.to : '#' + (i + 1)}`;
        if (!isObj(m)) { err(where, 'Each migration is { "to": 2, "steps": [ ... ] }.'); return; }
        keysOk(m, ['to', 'steps', 'description'], where);
        if (!Number.isInteger(m.to) || m.to < 2 || m.to > sv) err(where, `"to" must be a schema version from 2 to ${sv} (the current schemaVersion).`);
        else if (got.has(m.to)) err(where, `There are two migrations to ${m.to}.`);
        else got.add(m.to);
        if (!Array.isArray(m.steps)) { err(where, 'Add "steps": a list of changes, or [] if none are needed.'); return; }
        m.steps.forEach((s, j) => {
          const sw = `${where} › step ${j + 1}`;
          if (!isObj(s)) { err(sw, 'Each step is an object with an "op".'); return; }
          const op = STEP_OPS[s.op];
          if (!op) { err(sw, s.op == null ? `Add "op": one of ${Object.keys(STEP_OPS).join(', ')}.` : unknownMsg(`op "${s.op}"`, String(s.op), Object.keys(STEP_OPS))); return; }
          keysOk(s, ['op', 'description', ...op[0], ...op[1]], sw);
          for (const k of op[0]) if (k !== 'map' && (typeof s[k] !== 'string' || !s[k])) err(sw, `Add "${k}".`);
          if (s.op === 'mapValues' && !isObj(s.map)) err(sw, '"map" is an object of old value to new value, for example { "Yes": "Approved" }.');
          if (s.op === 'setField') {
            if (('value' in s) === ('formula' in s)) err(sw, 'Give either "value" or "formula", not both.');
            if ('formula' in s) formula(s.formula, `${sw} › formula`, { raw: true });
          }
          if (s.when != null) formula(s.when, `${sw} › when`, { raw: true });
        });
      });
      for (let v = 2; v <= sv; v++) if (!got.has(v)) err('migrations', `schemaVersion is ${sv}, so add a migration with "to": ${v} that upgrades files saved at schema ${v - 1}. Use "steps": [] if nothing needs changing.`);

      // Tests
      if (spec.tests != null && !Array.isArray(spec.tests)) err('tests', 'Make "tests" a list.');
      const tests = Array.isArray(spec.tests) ? spec.tests : [];
      tests.forEach((t, i) => {
        const where = `test "${(isObj(t) && t.name) || '#' + (i + 1)}"`;
        if (!isObj(t)) { err(where, 'Each test is { "name", "tables", "expect" }.'); return; }
        keysOk(t, ['name', 'schemaVersion', 'settings', 'tables', 'expect'], where);
        if (typeof t.name !== 'string' || !t.name) err(where, 'Add a "name".');
        const tv = t.schemaVersion == null ? sv : t.schemaVersion;
        if (!Number.isInteger(tv) || tv < 1 || tv > sv) err(where, `"schemaVersion" must be from 1 to ${sv}.`);
        if (!isObj(t.tables)) { err(where, 'Add "tables": the rows to test with, as { "tableId": [ { ... } ] }.'); return; }
        if (tv === sv) checkRows(t.tables, where, false);
        if (t.settings != null && !isObj(t.settings)) err(where, '"settings" is an object of setting values.');
        if (!Array.isArray(t.expect) || !t.expect.length) { err(where, 'Add "expect": a list of results, such as { "table": "items", "row": "i1", "field": "total", "equals": 25 }.'); return; }
        t.expect.forEach((e, j) => {
          const ew = `${where} › expect ${j + 1}`;
          if (!isObj(e)) { err(ew, 'Each expectation is an object.'); return; }
          if ('formula' in e) { keysOk(e, ['formula'], ew); formula(e.formula, ew, {}); return; }
          if ('rows' in e) {
            keysOk(e, ['table', 'rows'], ew);
            if (!sch.tables[e.table]) err(ew, unknownMsg(`table "${e.table}"`, String(e.table), Object.keys(sch.tables)));
            if (!Number.isInteger(e.rows)) err(ew, '"rows" is the number of rows expected.');
            return;
          }
          keysOk(e, ['table', 'row', 'field', 'equals', 'tolerance'], ew, { value: 'Use "equals".', expected: 'Use "equals".', column: 'Use "field".' });
          const td = sch.tables[e.table];
          if (!td) { err(ew, e.table == null ? 'Use { "table", "row", "field", "equals" }, { "table", "rows" } or { "formula" }.' : unknownMsg(`table "${e.table}"`, String(e.table), Object.keys(sch.tables))); return; }
          if (!td.cols[e.field]) err(ew, unknownMsg(`field "${e.field}" in table "${e.table}"`, String(e.field), Object.keys(td.cols)));
          if (!('equals' in e)) err(ew, 'Add "equals": the value expected.');
          if (tv === sv && !(Array.isArray(t.tables[e.table]) && t.tables[e.table].some(r => isObj(r) && r.id === e.row))) err(ew, `No "${e.table}" row in this test has "id": "${e.row}". Give the row an id and use it here.`);
        });
      });
      if (!tests.length && computed.length) warn('tests', 'Add a test: a few rows and the results you expect, so the self-test proves the calculations.');
    } catch (e) {
      console.error(e);
      err('definition', `Checking stopped unexpectedly (${e.message}). Fix the problems above, then check again.`);
    }
    return { problems, sch };
  }

  // Changes that would strand data in files saved by the previous version of the tool.
  function specCompare(prev, spec) {
    const out = [];
    const warn = (where, message) => out.push({ level: 'warning', where, message });
    if (!isObj(prev) || !isObj(spec)) return out;
    if (prev.id && spec.id !== prev.id) warn('id', `The id changed from "${prev.id}" to "${spec.id}", so files saved by the current tool will not open in this one. Keep "${prev.id}" if this is the same tool.`);
    if (JSON.stringify(prev) !== JSON.stringify(spec) && typeof spec.version === 'string' && typeof prev.version === 'string' && cmpSemver(spec.version, prev.version) <= 0) {
      const [a, b] = prev.version.split('.').map(Number);
      warn('version', `Increase "version" (it is still ${prev.version}), for example to "${a}.${(b || 0) + 1}.0".`);
    }
    if (Number.isInteger(spec.schemaVersion) && spec.schemaVersion < prev.schemaVersion) {
      out.push({ level: 'error', where: 'schemaVersion', message: `schemaVersion went down from ${prev.schemaVersion} to ${spec.schemaVersion}. It must never decrease.` });
    }
    if (spec.schemaVersion !== prev.schemaVersion || !Array.isArray(prev.tables) || !Array.isArray(spec.tables)) return out;
    for (const pt of prev.tables) {
      if (!isObj(pt)) continue;
      const nt = spec.tables.find(t => isObj(t) && t.id === pt.id);
      if (!nt) { warn(`table "${pt.id}"`, 'This table was removed or renamed. Saved files keep its rows, but the tool will not show them. If it was renamed, increase schemaVersion and add a migration with a renameTable step.'); continue; }
      for (const pc of pt.columns || []) {
        if (!isObj(pc) || pc.type === 'computed') continue;
        const nc = (nt.columns || []).find(c => isObj(c) && c.id === pc.id);
        if (!nc) warn(`table "${pt.id}" › column "${pc.id}"`, 'This column was removed or renamed. Saved values stay in files but are not shown. If it was renamed, increase schemaVersion and add a migration with a renameField step.');
        else if (nc.type !== pc.type && !(NUMERIC.includes(nc.type) && NUMERIC.includes(pc.type)) && !(['text', 'longtext', 'choice'].includes(nc.type) && ['text', 'longtext', 'choice'].includes(pc.type))) {
          warn(`table "${pt.id}" › column "${pc.id}"`, `This column changed from ${pc.type} to ${nc.type}. Saved values may not fit. Increase schemaVersion and add a migration that converts them.`);
        }
      }
    }
    return out;
  }

  function specCompile(spec, sch) {
    const def = { fromSpec: true };
    for (const k of ['id', 'name', 'description', 'version', 'schemaVersion', 'locale', 'currency', 'home', 'versionUrl', 'identity', 'fileName', 'saveInPlace', 'properties']) {
      if (spec[k] !== undefined) def[k] = spec[k];
    }
    const fx = (src, sc) => fxCompile(src, { sch, ...sc });
    const rowCx = (table, row, extra) => ({ table, row, thisTable: table, thisRow: row, ...extra });
    const fmtOf = t => ({ number: 'number', date: 'date', boolean: 'boolean', text: 'text' }[t]);
    const colOut = (c, tk) => {
      const { id, formula, defaultFormula, colorFormula, ...out } = c;
      if (c.type === 'computed') {
        const ast = fx(formula, { table: tk, thisTable: tk });
        out.fn = row => fxEval(ast, rowCx(tk, row));
        if (!out.format) { const f = fmtOf(sch.tables[tk].cols[id]._type); if (f) out.format = f; }
        if (colorFormula) {
          const cast = fx(colorFormula, { table: tk, thisTable: tk });
          out.colors = (v, row) => { const x = fxEval(cast, rowCx(tk, row)); return typeof x === 'string' && x ? x : null; };
        }
      }
      if (defaultFormula) { const dast = fx(defaultFormula, {}); out.default = () => fxEval(dast, {}); }
      return out;
    };
    def.tables = {};
    for (const t of spec.tables) {
      const tk = t.id;
      const td = { columns: {} };
      for (const k of ['label', 'singular', 'readOnly', 'display']) if (t[k] !== undefined) td[k] = t[k];
      for (const c of t.columns) td.columns[c.id] = colOut(c, tk);
      if (t.displayFormula) {
        const ast = fx(t.displayFormula, { table: tk, thisTable: tk });
        td.display = row => fxStr(fxEval(ast, rowCx(tk, row)));
      }
      if (Array.isArray(t.checks) && t.checks.length) {
        const checks = t.checks.map(ch => ({ ...ch, ast: fx(ch.errorIf, { table: tk, thisTable: tk }) }));
        td.validate = row => {
          const errs = {};
          for (const ch of checks) {
            let bad = false;
            try { bad = fxTruthy(fxEval(ch.ast, rowCx(tk, row))); } catch (e) { console.warn('[carryall] check failed', e); }
            const k = ch.field || '_form';
            if (bad && !errs[k]) errs[k] = ch.message;
          }
          return errs;
        };
      }
      if (Array.isArray(t.onSave) && t.onSave.length) {
        const rules = t.onSave.map(r => ({
          field: r.field, value: r.value,
          when: r.when ? fx(r.when, { table: tk, thisTable: tk, before: true }) : null,
          formula: 'formula' in r ? fx(r.formula, { table: tk, thisTable: tk, before: true }) : null,
        }));
        td.onSave = (row, before) => {
          for (const r of rules) {
            const cx = rowCx(tk, row, { before });
            if (r.when && !fxTruthy(fxEval(r.when, cx))) continue;
            row[r.field] = r.formula ? fxEval(r.formula, cx) : clone(r.value);
          }
        };
      }
      def.tables[tk] = td;
    }
    if (Array.isArray(spec.settings) && spec.settings.length) def.settings = { columns: Object.fromEntries(spec.settings.map(c => [c.id, colOut(c, null)])) };

    const cond = (src, table) => { const ast = fx(src, { table, thisTable: table }); return r => fxTruthy(fxEval(ast, rowCx(table, r))); };
    const sortOut = s => (s ? { key: s.column, dir: s.dir || 'asc' } : undefined);
    const view = v => {
      if (!VIEW_KEYS[v.type]) return { ...v };
      const o = { ...v };
      if (v.where) o.where = cond(v.where, v.table);
      if (v.sort) o.sort = sortOut(v.sort);
      if (v.type === 'kpi') {
        o.items = v.items.map(it => {
          const ast = fx(it.formula, {});
          const t = fxCheck(ast, { sch }).type;
          return { label: it.label, format: it.format || fmtOf(t) || 'number', decimals: it.decimals, value: () => fxEval(ast, {}) };
        });
      }
      if (v.type === 'dashboard') o.blocks = v.blocks.map(view);
      if (v.type === 'sheet' && v.child) o.child = { ...v.child, sort: sortOut(v.child.sort), where: v.child.where ? cond(v.child.where, v.child.table) : null };
      if (v.type === 'matrix') {
        for (const k of ['rows', 'columns']) {
          const ast = fx(v[k], { table: v.table, thisTable: v.table });
          const info = fxCheck(ast, { sch, table: v.table, thisTable: v.table });
          o[k] = { fn: r => fxEval(ast, rowCx(v.table, r)), ref: info.type === 'ref' ? info.ref : null, format: fmtOf(info.type) };
        }
        o.metrics = (v.metrics || [{ label: 'Rows', op: 'count' }]).map(m => ({ ...m, where: m.where ? cond(m.where, v.table) : null }));
      }
      return o;
    };
    if (Array.isArray(spec.views) && spec.views.length) def.views = spec.views.map(view);

    if (isObj(spec.seed) && Object.keys(spec.seed).length) {
      const seed = clone(spec.seed);
      def.onNew = (doc, api) => {
        for (const [tk, rows] of Object.entries(seed)) for (const r of rows) api.insert(tk, { ...defaultsFor(S.app.tables[tk]), ...clone(r) });
      };
    }

    def.migrations = {};
    for (const m of spec.migrations || []) {
      const steps = m.steps.map(s => ({ ...s, when: s.when ? fx(s.when, { raw: true }) : null, formula: 'formula' in s ? fx(s.formula, { raw: true }) : null }));
      def.migrations[m.to] = (doc, ctx) => {
        doc.tables = doc.tables || {};
        for (const s of steps) runMigrationStep(doc, s, ctx);
      };
    }

    const show = v => (v == null || v === '' ? 'blank' : typeof v === 'number' ? (isNaN(v) ? 'an error' : String(+v.toFixed(6))) : JSON.stringify(v));
    def.fixtures = (spec.tests || []).map(t => {
      const exps = t.expect.map(e => ('formula' in e ? { ...e, ast: fx(e.formula, {}) } : e));
      const doc = { app: { id: spec.id, schemaVersion: t.schemaVersion || spec.schemaVersion }, tables: clone(t.tables) };
      // Rows in a current-schema test get column defaults, as rows added in the tool would.
      if (doc.app.schemaVersion === spec.schemaVersion) {
        for (const [tk, rows] of Object.entries(doc.tables)) {
          const cols = spec.tables.find(x => x.id === tk)?.columns || [];
          for (const r of rows) for (const c of cols) if (r[c.id] === undefined && c.default !== undefined && c.type !== 'computed') r[c.id] = clone(c.default);
        }
      }
      if (t.settings) doc.settings = clone(t.settings);
      return {
        name: t.name, doc,
        expect: d => {
          const fails = [];
          for (const e of exps) {
            try {
              if (e.ast) {
                if (fxTruthy(fxEval(e.ast, {}))) continue;
                const n = e.ast;
                fails.push(n.t === 'bin' && ['=', '<', '>', '<=', '>=', '<>'].includes(n.op)
                  ? `"${e.formula}" is false: the left side is ${show(fxEval(n.a, {}))} and the right side is ${show(fxEval(n.b, {}))}`
                  : `"${e.formula}" is false`);
              } else if ('rows' in e) {
                const n = (d.tables[e.table] || []).length;
                if (n !== e.rows) fails.push(`${e.table} has ${n} rows, expected ${e.rows}`);
              } else {
                const row = (d.tables[e.table] || []).find(r => r.id === e.row);
                if (!row) { fails.push(`there is no "${e.table}" row with id "${e.row}"`); continue; }
                const v = rawValue(e.table, row, e.field);
                const ok = typeof e.equals === 'number' && typeof v === 'number' && e.tolerance != null ? Math.abs(v - e.equals) <= e.tolerance : fxEq(v, e.equals);
                if (!ok || (typeof v === 'number' && isNaN(v))) fails.push(`${e.table} "${e.row}" ${e.field} is ${show(v)}, expected ${show(e.equals)}${S.lastCalcError && isNaN(v) ? ` (${S.lastCalcError})` : ''}`);
              }
            } catch (x) { fails.push(`${e.formula || e.field}: ${x.message}`); }
          }
          return fails.length ? fails.join('; ') : true;
        },
      };
    });
    return def;
  }
  function runMigrationStep(doc, s, ctx) {
    const rows = t => (Array.isArray(doc.tables[t]) ? doc.tables[t] : []);
    switch (s.op) {
      case 'renameTable':
        if (Array.isArray(doc.tables[s.from])) { doc.tables[s.to] = rows(s.to).concat(doc.tables[s.from]); delete doc.tables[s.from]; }
        break;
      case 'renameField':
        for (const r of rows(s.table)) if (s.from in r) { if (r[s.to] == null) r[s.to] = r[s.from]; delete r[s.from]; }
        break;
      case 'removeField':
        for (const r of rows(s.table)) delete r[s.field];
        break;
      case 'setField':
        for (const r of rows(s.table)) {
          const cx = { raw: true, table: s.table, row: r, settings: doc.settings || {} };
          if (s.when && !fxTruthy(fxEval(s.when, cx))) continue;
          r[s.field] = s.formula ? fxEval(s.formula, cx) : clone(s.value);
        }
        break;
      case 'mapValues':
        for (const r of rows(s.table)) { const k = r[s.field]; if (k != null && Object.prototype.hasOwnProperty.call(s.map, String(k))) r[s.field] = s.map[String(k)]; }
        break;
      case 'textToRef': {
        const target = doc.tables[s.target] = rows(s.target);
        const key = v => String(v ?? '').trim().toLowerCase();
        const byKey = new Map(target.map(x => [key(x[s.match]), x]));
        for (const r of rows(s.table)) {
          let name = String(r[s.field] ?? '').trim();
          if (s.field !== s.to) delete r[s.field];
          if (!name) { if (s.blankValue == null) { r[s.to] = null; continue; } name = String(s.blankValue); }
          let hit = byKey.get(key(name));
          if (!hit) { hit = { id: ctx.uid(), [s.match]: name }; target.push(hit); byKey.set(key(name), hit); }
          r[s.to] = hit.id;
        }
        break;
      }
    }
  }
  // text -> { spec, def, problems }. def is set only when there are no errors.
  function specLoad(text, previous = null) {
    let raw;
    try { raw = parseLoose(text); }
    catch (e) { return { problems: [{ level: 'error', where: 'JSON', message: e.message }] }; }
    let norm;
    try { norm = specNormalise(raw); }
    catch (e) { return { problems: [{ level: 'error', where: 'definition', message: e.message }] }; }
    const { problems, sch } = specCheck(norm.spec);
    problems.push(...specCompare(previous, norm.spec), ...norm.notes);
    if (problems.some(p => p.level === 'error')) return { spec: norm.spec, problems };
    try { return { spec: norm.spec, def: specCompile(norm.spec, sch), problems }; }
    catch (e) {
      console.error(e);
      problems.push({ level: 'error', where: 'definition', message: `The tool could not be built: ${e.message}` });
      return { spec: norm.spec, problems };
    }
  }

  // ── Tool builder ───────────────────────────────────────────────────────
  // Shown by the blank template and by "Edit tool definition" in a tool built from JSON.
  // Paste a definition, check it (every problem listed, ready to paste back into Copilot),
  // preview it and download it as a finished tool file.
  const GUIDE_URL = 'https://blip2.github.io/carryall/guide.html';
  const EXAMPLE_SPEC = {
    id: 'snagging-tracker', name: 'Snagging tracker', version: '1.0.0', schemaVersion: 1,
    description: 'Defects found on site, who must fix them and when.',
    settings: [{ id: 'dueDays', label: 'Days allowed to fix a snag', type: 'number', decimals: 0, min: 1, default: 14 }],
    tables: [
      { id: 'areas', label: 'Areas', singular: 'area', display: 'name', columns: [
        { id: 'name', label: 'Area', type: 'text', required: true, unique: true },
        { id: 'open', label: 'Open snags', type: 'computed', format: 'integer', formula: "COUNT(snags WHERE area = this AND status <> 'Closed')" },
      ] },
      { id: 'snags', label: 'Snags', singular: 'snag', display: 'ref', columns: [
        { id: 'ref', label: 'Ref', type: 'text', required: true, unique: true, mono: true, defaultFormula: "NEXTREF(snags.ref, 'SN-', 3)" },
        { id: 'area', label: 'Area', type: 'ref', table: 'areas', required: true },
        { id: 'description', label: 'Description', type: 'longtext', required: true },
        { id: 'raised', label: 'Raised', type: 'date', defaultFormula: 'TODAY()' },
        { id: 'status', label: 'Status', type: 'choice', options: ['Open', 'Fixed', 'Closed'], default: 'Open', colors: { Open: 'blue', Fixed: 'purple', Closed: 'green' } },
        { id: 'due', label: 'Due', type: 'computed', format: 'date', formula: 'raised + settings.dueDays' },
        { id: 'overdue', label: 'Overdue', type: 'computed', format: 'text', formula: "IF(status = 'Open' AND due < TODAY(), 'Overdue', '')", colors: { Overdue: 'red' } },
      ] },
    ],
    views: [
      { type: 'dashboard', title: 'Overview', blocks: [
        { type: 'kpi', items: [
          { label: 'Open snags', formula: "COUNT(snags WHERE status = 'Open')", format: 'integer' },
          { label: 'Overdue', formula: "COUNT(snags WHERE overdue = 'Overdue')", format: 'integer' },
        ] },
        { type: 'summary', title: 'Open snags by area', table: 'snags', groupBy: 'area', where: "status <> 'Closed'" },
      ] },
      { type: 'table', title: 'Snags', table: 'snags', sort: { column: 'ref', dir: 'asc' }, filters: ['area', 'status'] },
      { type: 'table', title: 'Areas', table: 'areas' },
      { type: 'settings', title: 'Settings' },
    ],
    seed: { areas: [{ id: 'a1', name: 'Ground floor' }, { id: 'a2', name: 'First floor' }] },
    tests: [{ name: 'Overdue flag', settings: { dueDays: 14 }, tables: {
      areas: [{ id: 'a1', name: 'Ground floor' }],
      snags: [{ id: 's1', ref: 'SN-001', area: 'a1', description: 'Scuffed door', raised: '2020-01-01', status: 'Open' }],
    }, expect: [
      { table: 'snags', row: 's1', field: 'due', equals: '2020-01-15' },
      { table: 'snags', row: 's1', field: 'overdue', equals: 'Overdue' },
      { table: 'areas', row: 'a1', field: 'open', equals: 1 },
    ] }],
  };
  const STATE_KEYS = ['app', 'spec', 'data', 'dirty', 'readOnly', 'fileName', 'handle', 'undo', 'redo', 'tab', 'viewState', 'banners'];
  const saveState = () => Object.fromEntries(STATE_KEYS.map(k => [k, S[k]]));
  const restoreState = st => { for (const k of STATE_KEYS) S[k] = st[k]; };

  function startBuilder({ text = '', previous = null, saved = null, result = null } = {}) {
    S.builder = { text, previous, saved, result, stale: false };
    S.mode = 'builder';
  }
  function openBuilder() {
    startBuilder({ text: prettyJson(S.spec), previous: S.spec, saved: saveState() });
    render();
    document.getElementById('ca-spec-input')?.focus();
  }
  function closeBuilder() {
    const b = S.builder;
    if (!b || !b.saved) return;
    restoreState(b.saved);
    S.builder = null; S.mode = null;
    render();
  }
  // Run the self-test against a compiled definition without disturbing the open document.
  function testDefinition(def) {
    const keep = saveState();
    try {
      S.app = buildApp(def);
      S.data = null; S.viewState = {}; S.banners = [];
      return selfTest(false);
    } catch (e) {
      return { passed: 0, failed: 1, results: [{ pass: false, name: 'self-test', detail: e.message }] };
    } finally { restoreState(keep); }
  }
  function builderCheck() {
    const b = S.builder;
    const r = specLoad(b.text, b.previous);
    if (r.def) {
      const st = testDefinition(r.def);
      r.selfTest = st;
      for (const x of st.results) if (!x.pass) r.problems.push({ level: 'error', where: 'self-test', message: `${x.name}${x.detail ? ': ' + x.detail : ''}` });
      if (st.failed) r.def = null;
    }
    b.result = r; b.stale = false;
    if (r.spec && r.def) b.text = prettyJson(r.spec);
    render();
    document.getElementById('ca-builder-result')?.focus();
  }
  function builderPreview() {
    const b = S.builder;
    if (!b.result?.def) return;
    b.previewFrom = saveState();
    S.app = buildApp(b.result.def);
    S.spec = b.result.spec;
    S.data = newDocument();
    Object.assign(S, { dirty: false, readOnly: false, fileName: null, handle: null, undo: [], redo: [], tab: 0, viewState: {}, banners: [] });
    S.mode = 'preview';
    render();
  }
  function backToBuilder() {
    const b = S.builder;
    if (b.previewFrom) restoreState(b.previewFrom);
    b.previewFrom = null;
    S.mode = 'builder';
    render();
  }
  function toolFileName(spec) { return `${String(spec.fileName || spec.id).replace(/[\\/:*?"<>|]+/g, '-')}.html`; }
  function buildToolFile(spec) {
    const shell = S.shell.cloneNode(true);
    shell.setAttribute('data-ca-core', CORE_VERSION);
    shell.setAttribute('data-ca-app', spec.id);
    shell.setAttribute('data-ca-app-version', spec.version);
    let el = shell.querySelector('#ca-spec');
    if (!el) {
      el = document.createElement('script');
      el.id = 'ca-spec'; el.type = 'application/json';
      shell.querySelector('head').append(el);
    }
    el.textContent = '\n' + prettyJson(spec, true) + '\n';
    const dataEl = shell.querySelector('#ca-data');
    if (dataEl) dataEl.textContent = 'null';
    const snap = shell.querySelector('#ca-snapshot');
    if (snap) snap.textContent = '';
    const title = shell.querySelector('title');
    if (title) title.textContent = spec.name;
    return '<!DOCTYPE html>\n' + shell.outerHTML + '\n';
  }
  function downloadTool() {
    const spec = S.builder?.result?.spec;
    if (!spec || !S.builder.result.def) return;
    download(buildToolFile(spec), toolFileName(spec));
    toast(`Downloaded ${toolFileName(spec)}. Open it in Edge or Chrome and choose Start new.`);
  }
  async function copyText(text, what = 'Copied') {
    try { await navigator.clipboard.writeText(text); toast(what); return; } catch { /* fall back below */ }
    const t = h('textarea', { value: text, style: { position: 'fixed', top: '0', opacity: '0' } });
    document.body.append(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    t.remove();
    toast(ok ? what : 'Copy was blocked. Select the text and copy it yourself.');
  }
  function problemsForCopilot(problems) {
    const errs = problems.filter(p => p.level === 'error'), tips = problems.filter(p => p.level === 'warning');
    const line = (p, i) => `${i + 1}. ${p.where}: ${p.message}`;
    return [
      `The Carryall tool builder found ${errs.length} problem${errs.length === 1 ? '' : 's'} in the tool definition. Fix every one, keep everything else the same, and reply with the complete corrected definition as one JSON code block.`,
      '', ...errs.map(line),
      ...(tips.length ? ['', 'Also consider these suggestions:', ...tips.map(line)] : []),
    ].join('\n');
  }
  async function builderLoadFile(file) {
    let text = await file.text();
    if (/\.html?$/i.test(file.name)) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const el = doc.getElementById('ca-spec');
      if (!el || !el.textContent.trim() || el.textContent.trim() === 'null') return alertDialog('No tool definition found', `${file.name} was not built from a tool definition, so there is nothing to load.`);
      text = el.textContent.trim();
    }
    S.builder.text = text; S.builder.result = null;
    builderCheck();
  }
  function renderBuilder() {
    const b = S.builder;
    const r = b.result;
    const errs = r ? r.problems.filter(p => p.level === 'error') : [];
    const tips = r ? r.problems.filter(p => p.level === 'warning') : [];
    const tidy = r ? r.problems.filter(p => p.level === 'fixed') : [];
    const stale = h('p', { class: 'ca-muted', role: 'status' }, b.stale ? 'The definition has changed since it was checked.' : '');
    const input = h('textarea', {
      class: 'ca-textarea ca-spec-input', id: 'ca-spec-input', spellcheck: 'false', autocomplete: 'off', value: b.text,
      'aria-describedby': 'ca-spec-help',
      oninput: e => { b.text = e.target.value; if (b.result && !b.stale) { b.stale = true; stale.textContent = 'The definition has changed since it was checked.'; } },
    });
    const problemList = list => h('ol', { class: 'ca-problems' }, list.map(p => h('li', h('span', { class: 'ca-problem-where' }, p.where), ' ', p.message)));
    let result;
    if (!r) {
      result = h('p', { class: 'ca-muted' }, 'Select Check definition to look for problems.');
    } else if (errs.length) {
      result = [
        h('h2', `${errs.length} problem${errs.length === 1 ? '' : 's'} to fix`),
        h('p', 'Copy the problems into Copilot and ask it to send back the corrected definition. Then paste the new definition above and check it again.'),
        h('div', { class: 'ca-row' }, h('button', { class: 'ca-btn primary', type: 'button', onclick: () => copyText(problemsForCopilot(r.problems), 'Problems copied. Paste them into Copilot.') }, 'Copy problems for Copilot')),
        problemList(errs),
      ];
    } else {
      const st = r.selfTest;
      const nT = r.spec.tables.length, nV = (r.spec.views || []).length || nT;
      result = [
        h('h2', 'Ready to use'),
        h('p', `${r.spec.name} (version ${r.spec.version}): ${nT} table${nT === 1 ? '' : 's'}, ${nV} view${nV === 1 ? '' : 's'}.${st ? ` Self-test: all ${st.passed} checks passed.` : ''}`),
        h('div', { class: 'ca-row' },
          h('button', { class: 'ca-btn primary', type: 'button', onclick: builderPreview }, 'Preview the tool'),
          h('button', { class: 'ca-btn', type: 'button', onclick: downloadTool }, `Download ${toolFileName(r.spec)}`)),
        h('p', { class: 'ca-help' }, b.previous
          ? 'The download is the new version of the tool, with no data in it. Replace the hosted copy with it, then open saved files in it as usual.'
          : 'The download is your finished tool, with no data in it. Open it in Edge or Chrome and choose Start new, or share it with your team.'),
      ];
    }
    return h('div', { class: 'ca-builder' },
      b.broken && h('div', { class: 'ca-banner warn', role: 'status' }, 'This file\'s tool definition has problems, so the tool cannot start. Fix them below.'),
      h('div', { class: 'ca-card' },
        h('h2', b.previous ? `Change ${b.previous.name}` : 'Build a tool from a definition'),
        h('p', { id: 'ca-spec-help' }, b.previous
          ? 'This is the current definition. Paste it into Copilot with the change you want, then paste Copilot\'s reply here and check it. Increase "version" for every change.'
          : ['Ask the Carryall Tool Builder agent in Copilot to write a tool definition, then paste its reply here. ',
            h('a', { href: GUIDE_URL, target: '_blank', rel: 'noopener' }, 'How to build a tool with Copilot'), '.']),
        h('label', { for: 'ca-spec-input', class: 'ca-label' }, 'Tool definition (JSON)'),
        input,
        h('div', { class: 'ca-row', style: { marginTop: '0.75rem' } },
          h('button', { class: 'ca-btn primary', type: 'button', onclick: builderCheck }, 'Check definition'),
          h('button', { class: 'ca-btn', type: 'button', onclick: () => h('input', { type: 'file', accept: '.json,.txt,.html,.htm', onchange: e => e.target.files[0] && builderLoadFile(e.target.files[0]) }).click() }, 'Open a file…'),
          h('button', { class: 'ca-btn', type: 'button', onclick: () => copyText(b.text, 'Definition copied.') }, 'Copy definition'),
          !b.previous && h('button', { class: 'ca-btn', type: 'button', onclick: () => { b.text = prettyJson(EXAMPLE_SPEC); b.result = null; builderCheck(); } }, 'Load an example')),
        stale),
      h('section', { class: 'ca-card', id: 'ca-builder-result', tabindex: '-1', 'aria-live': 'polite', 'aria-label': 'Check result' }, result),
      tips.length > 0 && h('section', { class: 'ca-card' }, h('h2', `Suggestions (${tips.length})`),
        h('p', { class: 'ca-muted' }, 'These do not stop the tool working, but are worth fixing.'), problemList(tips)),
      tidy.length > 0 && h('details', { class: 'ca-card' }, h('summary', `Tidied automatically (${tidy.length})`),
        h('p', { class: 'ca-muted' }, 'These small variations were corrected. The downloaded tool uses the corrected definition.'), problemList(tidy)));
  }

  // ── Sheet and matrix views ─────────────────────────────────────────────
  function sortRows(t, rows, { key, dir }) {
    const m = dir === 'desc' ? -1 : 1;
    return rows.map(r => [sortKey(t, r, key), r])
      .sort(([a], [b]) => (a == null || a === '') ? 1 : (b == null || b === '') ? -1 : (a < b ? -m : a > b ? m : 0)).map(x => x[1]);
  }
  // One record at a time, with its linked rows underneath: a printable sheet.
  function renderSheet(el, view, api, key) {
    const t = view.table, td = S.app.tables[t];
    if (!td) throw new Error(`Table "${t}" is not defined`);
    const vs = S.viewState[key] = S.viewState[key] || {};
    let recs = tableRows(t).filter(r => !view.where || view.where(r, api));
    recs = view.sort ? sortRows(t, recs, view.sort) : [...recs].sort((a, b) => displayOf(t, a).localeCompare(displayOf(t, b), undefined, { numeric: true }));
    if (!recs.length) {
      el.append(UI.card(view.title || td.label, h('p', { class: 'ca-muted' }, `No ${td.label.toLowerCase()} yet.`),
        !S.readOnly && !td.readOnly && h('button', { class: 'ca-btn primary', onclick: () => openForm(t) }, `+ Add ${td.singular}`)));
      return;
    }
    if (!recs.some(r => r.id === vs.id)) vs.id = recs[0].id;
    const rec = recs.find(r => r.id === vs.id);
    const fields = (view.fields || Object.keys(td.columns).filter(k => !td.columns[k].hidden)).map(k => td.columns[k]).filter(Boolean);
    const ch = view.child, ct = ch && S.app.tables[ch.table];
    let kids = [];
    if (ct) {
      kids = tableRows(ch.table).filter(r => r[ch.link] === rec.id && (!ch.where || ch.where(r, api)));
      if (ch.sort) kids = sortRows(ch.table, kids, ch.sort);
    }
    const cols = ct ? (ch.columns || Object.keys(ct.columns).filter(k => !ct.columns[k].hidden && k !== ch.link)).map(k => ct.columns[k]).filter(Boolean) : [];
    const p = propsOn() ? S.data.properties : {};
    const rev = currentRevision();
    const selId = `ca-sheet-${key}`;
    const ro = S.readOnly;
    el.append(
      h('div', { class: 'ca-tv-bar' },
        h('label', { for: selId, class: 'ca-visually-hidden' }, `Choose ${td.singular}`),
        h('select', { class: 'ca-select ca-sheet-select', id: selId, dataset: { caFocus: selId }, onchange: e => { vs.id = e.target.value; render(); } },
          recs.map(r => h('option', { value: r.id, selected: r.id === rec.id }, displayOf(t, r)))),
        h('span', { class: 'ca-spacer' }),
        h('button', { class: 'ca-btn', onclick: () => openForm(t, rec.id) }, ro || td.readOnly ? `View ${td.singular}` : `Edit ${td.singular}`),
        ct && !ro && !ct.readOnly && h('button', { class: 'ca-btn', onclick: () => openForm(ch.table, null, { [ch.link]: rec.id }) }, `+ Add ${ct.singular}`),
        h('button', { class: 'ca-btn primary', onclick: () => window.print() }, 'Print')),
      h('div', { class: 'ca-card ca-sheet' },
        h('h2', `${view.title || td.singular}: ${displayOf(t, rec)}`),
        (p.projectNumber || p.projectName || rev) && h('p', { class: 'ca-muted' },
          [[p.projectNumber, p.projectName].filter(Boolean).join(' '), rev && `Revision ${rev.rev}, ${formatAs('date', rev.date)}`].filter(Boolean).join(' · ')),
        h('dl', { class: 'ca-sheet-fields' }, fields.map(c => h('div', { class: c.type === 'longtext' ? 'wide' : null },
          h('dt', c.label), h('dd', { class: c.type === 'longtext' ? 'ca-pre' : null }, formatCell(t, rec, c.key) || emptyText)))),
        ct && h('h3', { class: 'ca-subhead ca-sheet-sub' }, `${ct.label} (${kids.length})`),
        ct && h('div', { class: 'ca-table-wrap' }, h('table', { class: 'ca-table ca-sheet-table' },
          h('thead', h('tr', cols.map(c => h('th', { scope: 'col', class: isNumericCol(c) ? 'num' : null }, c.label)))),
          h('tbody', kids.length ? kids.map(r => h('tr', { class: 'clickable', tabindex: 0, onclick: () => openForm(ch.table, r.id), onkeydown: e => { if (e.key === 'Enter') openForm(ch.table, r.id); } },
            cols.map(c => h('td', { class: isNumericCol(c) ? 'num' : c.type === 'longtext' ? 'ca-pre ca-long' : null }, c.type === 'longtext' ? formatCell(ch.table, r, c.key) : cellNode(ch.table, r, c)))))
            : h('tr', h('td', { class: 'ca-empty', colspan: Math.max(1, cols.length) }, `No ${ct.label.toLowerCase()} for this ${td.singular} yet.`)))))));
  }
  // A cross-tab: rows and columns are values from the table (often links), cells are metrics.
  function renderMatrix(el, view, api) {
    const t = view.table, td = S.app.tables[t];
    if (!td) throw new Error(`Table "${t}" is not defined`);
    const axis = a => {
      if (typeof a === 'string') { const c = colDef(t, a); if (!c) throw new Error(`Column "${a}" is not defined on ${t}`); return { fn: r => rawValue(t, r, a), ref: c.type === 'ref' ? c.table : null, col: c }; }
      if (typeof a === 'function') return { fn: r => a(r, api) };
      return a;
    };
    const R = axis(view.rows), C = axis(view.columns);
    const label = (ax, v) => {
      if (fxBlank(v)) return '(none)';
      if (ax.ref) { const row = rowById(ax.ref, v); return row ? displayOf(ax.ref, row) : '(missing)'; }
      if (ax.col) return formatAs(ax.col.type === 'computed' ? ax.col.format || 'text' : ax.col.type, v, ax.col);
      return formatAs(ax.format || (typeof v === 'number' ? 'number' : 'text'), v);
    };
    const metrics = view.metrics || [{ label: 'Rows', op: 'count' }];
    const fmts = metrics.map(m => metricFormat(t, m));
    const rows = tableRows(t).filter(r => !view.where || view.where(r, api));
    const cells = new Map(), rk = new Map(), ck = new Map();
    for (const r of rows) {
      const a = R.fn(r), b = C.fn(r);
      const ka = String(a ?? ''), kb = String(b ?? '');
      if (!rk.has(ka)) rk.set(ka, label(R, a));
      if (!ck.has(kb)) ck.set(kb, label(C, b));
      const k = ka + '\u0000' + kb;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(r);
    }
    const order = m => [...m.entries()].sort((x, y) => x[1].localeCompare(y[1], undefined, { numeric: true }));
    const rowKeys = order(rk), colKeys = order(ck);
    const values = list => metrics.map((m, i) => formatAs(fmts[i], metricValue(t, m.where ? list.filter(r => m.where(r, api)) : list, m)) || '0');
    const card = h('div', { class: 'ca-card' }, view.title && h('h2', view.title));
    if (!rows.length) { card.append(h('p', { class: 'ca-muted' }, `No ${td.label.toLowerCase()} to show yet.`)); el.append(card); return; }
    const listCols = Object.values(td.columns).filter(c => !c.hidden && c.type !== 'longtext').slice(0, 5);
    const show = (rl, cl, list) => dialog({
      title: `${rl}, ${cl}: ${list.length} ${list.length === 1 ? td.singular : td.label.toLowerCase()}`, wide: true,
      body: h('div', { class: 'ca-table-wrap' }, h('table', { class: 'ca-table' },
        h('thead', h('tr', listCols.map(c => h('th', { scope: 'col' }, c.label)))),
        h('tbody', list.map(r => h('tr', { class: 'clickable', tabindex: 0, onclick: () => openForm(t, r.id), onkeydown: e => { if (e.key === 'Enter') openForm(t, r.id); } },
          listCols.map(c => h('td', cellNode(t, r, c)))))))),
    });
    card.append(
      h('div', { class: 'ca-table-wrap' }, h('table', { class: 'ca-table ca-matrix' },
        h('thead', h('tr', h('td', ''), colKeys.map(([, l]) => h('th', { scope: 'col' }, l)))),
        h('tbody', rowKeys.map(([ka, rl]) => h('tr', h('th', { scope: 'row' }, rl), colKeys.map(([kb, cl]) => {
          const list = cells.get(ka + '\u0000' + kb);
          if (!list) return h('td', '');
          const text = values(list).join(' / ');
          return h('td', h('button', { class: 'ca-matrix-cell', type: 'button', 'aria-label': `${rl}, ${cl}: ${metrics.map((m, i) => `${m.label || m.op} ${values(list)[i]}`).join(', ')}`, onclick: () => show(rl, cl, list) }, text));
        })))))),
      h('p', { class: 'ca-help' }, `Each cell shows ${metrics.map(m => m.label || m.op).join(' / ')}. Select a cell to see its ${td.label.toLowerCase()}.`));
    el.append(card);
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  function bindGlobal() {
    window.addEventListener('beforeunload', e => { if (S.dirty && S.mode !== 'preview') { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !S.data || S.mode) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); save({ as: e.shiftKey }); return; }
      if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
    document.addEventListener('click', e => {
      document.querySelectorAll('details.ca-menu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.ca-menu-list button')) d.open = false; });
    });
    let depth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    document.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; document.body.classList.add('ca-dragging'); } });
    document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('ca-dragging'); } });
    document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', async e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; document.body.classList.remove('ca-dragging');
      const item = e.dataTransfer.items?.[0];
      const handleP = S.app.saveInPlace && item?.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null;
      const file = e.dataTransfer.files[0];
      const handle = handleP ? await handleP : null;
      if (file) openFile(file, handle && handle.kind === 'file' ? handle : null);
    });
  }
  async function boot() {
    S.root = document.getElementById('ca-root');
    if (S.defineError) { S.root.textContent = `Carryall: the app definition has an error. ${S.defineError.message}`; return; }
    captureShell();
    if (!S.app) {
      // No JavaScript app: build the tool from its JSON definition, or open the tool builder.
      const text = document.getElementById('ca-spec')?.textContent.trim() || '';
      const r = text && text !== 'null' ? specLoad(text) : null;
      if (r && r.def) { S.app = buildApp(r.def); S.spec = r.spec; }
      else {
        startBuilder({ text: r ? text : '', result: r });
        if (r) S.builder.broken = true;
        bindGlobal();
        render();
        return;
      }
    }
    S.isHome = computeIsHome();
    const api = makeApi();
    for (const p of S.plugins) { try { p.setup && p.setup(api); } catch (e) { console.error(`[carryall] plugin ${p.name} failed`, e); } }
    bindGlobal();
    const raw = document.getElementById('ca-data')?.textContent.trim();
    if (raw && raw !== 'null') {
      try {
        const last = decodeURIComponent(location.pathname.split('/').pop());
        const name = /.html?$/i.test(last) ? last : null;
        await loadDocument(JSON.parse(raw), { fileName: name, source: 'embedded' });
      } catch (e) {
        console.error(e);
        addBanner('load', 'warn', `The data in this file could not be loaded: ${e.message}`);
        render();
      }
    } else render();
    listenForHandoff();
    identify();
    checkForUpdate();
    if (/[?&]selftest\b/.test(location.search)) selfTest(true);
  }

  window.Carryall = Object.freeze({
    version: CORE_VERSION,
    app: defineApp,
    plugin(p) {
      if (!p || !p.name) throw new Error('Carryall.plugin needs a name');
      S.plugins.push(p);
      Object.assign(S.viewTypes, p.views || {});
    },
    h, ui: UI, util: Util,
    get api() { return makeApi(); },
    selfTest,
    // Tool definitions (JSON): check one, or read it leniently. Used by the tool builder.
    checkDefinition: text => { const r = specLoad(text); return { ok: !!r.def, problems: r.problems, definition: r.spec || null }; },
    _state: S, // for debugging only; not a stable API
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else queueMicrotask(boot);
})();
