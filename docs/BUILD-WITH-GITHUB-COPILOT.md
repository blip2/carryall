# Build tools with GitHub Copilot in VS Code

For people comfortable with VS Code and Git. GitHub Copilot's agent mode edits the tool file, runs the
Carryall checker, reads the problems and fixes them itself, so a tool goes from description to passing
self-test without copying and pasting. You also get version history and a diff for every change.

It is also the route for complex tools. Copilot here can write a tool in two ways:

- a **tool definition** (JSON) for simpler tools: tables, links, formulas and the built-in views. A
  definition can be changed later by anyone in the tool builder (More, Change this tool).
- a **JavaScript app** for complex tools: custom screens, calculations a formula can't express, or
  actions that change many rows at once.

## Definition or JavaScript?

The agent decides before it writes anything and tells you which route it chose in its plan. The rules
are in [AGENTS.md](../AGENTS.md); in short:

| Use a definition when the tool needs only | Use a JavaScript app when it needs |
|:-|:-|
| Lists of records with links between them | A screen that isn't a list, form, summary, dashboard, printable sheet or cross-tab, such as a timeline, calendar or board |
| Calculations on a row, and totals through links | Calculations with loops, running totals in order, or matching text between tables |
| Checks and values set when a row is saved | Actions that create or change many rows at once |

If the plan forces a complex tool into a definition (columns that only exist to work around something,
values packed into text), ask for a JavaScript app instead. If a tool fits a definition except for one
screen, the agent can add that screen as a plugin view and keep the definition for the rest.

## Set up once

1. Install [VS Code](https://code.visualstudio.com/), the GitHub Copilot extension, [Node.js](https://nodejs.org/)
   20 or later, and Git.
2. Clone the repository, or fork it for your team's tools:
   `git clone https://github.com/blip2/carryall.git`, then open the folder in VS Code.
3. For the full self-test from the terminal (recommended), install Playwright once in the folder:
   `npm install --no-save playwright` then `npx playwright install chromium`.
4. In Copilot Chat, switch to **Agent** mode and choose a strong model. Larger models write better
   formulas and tests.

The repository already tells Copilot how to work. It reads `.github/copilot-instructions.md` and
`AGENTS.md` automatically, and both point it at the [tool definition reference](../src/definition-reference.md).

## Build a tool

1. In Copilot Chat (Agent mode), type `/new-tool` and describe what the tool should keep track of and
   calculate. The prompt file makes the agent ask questions, agree a plan with you, then build.
2. The agent copies `carryall.html` to `examples/<tool-id>.html`. It writes a definition in the file's
   `<script id="ca-spec">` block, or a JavaScript app in `<script id="ca-app">`, with tests whose results
   it has worked out by hand.
3. It runs the checker, `node tools/check.mjs examples/snagging-tracker.html --selftest`, and fixes every
   problem until it passes.
4. Preview it: run `node tools/dev-server.mjs examples` and open
   `http://localhost:8765/snagging-tracker.html` (in your browser, or in VS Code's Simple Browser).
   Add, edit and delete some rows, and check the numbers against your own.
5. Review the diff and commit.

Without the prompt file, ask in your own words: "Build a Carryall tool that … Follow AGENTS.md, choose
between a definition and a JavaScript app, and check it with tools/check.mjs."

## Change a tool

Open the tool file, type `/change-tool` in Copilot Chat and describe the change. The agent increases
`version`, adds a migration and an old-version test if stored data changes shape, updates the tests and
runs the checker. Read the summary and the diff before committing: a migration is permanent once saved
files have been upgraded by it.

## The checker

`tools/check.mjs` runs the tool builder's checks in the terminal, so the agent (or you) can see every
problem without opening a browser.

| Command | Does |
|:-|:-|
| `node tools/check.mjs examples/my-tool.html` | Checks the definition in the file's `#ca-spec` block. Exit code 1 if there are problems. |
| `node tools/check.mjs my-tool.json` | Checks a definition kept as a separate JSON file. |
| `node tools/check.mjs examples/my-tool.html --selftest` | Also renders every view and runs the tests and migrations in headless Chromium. Needs Playwright. For a JavaScript app this is the whole check. |
| `node tools/combine.mjs a.html b.html -o combined.html` | Combines two copies of a document that different people edited. Lists any clashes; `--prefer ours`, `theirs` or `newest` settles them. Needs Playwright. |
| `node tools/dev-server.mjs examples` | Serves the folder at `http://localhost:8765/` to try tools in a browser. |
| `node tools/sync-core.mjs` | Updates the Carryall core inside every tool file after pulling a new version of Carryall. |

In the browser console, `Carryall.checkDefinition(text)` gives the same result for any definition text.

## Tips

- **Commit before each change.** If the agent goes wrong, discard its edits and ask again.
- **Give it the numbers.** For calculations that matter, work an example out yourself and ask for it to be
  added as a test. The self-test then proves it on every change.
- **Keep out of the core.** The agent should only edit `#ca-spec` or `#ca-app` (and perhaps
  `#ca-app-css`). The core blocks are overwritten by `tools/sync-core.mjs`, and
  `node tools/sync-core.mjs --check` fails if they have been edited by hand.
- **Existing spreadsheets.** Attach a CSV export and ask the agent to design the tables from its columns.
  Once the tool works, import the CSV from the tool's More menu.
- **One custom screen.** If a definition fits except for one screen (a bespoke chart, say), the agent can
  register a plugin view type in `<script id="ca-plugin-NAME">` that the definition then uses. See
  `AGENTS.md`.
- **Microsoft 365 Copilot** can also write tool definitions, for people without VS Code. It can't write
  JavaScript apps. See [Create a tool with Microsoft 365 Copilot](CREATE-A-TOOL-WITH-COPILOT.md).
- **Publishing.** Push to a GitHub repository with Pages enabled and `.github/workflows/pages.yml` publishes
  the tools; set `home` in each definition to its published address.
