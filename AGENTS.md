# Building a Carryall app (instructions for AI agents)

1. Copy `carryall.html` to `examples/<tool-id>.html` (or wherever the user wants it).
2. Read the README comment at the top of that file. It is the complete reference for
   `Carryall.app({...})`: column types, views, migrations, document properties and the view API.
3. Edit **only** `<script id="ca-app">` and `<style id="ca-app-css">`. Never hand-edit
   `#ca-core`, `#ca-core-css` or the README comment; `node tools/sync-core.mjs` owns them.
4. Any `<script>`, `<style>` or `<noscript>` you add must have an id starting `ca-`, or it is
   dropped from downloaded copies.
5. Don't add project number/name, created/updated/checked-by or revision fields to your tables.
   Every document already has them (`api.properties`, `api.revision`, `api.user`).
6. Keep computed values out of stored data (`type: 'computed'`). Build custom views with `api.h()`,
   never `innerHTML`. Change data only through `api.insert/update/remove/setSettings`.
7. When changing the shape of stored data on a released tool: bump `schemaVersion`, append
   `migrations[N]`, add a fixture for the previous version, and never edit old migrations.
8. Follow [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md) for UI copy, colour and accessibility. Use the core
   classes and CSS custom properties; never raw hex colours, em dashes or emoji.
9. Verify: open the file with `?selftest` (serve it with `node tools/dev-server.mjs <folder>`),
   check every view renders, and try adding, editing and deleting a row.

`examples/asset-register.html` is a worked example covering refs, computed columns, a dashboard,
a custom view, settings and two migrations. `examples/review-tracker.html` adds seeded data (`onNew`),
workflow dates (`onSave`), filters on computed columns and two printable/interactive custom views.
