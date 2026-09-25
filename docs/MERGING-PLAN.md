# Plan: combining copies edited by several people

Status: agreed design (see section 8). Nothing here is implemented yet.

## 1. The problem

A Carryall document is a file. People download it, pass it around (SharePoint, email, file shares)
and edit their own copies. Two people often start from the same saved copy, both make changes, and
someone then has to combine them. Today the only options are to pick one copy and retype the other
person's changes, or to export CSV from one and import it into the other (which overwrites whole
rows and never notices deletions).

We want **Combine with another copy**: open your copy, choose one or more other copies, and get one
document that contains everyone's changes, with a short list of the real clashes to decide.

### What the code gives us today

- Every document has a stable `meta.docId` (kept across saves and copies) and every row has a
  stable `id`. Copies of the same document already share ids, so rows can be matched exactly.
- There is no record of *what changed* or *what a copy had already seen*. Two copies can be
  compared, but without history we cannot tell "Sam added this row" from "Jo deleted it", or which
  of two different values is the newer one.
- Row ids are random (`uid()`), and so are ids created by `normalise()` (rows missing an id or
  with a duplicate id) and by the `textToRef` migration step. The same old file migrated twice, in
  two places, gets **different** ids for the same new rows. This is the main migration hazard.
- Saved copies carry their own core. Files saved by older cores will keep circulating for years
  and will be edited by cores that know nothing about merging.
- Undo snapshots cover `tables`, `settings` and `properties`. Recovery copies live in IndexedDB,
  keyed by `appId/docId`.

## 2. Options considered

| Approach | How it decides | Verdict |
|:-|:-|:-|
| Two-way compare | Every difference between the copies is a question for the user | Simple but unusable beyond a handful of edits, and cannot tell additions from deletions. Kept only as the fallback for old files. |
| Three-way merge against an embedded base | Each file carries a copy of the version it started from | Works for one fork, fails for chains (A to B to C, then merge with D), doubles file size, and the base is lost after the first combine. |
| Operation log (event sourcing) | Each file carries every edit | Most powerful, but the log grows without limit, is hard to read in a text editor, and every migration would have to rewrite the log. Too heavy for single files. |
| **Per-field version stamps with a version vector** | Each field remembers which editing session last wrote it; each file remembers which sessions it has seen | **Recommended.** Works for any number of copies, in any order, repeatedly. Small, readable, and migrations only need to carry stamps along. |

## 3. Recommended design

### 3.1 Ideas in one paragraph

Every time someone opens a document and changes it, that editing session gets a short random
**actor id**. The file holds a **clock**: for each actor, the highest change number it has seen.
Each stored field remembers the **stamp** (`actor:number`) of the change that last wrote it.
When combining copy A with copy B, for each field: if B's clock already covers A's stamp, B has seen
A's value and changed it later, so B wins; if A's clock covers B's stamp, A wins; if neither, the
two people changed it independently, and only then is it a **conflict** (and only if the values
differ). Deletions leave a small **tombstone** so a missing row can be told apart from a new one.

This is a standard state-based design (a map of last-writer registers with version vectors). Its
useful properties: combining is order-independent (A+B = B+A), repeatable (combining the same copy
twice changes nothing), and works across chains of copies, without needing the original file.

### 3.2 Data format

A new top-level `sync` block in the envelope. Rows stay exactly as they are today, so the data
stays readable and tools reading the JSON (Power Automate, scripts) are unaffected.

```text
"sync": {
  "v": 1,
  "clock":   { "k3f9a2": 14, "p0x7mq": 3 },
  "actors":  { "k3f9a2": { "by": "Sam Patel", "at": "2026-09-02T10:14:00Z" }, ... },
  "rows":    { "snags": { "r8d2kq1mzp": "k3f9a2:6" } },
  "fields":  { "snags": { "r8d2kq1mzp": { "status": "p0x7mq:3" } } },
  "settings": { "responseDays": "k3f9a2:2" },
  "properties": { "projectName": "k3f9a2:1" },
  "deleted": { "snags": { "r1aa0b9c2d": "p0x7mq:2" } }
}
```

- `rows[t][id]` is the stamp of the change that created the row. It is also the stamp of every
  field of that row that has no entry in `fields`.
