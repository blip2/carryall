---
mode: agent
description: Change an existing Carryall tool safely
---
Change the Carryall tool in ${file}. Follow AGENTS.md, especially the rules for tools that are in use.

- Edit only the definition in #ca-spec. Increase "version".
- If stored data changes shape (a column or table renamed, removed or retyped), increase "schemaVersion",
  append a migration for the new number and add a test at the old schema version with rows in the old
  shape. Never edit an existing migration or change "id".
- Update or add tests for any calculation you change.
- Run `node tools/check.mjs ${file} --selftest` (without --selftest if Playwright is missing) and fix every
  problem until it passes. Then summarise what changed and whether saved files will be migrated.

The change: ${input:change:What should change?}
