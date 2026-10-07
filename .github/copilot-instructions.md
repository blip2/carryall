# Carryall: instructions for GitHub Copilot

Follow [AGENTS.md](../AGENTS.md) for every Carryall tool. In short:

- A tool is one HTML file copied from `carryall.html`, defined either by a **tool definition** (JSON in
  `<script type="application/json" id="ca-spec">`) or as a **JavaScript app** (`Carryall.app({...})` in
  `<script id="ca-app">`, with `#ca-spec` left as `null`).
- **Choose the route before writing anything**, with the table in AGENTS.md, and state it in your plan
  with the reason. Use a definition when the whole tool fits one; it is simpler and anyone can change it
  in the tool builder. Use a JavaScript app for complex tools: screens other than lists, forms,
  summaries, dashboards, sheets and cross-tabs; calculations that need loops, running totals or text
  matching; or actions that change many rows. Never force a complex tool into a definition with
  workaround columns or invented keys. If a definition stops fitting part way through, stop and say so.
- Definitions follow [src/definition-reference.md](../src/definition-reference.md) exactly. Write `<` as
  `<` inside `#ca-spec`. JavaScript apps follow "JAVASCRIPT APPS" in the README comment at the top
  of every Carryall file: views built with `api.h()` (never `innerHTML`), data changed only through
  `api.insert/update/remove/setSettings`.
- Never edit `#ca-core`, `#ca-core-css`, the README comment or anything in `src/` while building a tool.
- After every change, run `node tools/check.mjs <file>` and fix every problem it lists. Before finishing,
  run it with `--selftest` if Playwright is installed (for a JavaScript app the self-test is the check).
- Include tests with hand-worked results: `tests` in a definition, `fixtures` with `expect` in an app.
  In a definition's `WHERE`, use `this` (never `id`) for the row that owns the formula.
- Changing a tool that is in use: increase `version`; if stored data changes shape, increase
  `schemaVersion` and append a migration plus a test at the old schema version. Migrations must give the
  same result wherever they run (no `TODAY()`, `USER()`, dates or random ids), so copies upgraded
  separately still combine.
