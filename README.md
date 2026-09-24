# Carryall

Single-file HTML tools that carry their own data. Each tool is one `.html` file containing
the structured data, the viewer and the editor. There's no server or database, and it keeps
working for as long as browsers open HTML.

**Try it:** [blip2.github.io/carryall](https://blip2.github.io/carryall/) has the example tools, sample projects and the blank template.

- **Hosted home copy**: the latest version of each tool lives at a URL (e.g. an Azure Static Web App).
  People open it, load a saved file, edit it and **download** an updated copy.
- **Saved copies**: stored anywhere (SharePoint, file shares). A copy opened on its own still works fully,
  and a banner offers to send its data to the latest tool, which migrates it to the current schema.
- **Plain data**: a readable JSON block inside the file, plus a static HTML snapshot for no-JavaScript readers.
- **Accessible by default**: the core follows [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md) (Arial, 16px base,
  44px targets, keyboard support, labelled and announced form errors, light and dark modes).
- **Standard document properties** in every tool: project number and name, created/updated by, checked by
  (with a data fingerprint), and a revision log.

## Layout

| Path | What |
|---|---|
| `carryall.html` | Blank template with a tiny starter app. Copy this to make a new tool. |
| `src/core.js`, `src/core.css`, `src/readme.txt` | The framework. Edit here only. |
| `tools/sync-core.mjs` | Stamps the core + README into the template and every app file. |
| `tools/build-site.mjs`, `site/`, `.github/workflows/pages.yml` | Publishes the examples to GitHub Pages on every push to `main`, rewriting their `home` URLs to the Pages address. |
| `tools/dev-server.mjs` | Local "home" server for testing (`http://localhost:8765/`). |
| `examples/asset-register.html` | Example app: schema v3, two migrations, dashboard, custom view, settings. |
| `examples/fixtures/asset-register-v1-saved.html` | An *old* saved copy (v1.0, schema 1) for testing upgrades. |
| `examples/review-tracker.html` | Design review tracker for building projects: disciplines, review packages, comments and responses, a review matrix and a printable comment sheet. |
| `examples/fixtures/review-tracker-sample.html` | A populated review tracker (9 reviews, 43 comments) to explore. |
| `docs/CREATE-A-TOOL-WITH-COPILOT.md` | Guide for building a tool with Microsoft 365 Copilot, plus agent setup. |
| `docs/copilot/` | Copilot agent instructions and the generated reference (knowledge) file. |
| `docs/STYLE-GUIDE.md` | UI style and accessibility rules (WCAG 2.1 AA) that the core implements and apps must follow. |
| `deploy/staticwebapp.config.json` | Sample Azure Static Web Apps config. |
| `AGENTS.md` | Instructions for AI tools building a new Carryall app. |

The full app-author reference is the README comment at the top of every Carryall file,
generated from `src/readme.txt`.

## Working on the core

```bash
node tools/sync-core.mjs          # after editing anything in src/
node tools/sync-core.mjs --check  # CI: fail if any file is stale
node tools/dev-server.mjs         # serve examples/ on :8765
```

Open `http://localhost:8765/asset-register.html?selftest` to run the built-in self-test.

## Try the upgrade flow

1. `node tools/dev-server.mjs`
2. Open `http://localhost:8765/asset-register.html` (the home copy, which shows the start screen).
3. Drag `examples/fixtures/asset-register-v1-saved.html` onto it. It migrates from schema 1 to 3
   (free-text locations become a Sites table, `value` becomes `cost`, `disposed` becomes `status`).
4. Or open the v1 file directly and click **Open data in latest tool**. It opens the home copy
   and hands the data over with `postMessage` (Edge/Chrome; allow pop-ups).
5. Click **Download**. The first time, you're asked for the project details and your name.
   Downloading is the default; an app can opt in to writing back to the opened file with `saveInPlace: true`.

## Deploying a tool

Deploy the app's `.html` file (with `<script id="ca-data">null</script>`) to the Azure Static Web App,
set `home` in the app definition to its URL, and optionally publish a `<app>.version.json`
(`{"version": "1.2.0"}`) so saved copies can tell users an update exists. See `deploy/`.

## Status

Phase 0 prototype, core 0.1.0. Tested in Chromium: self-test, v1 to v3 migration, edit, download
round trip, document properties, check fingerprint, recovery, keyboard use of tabs, sorting and forms. **Not yet tested:** the pop-up hand-off
and save-in-place in a real Edge window, or opening files from SharePoint/OneDrive.

## Licence

MIT. See [LICENSE](LICENSE).
