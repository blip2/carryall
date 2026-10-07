# Building a Carryall app (instructions for AI agents)

A Carryall tool is one HTML file copied from `carryall.html`. It is defined in one of two ways:

- a **tool definition**: JSON in `<script type="application/json" id="ca-spec">`, checked in full by the
  core, which explains every problem; or
- a **JavaScript app**: `Carryall.app({...})` in `<script id="ca-app">`, with `#ca-spec` left as `null`.

## Choose the route first

**Which assistant are you?**

| Assistant | Route |
|:-|:-|
| Microsoft 365 Copilot, or any chat assistant that cannot edit files and run commands | **Tool definitions (JSON) only.** The person pastes your reply into the tool builder, which checks it. Never write JavaScript, HTML or CSS. If the tool needs something a definition cannot do, say so and suggest a developer builds it with GitHub Copilot in VS Code. |
| GitHub Copilot in VS Code, or another coding agent that edits files and runs commands | **A tool definition for simpler tools, a JavaScript app for complex ones.** Decide before writing anything, using the table below, and say which route you chose and why in your plan. |

**Definition or JavaScript?** A definition is quicker to write, fully checked and changeable by anyone
in the tool builder, so use it whenever the whole tool fits. Do not force a complex tool into one:
helper columns that exist only to work around a missing feature, values packed into text, or several
rounds of the checker rejecting the same idea all mean the tool needs JavaScript.

| A definition fits when the tool needs only | Use a JavaScript app when it needs any of |
|:-|:-|
| Tables of records with the listed column types, and links between tables | A screen that is not a list, form, summary, KPI row, dashboard, sheet or matrix (a timeline, Gantt chart, plan, calendar, kanban board, drag and drop, a wizard) |
| Row calculations, and totals over other tables with `WHERE` (including trees) | Calculations that need loops, running totals in row order, searches, iteration or matching text between tables |
| Checks on the row being saved (which can count other rows), and values set on that row when it is saved | Saving one row changing other rows, or actions that create, copy or change many rows at once |
| Tables, summaries, KPIs, dashboards, settings, printable sheets, cross-tabs | Charts other than the built-in bar chart, or bespoke printed layouts |

In between: a definition plus one **plugin view** (`Carryall.plugin` in `<script id="ca-plugin-NAME">`)
suits a tool that fits a definition except for one custom screen.

## Tool definitions (JSON)

1. Copy `carryall.html` to `examples/<tool-id>.html` (or wherever the user wants it).
2. Read [src/definition-reference.md](src/definition-reference.md) (also embedded in the README comment
   at the top of every Carryall file). It is the complete reference for tool definitions: columns,
   formulas, views, checks, onSave rules, seed rows, tests and migrations. Never invent keys, view
   types or functions it does not list.
3. Replace `null` in `<script type="application/json" id="ca-spec">` with the definition. Write `<` as
   `<` inside it (so the JSON can never close the script tag). Edit only `#ca-spec` and, if needed,
   `<style id="ca-app-css">`. Never hand-edit `#ca-core`, `#ca-core-css` or the README comment;
   `node tools/sync-core.mjs` owns them.
4. Don't add project number/name, created/updated/checked-by or revision fields to your tables. Every
   document already has them.
5. Calculations are formulas (`type: "computed"`), never stored values. Inside `WHERE`, use `this` for the
   row that owns the formula (`SUM(loads.kw WHERE node = this)`), never `id`.
6. Include `tests` with hand-worked results for the calculations that matter.

Examples: `examples/review-tracker.html` (links, seeded rows, formulas across links, checks, onSave
rules, suggestions, quick edits, a table that opens a sheet, a dashboard, a matrix and a printable
sheet) and `examples/asset-register.html` (schema version 3 with two migrations and a test for each
old version).

## JavaScript apps

1. Copy `carryall.html` and leave `#ca-spec` as `null`. Call `Carryall.app({...})` once in
   `<script id="ca-app">`. "JAVASCRIPT APPS" in the README comment at the top of every Carryall file is
   the reference (tables, views, migrations, fixtures and the `api`).
2. Use the built-in view types wherever they fit (`table`, `summary`, `kpi`, `dashboard`, `settings`,
   `sheet`, `matrix`) and add `custom` views only for what they cannot show. Build custom views with
   `api.h()`, never `innerHTML`, and the core classes (`ca-card`, `ca-table`, `ca-btn`, `ca-pill`).
3. Change data only through `api.insert/update/remove/setSettings`, so undo, recovery and combining
   copies keep working. Keep calculated columns pure (`fn(row, api)`), never stored.
4. Add `fixtures` with an `expect` function that checks the calculations that matter, and one fixture
   per old schema version.
5. Any `<script>`, `<style>` or `<noscript>` you add must have an id starting `ca-`, or it is dropped
   from downloaded copies. Inline every library (no CDN links).

`examples/fixtures/asset-register-v1-saved.html` is an old saved copy of a JavaScript app.

## Both routes

- Follow [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md) for UI copy: sentence case, plain UK English, no em
  dashes or emoji, never colour alone.
- When changing the shape of stored data on a released tool: increase `version` and `schemaVersion`,
  append a migration (declarative steps in a definition, a function in an app), add a test at the
  previous schema version, and never edit old migrations. Migrations must give the same result wherever
  they run (no `TODAY()`, `USER()`, dates or random ids), so copies upgraded by different people can
  still be combined.
- Verify after every change: `node tools/check.mjs <file>` runs the tool builder's checks in the
  terminal and lists every problem (exit code 1 if any). Add `--selftest` to render every view and run
  the tests, fixtures and migrations in headless Chromium (needs Playwright); for a JavaScript app the
  self-test is the check. Then serve the folder with `node tools/dev-server.mjs <folder>`, open the
  tool, and try adding, editing and deleting a row.

`Carryall.checkDefinition(text)` in the browser console does the definition check for any text.