- `fields[t][id][col]` is kept only for fields changed after the row was created.
- **No entry at all means the genesis stamp `0:0`**, which every clock covers. Existing files and
  unedited rows therefore cost nothing, and a file needs no conversion to take part.
- `actors` records who each session was (the same name as `updatedBy`) and when it started, so the
  conflict screen can say "changed by Sam Patel, 2 September 2026".
- `serialise()` writes `sync` one table per line, after `tables`, so the file stays diff-friendly.
- `sync` is excluded from `dataHash()` (so combining identical values never marks a check as stale)
  and from the recovery "same as file" comparison.

Size: a stamp entry is about 20 bytes. A session that edits 200 fields adds about 4 KB. A file that
has only ever been edited in the old way adds nothing. Tombstones and `actors` grow slowly (one
entry per deletion and per editing session). This fits the "under 1 MB" design limit comfortably;
the size advisory should include `sync` in its count.

### 3.3 Recording changes: diff, do not instrument

Rather than stamping inside `insertRow`, `updateRow`, `removeRow`, `setSettings`, CSV import,
`onSave`, undo, redo and every JavaScript app's own code paths, keep a **baseline**: the state as it
was last stamped (stored as one JSON string per row, for a fast compare). `stampPending()` diffs the
current state against the baseline and stamps everything that differs with a single new stamp
`actor:++clock[actor]`:

- a row not in the baseline: set `rows[t][id]`;
- a field whose value differs: set `fields[t][id][col]` (unknown columns included, so data kept for
  older columns still merges);
- a row in the baseline but gone now: move its stamps out and add `deleted[t][id]`;
- settings and properties keys the same way.

Call `stampPending()` before every save, JSON export, hand-off to the home copy, recovery write and
combine. An edit that is undone before any of those is never stamped at all, which is exactly right.

Rules that keep this correct:

1. **A new actor id for every load** (`loadDocument`, `startNew`, restoring a recovery copy). Each
   load is a fork, so a fresh actor guarantees that one stamp never names two different changes,
   even when the same person opens two old copies of the same file in two tabs.
2. **Your own counter never goes backwards.** Undo restores data, never the clock. If undo takes the
   data back past a save, the next `stampPending()` simply stamps the reverted fields as new changes.
3. The actor is added to `clock` and `actors` only when it first stamps something, so opening and
   reading a file adds nothing.

### 3.4 The combine algorithm

`combine(ours, theirs)` is a pure function (no DOM, no `S`), exported as `Carryall.combine` for tests
and for a command-line tool. Input: two envelopes. Output: `{ doc, conflicts, report }`.

1. **Check** that both belong to this tool (`app.id`). If `docId` differs, warn: "These look like
   two different documents" and offer **Add their rows instead** (a plain row import) or carry on.
2. **Bring both to the current schema** (section 4). A copy saved by a newer schema cannot be
   combined here: point the user to the latest tool, as the read-only banner already does.
