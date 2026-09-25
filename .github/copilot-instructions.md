# Carryall: instructions for GitHub Copilot

Follow [AGENTS.md](../AGENTS.md) for every Carryall tool. In short:

- A tool is one HTML file copied from `carryall.html`. Write its tool definition (JSON) in
  `<script type="application/json" id="ca-spec">`, following
  [src/definition-reference.md](../src/definition-reference.md). Write `<` as `<` inside it.
- Never write JavaScript for a tool unless the user asks for a JavaScript app. Never edit `#ca-core`,
  `#ca-core-css`, the README comment or anything in `src/` while building a tool.
- After every change, run `node tools/check.mjs <file>` and fix every problem it lists. Before finishing,
  run it with `--selftest` if Playwright is installed.
- Include `tests` with hand-worked results. Inside `WHERE`, use `this` (never `id`) for the row that owns
  the formula.
- Changing a tool that is in use: increase `version`; if stored data changes shape, increase
  `schemaVersion` and append a migration plus a test at the old schema version.
