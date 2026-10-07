---
mode: agent
description: Change an existing Carryall tool safely
---
Change the Carryall tool in ${file}. Follow AGENTS.md, especially the rules for tools that are in use.

- A tool built from a definition: edit only #ca-spec (and #ca-app-css if needed), following
  src/definition-reference.md. If the change needs something a definition cannot express, do not work
  round it with extra columns or invented keys: say so, and propose a plugin view or moving the tool to
  a JavaScript app, and wait for my decision.
- A JavaScript app: edit #ca-app, following "JAVASCRIPT APPS" in the README comment.
- Increase "version". Never change "id".
- If stored data changes shape (a column or table renamed, removed or retyped), increase "schemaVersion",
  append a migration for the new number and add a test (or fixture) at the old schema version with rows
  in the old shape. Never edit an existing migration. Migrations cannot use TODAY(), USER(), dates or
  random ids: every copy must upgrade to the same data, so copies edited by different people can be
  combined.
- Update or add tests for any calculation you change.
- Run `node tools/check.mjs ${file} --selftest` (without --selftest if Playwright is missing) and fix every
  problem until it passes. Then summarise what changed and whether saved files will be migrated.

The change: ${input:change:What should change?}