3. **Stamp** our pending changes. Old files with no `sync` block are treated as all genesis.
4. **Rows**, for every row id in either copy:
   - In both: for each field in either row, compare stamps `a` and `b`.
     - `a = b` and values equal: nothing to do.
     - `a = b` and values differ: someone edited without stamps (an older core). **Conflict.**
     - `theirs.clock` covers `a`: take theirs. `ours.clock` covers `b`: keep ours.
     - Neither covers: independent edits. Equal values are not a conflict (keep the larger stamp so
       both sides agree); different values are a **conflict**.
   - Only in ours: if theirs has a tombstone, it was deleted there. If any of our field stamps are not
     covered by their clock, we edited it after they last saw it: **conflict** ("deleted in their
     copy, changed in yours"); otherwise delete it. If there is no tombstone but the row has a real
     (not genesis) creation stamp that their clock covers, they had the row and it vanished without
     a tombstone (an older core deleted it): **conflict**. Otherwise treat it as added and keep it
     (see 4.4: a genesis row missing on one side is never deleted silently).
   - Only in theirs: the mirror image.
5. **Settings and properties**: the same field rule per key. `properties.revisions` is a list keyed
   by `rev`: take the union, oldest first; the same `rev` with different content is a conflict.
   `checkedHash` is left alone, so a combined document correctly reads "Changed since check" unless
   the data really is identical.
6. **Clocks**: pointwise maximum. `actors`, `deleted`: union. `meta.migrations`: union without
   duplicates. `meta.revision`: the larger of the two (the next save adds one). Append a
   `meta.combined` record `{ at, by, other: { fileName, savedAt, revision, updatedBy } }`.
7. **Checks on the result** (semantic clashes that no field rule sees). These are listed after the
   field conflicts, each with a suggested fix:
   - **Links to a deleted row** (a comment added in one copy to a review deleted in the other).
     Suggest restoring the linked row; alternatives are clearing the link or removing the child.
   - **Duplicate values in `unique` columns**, most often both people getting the same next
     reference from `NEXTREF` (both added SN-014). Suggest renumbering their row to the next free
     reference, and say which rows link to it.
   - **Duplicate rows created by migrations in two places** (section 4.3). Suggest joining them.
   - **Checks (`errorIf`) that now fail** for rows that took fields from both copies. Listed, not
     blocking: the rows open with the message showing, as for any invalid row.

   `onSave` rules are not re-run: they would make new changes nobody asked for.

8. **Resolving** writes the chosen values with a new stamp from our actor, which covers both sides,
   so the same conflict never comes back when the combined copy meets either original again.

Every step above is deterministic, so two people combining the same pair of copies get the same
document (apart from their own resolution choices).

### 3.5 In the tool

- **More, Combine with another copy...** opens a file picker (several files allowed; they are
  combined one after another). Dropping a `.html` or `.json` file with the same `docId` onto an open
  document asks: **Combine with this document** or **Open instead**. The home copy hand-off gets the
  same question when a document is already open.
- If there are no conflicts, the result is applied straight away with a banner: "Combined with
  Snags JB.html: 12 changes taken in, 2 rows added, 1 row deleted. Download to keep the combined
  copy." with **Show what changed**.
- If there are conflicts, a **Combine copies** dialog lists them grouped by table, then row (by its
  display name), then field. Each shows both values formatted as in the tool, who changed each and
  when, and radio buttons **Keep yours** / **Keep theirs** (and **Keep row** / **Delete row** for row
  conflicts). Bulk buttons: **Keep all yours**, **Keep all theirs**, **Keep the newest** (by actor
  start time, with the dates it compares shown on the button and on each conflict). The dialog cannot finish until every conflict has a choice; the default choice is
  none, so nothing is decided silently.
- The whole combine is **one undoable step**. Its undo entry also captures `sync` and the baseline,
  so undo really returns to the state before combining (with the own-counter rule from 3.3).
- **Recovery**: when a recovery copy and an opened file have both moved on (the file was changed by
  someone else since), the recovery banner offers **Combine them** alongside Restore and Discard.
- Copy follows the style guide: sentence case, UK English, verbs on buttons, no colour-only signals
  (conflicts are marked with text and an icon plus label, not just an amber background).

### 3.6 Command line

`node tools/combine.mjs a.html b.html [c.html ...] -o combined.html` runs `Carryall.combine` in
headless Chromium (as `check.mjs --selftest` does), writes the result when there are no conflicts,
and otherwise prints them and exits 1. `--prefer ours|theirs|newest` resolves them in bulk. Useful
for administrators and for tests.

## 4. Migrations: what can go wrong and how each is handled

### 4.1 Copies at different schema versions

Combine always runs at the tool's current schema. Both copies are migrated first (the other copy
through the same `migrate()` as opening it), then combined. A copy from a newer schema is refused
with the existing "open it in the latest tool" route. A copy saved by an older **core** is fine: the
data envelope is the same, it just has no `sync` block, or an out-of-date one (4.4).

### 4.2 Stamps must follow the data through each step

`runMigrationStep` gets a `sync` companion so stamps move with their values. Migrations never create
stamps of their own: they are deterministic, so the same old value migrates to the same new value in
every copy, and it should keep the stamp of the user's edit that produced it.

