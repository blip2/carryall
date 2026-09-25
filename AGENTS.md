# Building a Carryall app (instructions for AI agents)

Carryall tools are defined by a **tool definition**: JSON in `<script id="ca-spec">`. Prefer it over
JavaScript: the core checks every part of a definition and explains each problem.

1. Copy `carryall.html` to `examples/<tool-id>.html` (or wherever the user wants it).
2. Read [src/definition-reference.md](src/definition-reference.md) (also embedded in the README comment
   at the top of every Carryall file). It is the complete reference for tool definitions: columns,
   formulas, views, checks, onSave rules, seed rows, tests and migrations.
3. Replace `null` in `<script type="application/json" id="ca-spec">` with the definition. Write `<` as
   `<` inside it (so the JSON can never close the script tag). Edit only `#ca-spec` and, if needed,
   `<style id="ca-app-css">`. Never hand-edit `#ca-core`, `#ca-core-css` or the README comment;
   `node tools/sync-core.mjs` owns them.
4. Any `<script>`, `<style>` or `<noscript>` you add must have an id starting `ca-`, or it is dropped from
   downloaded copies.
5. Don't add project number/name, created/updated/checked-by or revision fields to your tables. Every
   document already has them.
6. Calculations are formulas (`type: "computed"`), never stored values. Inside `WHERE`, use `this` for the
   row that owns the formula (`SUM(loads.kw WHERE node = this)`), never `id`.
7. Include `tests` with hand-worked results for the calculations that matter.
8. When changing the shape of stored data on a released tool: increase `version` and `schemaVersion`,
   append a migration with declarative steps, add a test at the previous schema version, and never
   edit old migrations.
9. Follow [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md) for UI copy: sentence case, plain UK English, no em
   dashes or emoji, never colour alone.
10. Verify: serve the folder with `node tools/dev-server.mjs <folder>` and open the file with `?selftest`.
    A definition with problems opens the tool builder instead of the tool, listing every problem. Check
    every view renders, and try adding, editing and deleting a row.

`Carryall.checkDefinition(text)` in the browser console returns `{ ok, problems, definition }` for any
definition text, which is handy for checking a draft.

Examples: `examples/review-tracker.html` (links, seeded rows, formulas across links, checks, onSave
rules, a dashboard, a matrix and a printable sheet) and `examples/asset-register.html` (schema version 3
with two migrations and a test for each old version).

## JavaScript apps (developers only)

A tool can instead call `Carryall.app({...})` in `<script id="ca-app">` (leave `#ca-spec` as `null`),
which allows custom views written in code. See "JAVASCRIPT APPS" in the README comment. Build custom
views with `api.h()`, never `innerHTML`, and change data only through
`api.insert/update/remove/setSettings`. To add a view type that JSON definitions can use, register it
with `Carryall.plugin({ name, views: { myView(el, view, api) {} } })` in a `<script id="ca-plugin-NAME">`.
`examples/fixtures/asset-register-v1-saved.html` is an old saved copy of a JavaScript app.
