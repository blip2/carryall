---
mode: agent
description: Build a new Carryall tool from a description
---
Build a new Carryall tool. Follow AGENTS.md.

1. Ask me short questions until you know: the tool's purpose, its tables and fields (with fixed choices),
   links between tables, the calculations, the screens and actions I want, any settings and any
   starting rows.
2. Choose the route with the table in AGENTS.md: a tool definition (JSON) if the whole tool fits one, or
   a JavaScript app if it needs more (custom screens, calculations that need loops or text matching,
   actions that change many rows). Do not force a complex tool into a definition.
3. Propose a plan (the route and why, tables, fields and types, calculations in words, views) and wait
   for my agreement.
4. Copy carryall.html to examples/<tool-id>.html. For a definition, write it in #ca-spec following
   src/definition-reference.md, with tests whose expected results you have worked out by hand. For a
   JavaScript app, leave #ca-spec as null and write Carryall.app({...}) in #ca-app following "JAVASCRIPT
   APPS" in the README comment, with fixtures whose expect function checks hand-worked results.
5. Run `node tools/check.mjs examples/<tool-id>.html --selftest` (without --selftest if Playwright is
   missing, though a JavaScript app needs it) and fix every problem until it passes.
6. Tell me how to preview it: `node tools/dev-server.mjs examples`, then open
   http://localhost:8765/<tool-id>.html.

The tool: ${input:description:What should the tool keep track of and calculate?}
