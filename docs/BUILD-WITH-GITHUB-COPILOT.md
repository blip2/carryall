# Build tools with GitHub Copilot in VS Code

For people comfortable with VS Code and Git. GitHub Copilot's agent mode can edit the tool file, run the
Carryall checker, read the problems and fix them itself, so a tool goes from description to passing
self-test with far less copying and pasting than the [Microsoft 365 route](CREATE-A-TOOL-WITH-COPILOT.md).
You also get version history, diffs for every change and room for larger tools.

The tool definition is the same in both routes. A tool built here can be changed later in the tool
builder (More, Change this tool), and the other way round.

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
2. The agent copies `carryall.html` to `examples/<tool-id>.html` and writes the definition in its
   `<script id="ca-spec">` block, with tests whose results it has worked out by hand.
3. It runs the checker, `node tools/check.mjs examples/snagging-tracker.html --selftest`, and fixes every
   problem until it passes.
4. Preview it: run `node tools/dev-server.mjs examples` and open
   `http://localhost:8765/snagging-tracker.html` (in your browser, or in VS Code's Simple Browser).
   Add, edit and delete some rows, and check the numbers against your own.
5. Review the diff and commit.

Without the prompt file, ask in your own words: "Build a Carryall tool that … Follow AGENTS.md and check
it with tools/check.mjs."

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
| `node tools/check.mjs examples/my-tool.html --selftest` | Also renders every view and runs the tests and migrations in headless Chromium. Needs Playwright. |
| `node tools/dev-server.mjs examples` | Serves the folder at `http://localhost:8765/` to try tools in a browser. |
| `node tools/sync-core.mjs` | Updates the Carryall core inside every tool file after pulling a new version of Carryall. |

In the browser console, `Carryall.checkDefinition(text)` gives the same result for any definition text.

## Tips

- **Commit before each change.** If the agent goes wrong, discard its edits and ask again.
- **Give it the numbers.** For calculations that matter, work an example out yourself and ask for it to be
  added as a test. The self-test then proves it on every change.
- **Keep it to the definition.** The agent should only edit `#ca-spec` (and perhaps `#ca-app-css`). The
  core blocks are overwritten by `tools/sync-core.mjs`, and `node tools/sync-core.mjs --check` fails if
  they have been edited by hand.
- **Existing spreadsheets.** Attach a CSV export and ask the agent to design the tables from its columns.
  Once the tool works, import the CSV from the tool's More menu.
- **Custom views in code.** If a definition can't express something (a bespoke chart, say), the agent can
  register a plugin view type in `<script id="ca-plugin-NAME">` that the definition then uses. See
  `AGENTS.md`. Keep the definition for everything else.
- **Publishing.** Push to a GitHub repository with Pages enabled and `.github/workflows/pages.yml` publishes
  the tools; set `home` in each definition to its published address.
