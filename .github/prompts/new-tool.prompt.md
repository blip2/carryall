---
mode: agent
description: Build a new Carryall tool from a description
---
Build a new Carryall tool. Follow AGENTS.md and src/definition-reference.md.

1. Ask me short questions until you know: the tool's purpose, its tables and fields (with fixed choices),
   links between tables, the calculations, the views I want, any settings and any starting rows.
2. Propose a plan (tables, fields and types, calculations in words, views) and wait for my agreement.
3. Copy carryall.html to examples/<tool-id>.html and write the definition in #ca-spec, with tests whose
   expected results you have worked out by hand.
4. Run `node tools/check.mjs examples/<tool-id>.html --selftest` (without --selftest if Playwright is
   missing) and fix every problem until it passes.
5. Tell me how to preview it: `node tools/dev-server.mjs examples`, then open
   http://localhost:8765/<tool-id>.html.

The tool: ${input:description:What should the tool keep track of and calculate?}
