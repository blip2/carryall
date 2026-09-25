
 ██████  CARRYALL  ·  a single-file tool that carries its own data
 ─────────────────────────────────────────────────────────────────
 Core version: {{CORE_VERSION}}

 WHAT THIS FILE IS
 This one HTML file is a complete app: structured data + viewer + editor.
 Open it in Edge or Chrome and it works. There is no server and no database.
 Users edit the data and save a new copy of this file (to SharePoint, a file
 share, anywhere). The copy contains the data AND the definition of the tool
 that made it, so it keeps working on its own for as long as browsers can
 open HTML.

 The preferred workflow is to use the tool's hosted "home" copy (home, e.g.
 an Azure Static Web App). A saved file opened locally shows a banner
 offering to send its data to the home copy, which upgrades (migrates) the
 data to the latest schema. Saved copies stay usable offline regardless.

 WHERE THINGS ARE IN THIS FILE (all ids start with "ca-")
   <script id="ca-data" type="application/json">   THE DATA. Plain JSON, one
        row per line. "null" in a blank tool. Readable in any text editor.
   <script id="ca-spec" type="application/json">   THE TOOL DEFINITION: the
        tables, columns, formulas and views, as JSON. "null" in the blank
        template, which then opens the tool builder. See the reference below.
   <style id="ca-core-css">    framework styles       (do not edit, see below)
   <style id="ca-app-css">     app styles             (edit freely)
   <div id="ca-root">          UI renders here; emptied when saving
   <noscript id="ca-snapshot"> static HTML tables of the data, rewritten on
        every save, for readers with JavaScript disabled
   <script id="ca-vendor-*">   optional inlined libraries (one per block)
   <script id="ca-core">       the Carryall runtime   (do not edit, see below)
   <script id="ca-plugin-*">   optional plugins
   <script id="ca-app">        optional JavaScript: a tool written in code
        instead of JSON (see JAVASCRIPT APPS), or plugin registrations.

 RULE: every <script>, <style> or <noscript> you add MUST have an id starting
 "ca-". Saving rebuilds the file from these blocks and drops anything else.
 The core blocks and this README are replaced by tools/sync-core.mjs when the
 core is upgraded, so never hand-edit them inside an app file.

 ════════════════════════════════════════════════════════════════
 HOW TO BUILD A NEW TOOL (instructions for people and LLMs)
 ════════════════════════════════════════════════════════════════
 1. Open the blank template (carryall.html) in Edge or Chrome. It shows the
    tool builder.
 2. Write a tool definition: JSON, as described in the reference below.
    The Carryall Tool Builder agent in Microsoft 365 Copilot writes one
    from a plain description (see docs/CREATE-A-TOOL-WITH-COPILOT.md).
 3. Paste it into the builder and select Check definition. Every problem
    is listed with a fix; Copy problems for Copilot copies them for the
    agent. Repeat until it says Ready to use (this includes the self-test).
 4. Preview the tool, then Download it: a finished tool file with no data.
 5. To change a tool, open it and choose More, Change this tool.
 6. Release: increase version, and host the downloaded file as the home copy.
    The home copy is simply the tool file with <script id="ca-data"> null.

 An LLM editing a file directly (for example in VS Code) edits only
 <script id="ca-spec"> (and optionally <style id="ca-app-css">), then opens
 the file with ?selftest on the URL to run the self-test.

 ════════════════════════════════════════════════════════════════
 TOOL DEFINITION REFERENCE
 ════════════════════════════════════════════════════════════════
{{DEFINITION_REFERENCE}}

 ════════════════════════════════════════════════════════════════
 JAVASCRIPT APPS (advanced, for developers)
 ════════════════════════════════════════════════════════════════
 A developer can define a tool in JavaScript instead, which allows custom
 views written in code. Tools built from JSON are easier to check and to
 change; prefer them. A JavaScript app leaves <script id="ca-spec"> null.
 J1. Call Carryall.app({...}) once in <script id="ca-app">, with:
      id             stable kebab-case id. NEVER change it after release:
                     files are matched to tools by this id.
      name           display name
      version        semver of the app code, bump on every release
      schemaVersion  integer, starts at 1. Bump by 1 whenever the SHAPE of
                     stored data changes, and add a migration (J4).
      description    one line shown on the start screen
      home           URL of the hosted copy (optional but recommended)
      versionUrl     URL of a JSON file {"version": "1.2.0"} used to tell
                     saved copies an update exists (optional, needs CORS)
      identity       "azure-swa" to record the signed-in user in savedBy
      locale         e.g. "en-GB" (formats numbers and dates)
      currency       e.g. "GBP"
      fileName       default file name, without .html (the project number
                     is prefixed when set, e.g. "PRJ-1042 asset-register.html")
      saveInPlace    false (default): Open uses a plain file input and the
                     Download button downloads a new
                     copy, which works everywhere. true: Edge/Chrome write
                     back to the opened file (asks permission) and fall
                     back to a download if refused.
      properties     document properties, see DOCUMENT PROPERTIES below.
                     { required: ['projectNumber', 'projectName'],
                       firstRevision: 'P01' }  (these are the defaults)
                     or false to switch them off for a trivial tool.
      tables         see J2
      settings       optional single record of document-wide values: same
                     shape as a table ({ columns: {...} }). Stored in
                     data.settings. Edited with a "settings" view.
      views          see J3 (defaults to one table view per table)
      migrations     see J4
      fixtures       see J5
      onNew(doc, api)  optional: seed a brand new document
 J2. Define tables. Each row automatically gets a stable string "id".
      tables: {
        assets: {
          label: 'Assets', singular: 'asset',
          display: 'name',        // column (or fn(row)) used when referenced
          validate: (row, api) => ({ field: 'message' }),  // optional; a
                  // plain string is shown as a message for the whole form
          onSave: (row, before, api) => { row.closed = ... },  // optional:
                  // adjust a row from the form before it is stored
                  // (before is null for a new row)
          columns: {
            name:   { type: 'text', required: true, unique: true },
            notes:  { type: 'longtext' },
            cost:   { type: 'currency', min: 0 },
            qty:    { type: 'number', decimals: 0, default: 1 },
            rate:   { type: 'percent' },        // stored as 15 meaning 15%
            bought: { type: 'date', default: api => api.today },  // "YYYY-MM-DD"
            active: { type: 'boolean', default: true },
            status: { type: 'choice', options: ['Open', 'Closed'],
                      colors: { Open: 'green', Closed: 'grey' } },
            site:   { type: 'ref', table: 'sites' },   // stores the row id;
                    // display: 'code' shows one field of the linked row in tables
            total:  { type: 'computed', format: 'currency',
                      fn: (row, api) => (row.cost || 0) * (row.qty || 0) },
          } } }
    Column types: text longtext number currency percent date boolean
      choice ref computed.
    Common column options: label, required, default (value or fn(api)),
      help, hidden (never shown), hideInForm, min, max, decimals, unique,
      mono (show in monospace: references, drawing and job numbers).
    Pill colours: grey green amber red blue purple teal pink. Pills always
      show their text, so colour is never the only signal. For computed
      columns colors may be a function (value, row) => colour.
    Computed columns are NEVER stored; they are recalculated from code.
      Keep them pure. fn(row, api) may use api.settings, api.today,
      api.rows(t), api.row(t, id), api.value(t, row, key), api.sum(...),
      api.util.daysBetween(a, b), yearsBetween, addDays, addMonths, parseDate.
    Store money as plain numbers in major units (1234.5). Store dates as
      "YYYY-MM-DD" strings. Store nothing derivable.
 J3. Define views (tabs). Types:
      { type: 'table', table, title?, columns?: [keys], sort?: {key, dir},
        totals?: [keys], filters?: [keys] (computed columns allowed),
        where?: (row, api) => bool,
        add?: false, readOnly?: true, preset?: {defaults for new rows} }
      { type: 'summary', table, groupBy, bucket?: 'month'|'year' (dates),
        metrics?: [{ label, op: 'count'|'sum'|'avg'|'min'|'max', column, format? }],
        chart?: false | metricIndex, showTable?: false, where?, sortBy?: 'label' }
      { type: 'kpi', items: [{ label, value: api => number, format }] }
          format: number | integer | currency | percent | text | date
      { type: 'dashboard', title, blocks: [ ...kpi/summary/table/custom ] }
          kpi blocks and blocks with wide: true span the full width
      { type: 'settings', title, fields?: [keys], intro? }
      { type: 'sheet', title, table, fields?, sort?, where?,
        child?: { table, link (ref column), columns?, sort?, where? } }
      { type: 'matrix', title, table, rows: column key or fn(row, api),
        columns: same, metrics?: [{ label, op, column, where? }], where? }
      { type: 'custom', title, render: (el, api) => { el.append(...) } }
    Custom views build DOM with api.h(tag, props, ...children), which is
      XSS-safe (children become text). NEVER use innerHTML with data.
    Useful api members in views: api.doc, api.settings, api.rows(t),
      api.insert(t, row) / api.update(t, id, patch) / api.remove(t, id),
      api.setSettings(patch), api.openForm(t, id?), api.format(t, row, key),
      api.formatAs(type, value), api.ui.barChart([{label, value}], {format}),
      api.ui.kpi(label, text), api.ui.card(title, ...nodes), api.ui.pill,
      api.ui.dialog / alert / confirm, api.toast(msg).
    NEVER mutate api.doc directly: use insert/update/remove/setSettings so
      undo, recovery and the unsaved-changes marker work.
 J4. Migrations. When stored data changes shape, bump schemaVersion from N to
    N+1 and add migrations[N+1] = (doc, ctx) => { ...mutate doc... }.
      doc is the whole file envelope {app, meta, settings, tables}. Mutate
      it in place (or return a new one). To create rows, use
      ctx.stableId(...parts) for their ids (for example
      ctx.stableId('sites', name)): the same parts give the same id in
      every copy, so copies upgraded in different places still combine.
      ctx.uid() makes a random id; avoid it in migrations.
    Rules: migrations are append-only. Never edit or delete a released
      migration. Each one must work on ANY file at the previous version,
      including empty tables and missing fields. Adding an optional column
      does not need a migration; renaming, splitting, retyping, or moving
      data does. Unknown fields are preserved, so removing a column from
      the schema leaves old values in the file (harmless). A migration
      must give the same result wherever and whenever it runs: no dates,
      user names or random values.
    Files saved by a NEWER schema open read-only with a warning.
 J5. Test. Open the file with ?selftest on the URL (or About, Run self-test).
    It checks the definition, renders every view, migrates each fixture:
      fixtures: [{ name: 'v1 sample', doc: {app: {id, schemaVersion: 1},
                   tables: {...}}, expect: (doc, api) => boolean }]
    and round-trips an export. Keep one small fixture per old schema version.
 STYLE (full rules in docs/STYLE-GUIDE.md of the Carryall repository)
   The core styles already meet WCAG 2.1 AA: Arial, 16px base, rem units,
   44px targets, visible focus, light and dark modes. When writing an app:
   * Use the core classes (ca-card, ca-table, ca-btn, ca-kpi, ca-pill) and
     the palette and semantic custom properties declared at the top of
     ca-core-css. Never write raw hex colours in an app. Chart series take
     colours in order from Carryall.ui.palette.
   * Never convey meaning by colour alone: pair it with text.
   * One h1 (the tool name). Card and section titles are h2.
   * Copy: sentence case, plain UK English, buttons are verbs ("Add
     comment", never "OK" or "Submit"), specific error messages that say
     what to do, no em dashes, no emoji, dates as "1 September 2026".
   * Custom controls must be real buttons, inputs and links with
     accessible names, reachable and usable from the keyboard.

 DOCUMENT PROPERTIES (built in, the same in every tool)
   Every document carries doc.properties, edited from the line under the
   tool name (or More, Document properties). No app code is needed.
     projectNumber, projectName   required before the first download
     createdBy, updatedBy         updatedBy is set on every download from
                                  the user's name (Azure sign-in, or asked
                                  once and remembered in the browser)
     checkedBy, checkedAt         "Mark as checked" also stores checkedHash,
                                  a fingerprint of tables + settings; any
                                  later data change shows "Changed since
                                  check" (undoing the change clears it)
     revisions                    issued revisions, oldest first:
                                  [{ rev, date, description, by, checkedBy }]
                                  next code suggested: P01 to P02, A to B
   Read them in views and calcs as api.properties, api.revision (latest
   revision or null) and api.user. Change them with api.setProperties().
   meta.revision is different: it simply counts downloads/saves.

 DATA ENVELOPE (what <script id="ca-data"> holds)
   { "format": "carryall/1",
     "app":  { "id", "version", "schemaVersion" },   written on save
     "meta": { "docId", "revision" (save count), "created", "savedAt",
               "coreVersion", "migrations": [{from, to, at, appVersion}] },
     "properties": { "projectNumber", "projectName", "createdBy",
               "updatedBy", "checkedBy", "checkedAt", "checkedHash",
               "revisions": [ ... ] },
     "settings": { ... },
     "tables": { "<table>": [ { "id": "…", "<column>": value, … } ] },
     "sync": { ... } }   change stamps, see COMBINING COPIES
   The characters < are written as < inside the JSON (valid JSON).

 PLUGINS AND LIBRARIES
   Add a library by pasting its minified source into its own
   <script id="ca-vendor-NAME"> with a comment giving version and licence.
   Register extra view types from a <script id="ca-plugin-NAME">:
     Carryall.plugin({ name, version, setup(api) {},
       views: { myview: (el, view, api) => { ... } } });
   Suggested: Chart.js (charts), uPlot (fast time series), Papa Parse
   (heavy CSV), SheetJS CE (xlsx, about 1 MB), decimal.js (exact money).
   Everything must be inlined: no CDN links, so files work offline forever.

 LIMITS
   Designed for hundreds to a few thousand rows in total (< 1 MB). A
   warning shows above 5,000 rows or 5 MB. Beyond ~20,000 rows use a
   database. No attachments or images in data.

 COMBINING COPIES
   When several people edit their own copies of the same document, open
   one and choose More, Combine with another copy (or open or drop the
   other copy and choose Combine with this document). Every change from
   both copies is kept. Only a value changed differently in both, or a
   row deleted in one copy and changed in the other, needs a choice:
   Keep yours, Keep theirs, or Keep the newest (by the computers' clocks).
   The tool then offers fixes for links to deleted rows and for repeated
   references (both copies adding the next number). Combining is one
   step you can undo; download afterwards to keep the combined copy.
   Copies can be combined in any order, any number of times.
   How it works: "sync" records, for each stored value, the editing
   session that last changed it ("actor:n"), and for the document, how
   far it has seen each session ("clock"). A value the other copy has
   already seen loses to its newer one. Deleted rows leave a small
   marker. "seal" is a fingerprint of the data at the last save, so a
   copy changed by an older Carryall (before 0.3.0), which does not
   record changes, is treated with care: its differences are shown as
   choices rather than overwritten. Files from before 0.3.0 have no
   "sync" at all; combining two of them asks about every difference
   unless you also choose the copy they both started from.
   tools/combine.mjs in the Carryall repository does the same from a
   terminal.

 DOWNLOADING AND OPENING (for users)
   Download gives you a new copy of this file containing your data. Put it
   back where the original lived (e.g. upload it to SharePoint, replacing
   the old one, so version history is kept). Open or drag in a saved
   .html, a .json export, or a .csv (rows are added to a table). Work you
   have not downloaded is kept in this browser as a recovery copy.