| Step | What happens to `sync` |
|:-|:-|
| `renameTable` | Move `rows`, `fields` and `deleted` entries to the new table name. |
| `renameField` | Rename the key in `fields[t][id]`. If the target already had a value (the step keeps it), keep the target's stamp. |
| `removeField` | Drop `fields[t][id][field]`. |
| `setField` | The new value is derived from the row, so it takes the **latest stamp among the fields the formula reads** (or the fixed-value row's creation stamp). An old edit to `disposed` then correctly competes with a newer edit to `status` after `disposed` becomes `status`. |
| `mapValues` | Keep the field's stamp. |
| `textToRef` | The new ref field takes the stamp of the text field it replaces. New target rows get the genesis stamp and a **stable id** (4.3). |

JavaScript migrations (`Carryall.app` with `migrations[n] = (doc, ctx) => ...`) cannot be followed
step by step. After a JavaScript migration the core **re-derives** stamps by matching rows by id and
fields by name: fields that kept their name and row keep their stamp, renamed or new fields take the
row's creation stamp, and any value that differs from what the other copy's own migration produced
is caught by the "same stamp, different value" rule and shown as a conflict. So a JavaScript
migration can at worst cause extra questions, never a silent loss. `ctx.stableId(...parts)` is added
so JavaScript migrations can create rows with stable ids too.

The self-test gains a check for each migration: migrate a fixture, fork it, make one edit on each
side, migrate and combine; the result must hold both edits with no conflicts.

### 4.3 Random ids created during migration and normalisation

This is the biggest real-world risk. The asset register's `textToRef` step turns the text
"Main office" into a Sites row with a random id. If Sam and Jo each open their own v1 copy in the
v3 tool, each gets a different Main office row, and their assets point at different ids. Combined
naively, there are two Main offices and half the assets point at each.

Fixes, in order of importance:

1. **Stable ids from now on.** `textToRef` creates target rows with
   `id = "m" + hash(docId, migration to, target table, normalised match text)`. `normalise()` fills
   a missing id with `hash(docId, table, row position, row content)` and a duplicate id with
   `hash(id, position)`. The same old file then migrates to the same ids everywhere. This changes the
   ids a step produces, not what a released migration means, so it does not break the rule that
   released migrations are never edited. Existing examples, fixtures and tests must still pass; any
   test that names a migration-created id will need to look it up by its match value instead.
2. **Joining duplicates that already exist.** Copies migrated by today's core already carry random
   ids. When combining, rows that were added independently in each copy (neither clock covers the
   other's creation stamp) and share the same `match`/`unique`/`display` value in a table that a
   `textToRef` step targets are offered as **Same row?** pairs. Joining keeps one id, rewrites every
   `ref` that pointed at the other, and records the other id as a tombstone. This is also the right
   answer when two people genuinely both added "Main office" by hand.
3. `meta.migrations` records each migration's `docId`-based id seed, so the combine report can say
   when two copies were upgraded separately.

### 4.4 Older cores editing stamped files

A stamped file opened in a saved copy that has an older core (or edited in a JavaScript app that
changes `doc` directly) is still edited, but its changes are not stamped:

- `sync` survives, because `normalise()` and `serialise()` keep unknown top-level keys. This needs a
  test against the old fixture core to prove it.
- An unstamped change to a field leaves its stamp unchanged, so it shows up as "same stamp,
  different value": a conflict, never a silent overwrite.
- An unstamped deletion leaves no tombstone, so it shows up as "they had this row and it is gone":
  a conflict.
- An unstamped new row has no creation stamp (genesis), and the other copy's clock covers genesis,
  so without care it would look like an unstamped deletion on the other side. Rule: a row whose id is
  in neither `rows` nor `deleted` of the copy that lacks it is treated as **added** (keep it), since
  a genuinely deleted stamped row always leaves a tombstone.

After the next save in a current core, everything is stamped again (the baseline at load is the
file as opened, so the unstamped changes themselves are not re-stamped; they stay genesis-stamped
until resolved by a combine).

### 4.5 Files from before stamps existed

All files in circulation today have no `sync` block. Treated as genesis everywhere, combining two of
them falls back to a two-way compare: every differing field is a conflict, and rows present on one
side only are kept (never silently deleted). To make this bearable:

- **Choose the original too.** The combine dialog offers "Do you have the copy you both started
  from? Choose it to sort out most differences automatically." With a base, the rule is the classic
  three-way one: if only one side differs from the base, take it; rows in the base and missing on
  one side were deleted there; rows not in the base were added. Only fields both sides changed
  differently remain conflicts. The base is migrated to the current schema like the others.
- **Keep the newest file's values** as a bulk choice, using `meta.savedAt`.
- After this first combine the result is fully stamped (resolutions are stamped), so later combines
  between the people involved are automatic.

### 4.6 Future schema changes

- `sync` has its own `v` so its shape can change independently of `format` and `schemaVersion`.
- Adding a table or column needs nothing: missing stamps are genesis.
- The definition reference gains one line under "Changing a tool that is in use": migrations must
  be deterministic (no `TODAY()` or `USER()` in `setField` formulas), because combining depends on
  the same old data migrating to the same new data. `specCheck` should reject those functions in
  migration steps, as it already rejects table totals.

## 5. Edge cases

- **Same person, two tabs, same file**: two actors, so their edits combine like anyone else's.
- **Copy of a copy of a copy**: clocks carry everything each copy has seen, so chains need no base.
- **Row edited in one copy, deleted in the other**: a row conflict; default none, choices **Keep
  row** (with their edits) or **Delete row**.
- **Settings and document properties**: merged per key; a clash on project number is shown like any
  field conflict.
- **Issued revisions**: combined by revision code; if both issued P03 with different descriptions,
  that is a conflict, and the dialog suggests renaming one to the next free code.
- **Checked by**: kept as a value; the check fingerprint turns stale if the data changed, which is
  the honest answer after combining.
- **Read-only files** (newer schema) cannot be combined from here.
- **Very different documents** (different `docId`): refused as a combine by default, offered as a
  row import.
- **Clock growth**: one entry per editing session that saved a change. Hundreds of entries is a few
  kilobytes. Tombstones are never removed automatically, because a copy that has not seen the
  deletion could bring the row back.

## 6. Delivery in stages

Each stage is releasable on its own and keeps every existing file working.

1. **Stable ids (no UI).** Deterministic ids in `normalise()` and `textToRef`, `ctx.stableId`,
   determinism check in `specCheck`, updated tests. This helps even before combining exists, because
   it stops the id split at its source.
2. **Stamping (no UI).** `sync` block, actor per load, baseline and `stampPending()`, serialise,
   `dataHash` and recovery exclusions, stamps through each migration step, undo capturing `sync`.
   Self-test: stamped round trip, unknown-key survival, stamps after each migration.
3. **Combine engine.** Pure `Carryall.combine`, integrity checks, `tools/combine.mjs`. Core self-test:
   fork a test document, make random non-overlapping edits on each side, check A+B = B+A, (A+B)+B =
   A+B, and that every edit survives; overlapping edits must produce exactly the expected conflicts.
   Fixtures: two copies of the review tracker sample with known edits, and two v1 asset registers
   migrated separately (the Main office case).
4. **UI.** Menu entry, drop and hand-off prompts, conflict dialog, report banner, recovery Combine.
   Keyboard and screen-reader pass, style-guide copy.
5. **Old files.** Two-way fallback, the "choose the original" three-way option, duplicate-row
   joining, and a note in the README and definition reference.

## 7. Files touched

- `src/core.js`: envelope (`newDocument`, `normalise`, `serialise`, `dataHash`), loading and
  actors, `mutate`/undo, `prepareForSave`, recovery, hand-off, `runMigrationStep`, `migrate`,
  `specCheck`, self-test, new combine engine and dialog.
- `src/core.css`: conflict list styles using existing tokens.
- `src/readme.txt`: data envelope (`sync`), "Combining copies" for users, `ctx.stableId` for
  JavaScript apps.
- `src/definition-reference.md`: deterministic migrations; "Built in to every tool" mentions
  combining.
- `tools/combine.mjs` (new), `tools/check.mjs` (merge self-test is part of `--selftest`).
- `examples/fixtures/`: paired copies for combine tests.
- Then `node tools/sync-core.mjs` to stamp the new core into every file.

## 8. Decisions

1. **Combining is allowed in any copy** with a current core, not only the hosted home copy, so saved
   copies keep working offline. The home copy is still where the prompt is most visible.
2. **Keep the newest is offered** as a bulk choice. Device clocks can be wrong, so the button and each
   conflict show the dates it compares (actor start time for stamped copies, `meta.savedAt` for
   files from before stamps).
3. SharePoint co-authoring is not an alternative, because it cannot merge HTML files. Its version
   history is a good source for "the copy you both started from" in 4.5, and the guide should say so.
