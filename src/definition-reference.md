# Tool definition reference

A Carryall tool is defined by a **tool definition**: one JSON object that lists the tool's tables,
columns, calculations and views. There is no JavaScript to write. Open the blank template
(`carryall.html`) in Edge or Chrome to get the **tool builder**. Paste a definition, select
**Check definition**, fix any problems it lists, then **Preview** and **Download** the finished tool.
To change a tool later, open it and choose **More, Change this tool**.

The builder checks everything below and names each problem with a fix. Its **Copy problems for
Copilot** button copies them in a form Copilot can act on.

## The rules that matter most

1. **JSON only.** Double quotes around every key and text value. No comments, no functions, no `=>`.
2. **Ids.** The tool `id` is lower case words joined by hyphens (`snagging-tracker`). Table and column
   ids are letters and numbers only, starting with a letter, in camelCase (`distributionNodes`,
   `unitCost`). No hyphens or spaces. Never call a column `id`: every row already has one.
3. **Every table** has `id`, `label`, `singular`, `display` (or `displayFormula`) and `columns`.
4. **Calculations are formulas in quotes** (`"formula": "quantity * rate"`). Calculated values are
   never stored, so they never appear in `seed` or `tests` rows.
5. **Text inside a formula uses single quotes**: `status = 'Open'`.
6. **To add up linked rows, use WHERE with `this`**: `SUM(loads.kw WHERE node = this)`. Inside WHERE,
   plain names belong to the rows being added up; `this` is the row the formula belongs to.
7. **No project number, project name, revision, created by, updated by or checked by columns.**
   Every Carryall document already has these built in.
8. **Include a test**: a few rows and the results you expect, so the self-test proves the sums.

## Shape

```text
{
  "id": "snagging-tracker",
  "name": "Snagging tracker",
  "version": "1.0.0",
  "schemaVersion": 1,
  "description": "Defects found on site, who must fix them and when.",
  "settings": [ ...fields... ],
  "tables": [ ...tables... ],
  "views": [ ...views... ],
  "seed": { "tableId": [ ...starting rows... ] },
  "tests": [ ...tests... ],
  "migrations": [ ...only when stored data changes shape... ]
}
```

## Tool properties

| Key | Required | What it is |
|:-|:-|:-|
| `id` | yes | Lower case words joined by hyphens. Files are matched to tools by this id, so never change it once the tool is in use. |
| `name` | yes | The tool's title. |
| `version` | yes | `"1.0.0"` for a new tool. Increase it every time the tool changes (`"1.1.0"`). |
| `schemaVersion` | yes | `1` for a new tool. Increase by 1 only when stored data changes shape, and add a migration. |
| `description` | no | One line shown on the start screen. |
| `locale`, `currency` | no | Defaults `"en-GB"` and `"GBP"`. |
| `fileName` | no | Default file name for downloads, without `.html`. |
| `home` | no | Web address of the hosted copy. Saved copies offer to open their data there. |
| `versionUrl` | no | Web address of a JSON file `{ "version": "1.2.0" }` used to tell saved copies an update exists. |
| `identity` | no | `"azure-swa"` records the signed-in user when hosted on Azure Static Web Apps. |
| `saveInPlace` | no | `true` lets Edge and Chrome save back to the opened file. Default is a download. |
| `properties` | no | `false` switches off the built-in project details, or `{ "required": ["projectNumber"], "firstRevision": "A" }`. |

## Settings

Document-wide values, such as a default response period. A list of fields written exactly like
columns (see below), except that settings cannot be `ref` or `computed`. Formulas read them as
`settings.fieldId`. Show them with a `settings` view.

```json
"settings": [
  { "id": "responseDays", "label": "Default response period (days)", "type": "number", "decimals": 0, "min": 1, "default": 10 }
]
```

## Tables

```json
{
  "id": "snags", "label": "Snags", "singular": "snag", "display": "ref",
  "columns": [ ... ],
  "checks": [ ... ],
  "onSave": [ ... ]
}
```

| Key | What it is |
|:-|:-|
| `id` | camelCase, unique. The key used in formulas and saved data. |
| `label` | Plural name shown on tabs and headings. |
| `singular` | The name for one row, used on buttons such as "Add snag". |
| `display` | The column that names a row when another table links to it. |
| `displayFormula` | Instead of `display`: a formula such as `"code & ' ' & name"`. |
| `columns` | The list of columns. |
| `checks` | Validation rules (see Checks). |
| `onSave` | Values filled in automatically when a row is saved (see onSave rules). |
| `readOnly` | `true` stops rows being added or edited in the tool. |

## Columns

```json
{ "id": "priority", "label": "Priority", "type": "choice", "options": ["Critical", "Major", "Minor"],
  "default": "Major", "required": true, "colors": { "Critical": "red", "Major": "amber", "Minor": "grey" } }
```

Keys every column can have: `id`, `label`, `type`, `required` (true or false), `unique`, `help`
(guidance shown under the field), `hidden` (never shown), `hideInForm`, `mono` (monospace, for
references and drawing numbers), `default` (a fixed value) and `defaultFormula` (a formula such
as `"TODAY()"` or `"NEXTREF(snags.ref, 'SN-', 3)"`).

| Type | Stores | Extra keys |
|:-|:-|:-|
| `text` | One line of text | `maxLength` |
| `longtext` | Several lines of text | |
| `number` | A number | `min`, `max`, `decimals`, `step` |
| `currency` | Money as a plain number, such as 1234.5 | `min`, `max`, `currency` |
| `percent` | A percentage stored as 15 for 15% | `min`, `max`, `decimals` |
| `date` | A date written `"YYYY-MM-DD"` | |
| `boolean` | `true` or `false`, shown as a tick box | `checkLabel` |
| `choice` | One of a fixed list | `options` (required), `colors` |
| `ref` | A link to a row in another table (it stores that row's id) | `table` (required), `display` |
| `computed` | Nothing: it is calculated every time | `formula` (required), `format`, `decimals`, `colors`, `colorFormula` |

- `colors` maps values to pill colours: grey, green, amber, red, blue, purple, teal, pink. Pills
  always show their text, so colour is never the only signal.
- `format` sets how a calculated value is shown: number, integer, currency, percent, date, text or
  boolean. Without it, Carryall works it out from the formula.
- `colorFormula` (calculated columns) returns a colour name, such as `"IF(overdue > 0, 'red', '')"`.
- A `ref` column's `display` shows one column of the linked row in tables, such as `"display": "ref"`.

## Formulas

Formulas are like spreadsheet formulas, written without the `=`.

| Where | The formula can use |
|:-|:-|
| `formula`, `colorFormula`, `displayFormula` of a table's column | That row's columns, linked rows, settings, table totals |
| `where` of a table, summary, sheet or matrix view | The row being tested |
| `checks[].errorIf` | The row being saved |
| `onSave[].when` and `onSave[].formula` | The row being saved, and `before.column` for its value before the edit |
| `defaultFormula`, KPI `formula`, test `formula` | Settings, `TODAY()`, `USER()` and table totals, but no row |

**Values**: numbers (`12.5`), text in single quotes (`'Open'`), `TRUE`, `FALSE`, `BLANK()`.

**Operators**: `+ - * / ^`, `&` joins text, `%` after a number divides by 100, comparisons
`= <> < > <= >=`, and `AND`, `OR`, `NOT`. `status IN ('Open', 'Responded')` and `NOT IN` test a list.
Text comparisons ignore upper and lower case.

**Columns and links**: a column's id gives its value (`quantity * rate`). Follow a `ref` column with a
dot to read the linked row: `site.name`, `review.reviewed.code`. `id` is the row's own id.

**Settings**: `settings.responseDays`.

**Table totals**: `SUM`, `COUNT`, `AVERAGE`, `MIN` and `MAX` work over another table, optionally
filtered with `WHERE`:

```text
COUNT(snags)                                          all rows
COUNT(snags WHERE status = 'Open')                    rows that match
SUM(loads.kw WHERE node = this)                       rows linked to this row
SUM(nodes.totalKw WHERE suppliedFrom = this)          a tree: child rows of this row
AVERAGE(comments.daysOpen WHERE review.stage = 'Stage 3 Spatial Coordination')
```

Inside WHERE, plain names are the columns of the rows being counted; `this` is the row that owns the
formula, and `this.column` reads its columns. Write `node = this`, never `node = id`.

**Blanks**: blank counts as 0 in sums. Comparing a blank with `<`, `>`, `<=` or `>=` is always false, so
`due < TODAY()` is false while `due` is empty. `status = ''` and `ISBLANK(status)` test for blank.
Dividing by zero gives a blank.

**Dates** are text such as `'2026-09-01'`. Add or take away days with `+` and `-` (`raised + 14`); two
dates taken apart give days (`TODAY() - raised`). Compare dates with `<` and `>`.

**Functions**

| Group | Functions |
|:-|:-|
| Logic | `IF(test, then, else)`, `IFS(test1, value1, test2, value2, ...)`, `SWITCH(value, match1, result1, ..., default)`, `AND(...)`, `OR(...)`, `NOT(x)`, `ISBLANK(x)`, `IFBLANK(x, fallback)`, `COALESCE(a, b, ...)`, `BLANK()` |
| Numbers | `ROUND(x, places)`, `ROUNDUP`, `ROUNDDOWN`, `CEILING(x, step)`, `FLOOR(x, step)`, `INT`, `ABS`, `SQRT`, `POWER(x, y)`, `MOD(x, y)`, `MIN(a, b, ...)`, `MAX(a, b, ...)`, `SUM(a, b, ...)`, `AVERAGE(a, b, ...)` |
| Text | `CONCAT(a, b, ...)`, `LEN`, `UPPER`, `LOWER`, `TRIM`, `LEFT(text, n)`, `RIGHT(text, n)`, `CONTAINS(text, part)`, `VALUE(text)` |
| Dates | `TODAY()`, `DAYS(end, start)`, `YEARFRAC(start, end)`, `EDATE(date, months)`, `ADDDAYS(date, days)`, `YEAR`, `MONTH`, `DAY`, `DATE(year, month, day)` |
| Tables | `SUM`, `COUNT`, `AVERAGE`, `MIN`, `MAX` as above; `NEXTREF(table.column, 'PREFIX-', digits)` gives the next reference, such as SN-004 |
| Other | `USER()` is the name of the person using the tool |

Not available: SUMIF, COUNTIF, VLOOKUP, XLOOKUP and similar. Use `SUM(table.column WHERE ...)`,
`COUNT(table WHERE ...)` and links (`site.name`) instead.

## Checks

Rules that stop a row being saved while it is wrong. `errorIf` is a formula that is true when the row is
wrong; `message` says what to do; `field` (optional) puts the message next to that field.

```json
"checks": [
  { "errorIf": "status = 'Closed' AND ISBLANK(response)", "field": "response", "message": "Add the response before closing the comment." }
]
```

Required, unique, `min` and `max` are checked automatically; no rule is needed for them.

## onSave rules

Values filled in automatically when a row is saved, applied in order. Each sets one `field` to a fixed
`value` or a calculated `formula`, optionally only `when` a formula is true. `before.column` is the
value before this edit (blank for a new row).

```json
"onSave": [
  { "when": "status = 'Closed' AND ISBLANK(closed)", "field": "closed", "formula": "TODAY()" },
  { "when": "status <> 'Closed'", "field": "closed", "value": null },
  { "when": "NOT(ISBLANK(response)) AND ISBLANK(before.response)", "field": "status", "value": "Responded" }
]
```

## Views

Views are the tabs, in order. Without `views`, each table gets a plain table view.

**table**: a searchable, sortable list. Select a row to edit it.

```json
{ "type": "table", "title": "Snags", "table": "snags", "columns": ["ref", "area", "status", "due"],
  "sort": { "column": "ref", "dir": "asc" }, "filters": ["area", "status"], "totals": ["cost"],
  "where": "status <> 'Closed'" }
```

Optional: `columns` (default all), `sort`, `filters` (drop-down filters), `totals` (number columns),
`where`, `add: false` (no Add button), `readOnly: true`, `search: false`, `preset` (values for new
rows, such as `{ "status": "Open" }`).

**summary**: rows grouped by a column, with a bar chart and a table of totals.

```json
{ "type": "summary", "title": "Cost by area", "table": "snags", "groupBy": "area",
  "metrics": [{ "label": "Snags", "op": "count" }, { "label": "Cost", "op": "sum", "column": "cost" }],
  "where": "status <> 'Closed'" }
```

`op` is count, sum, avg, min or max. `bucket: "month"` or `"year"` groups a date column. `chart: false`
hides the chart, or `chart: 1` charts the second metric. `showTable: false` hides the table.
`sortBy: "label"` sorts groups by name.

**kpi**: headline figures. Each `formula` is a table total or other document-level formula.

```json
{ "type": "kpi", "title": "Figures", "items": [
  { "label": "Open snags", "formula": "COUNT(snags WHERE status = 'Open')", "format": "integer" },
  { "label": "Cost to fix", "formula": "SUM(snags.cost WHERE status <> 'Closed')", "format": "currency" }
] }
```

**dashboard**: several views on one tab. `blocks` holds kpi, summary, table, sheet and matrix views;
kpi blocks and blocks with `"wide": true` span the full width.

```text
{ "type": "dashboard", "title": "Overview", "blocks": [ { "type": "kpi", ... }, { "type": "summary", ... } ] }
```

**settings**: a form for the tool's settings. Optional `fields` (setting ids) and `intro` text.

**sheet**: one record at a time, with its linked rows listed underneath and a Print button. Good for
comment sheets, schedules and reports.

```json
{ "type": "sheet", "title": "Comment sheet", "table": "reviews", "fields": ["title", "stage", "due", "status"],
  "sort": { "column": "ref", "dir": "asc" },
  "child": { "table": "comments", "link": "review", "columns": ["ref", "priority", "comment", "response", "status"],
             "sort": { "column": "ref", "dir": "asc" } } }
```

`child.link` is the `ref` column in the child table that points to this view's table.

**matrix**: a cross-tab. `rows` and `columns` are columns (or formulas, often links followed with a dot)
whose values label the rows and columns. Each cell shows the metrics; select it to see the rows.

```json
{ "type": "matrix", "title": "Who reviews whom", "table": "comments", "rows": "review.reviewed",
  "columns": "review.reviewing", "where": "status <> 'Withdrawn'",
  "metrics": [{ "label": "Open", "op": "count", "where": "status IN ('Open', 'Responded')" }, { "label": "Total", "op": "count" }] }
```

## Seed: starting rows

Rows every new document starts with, such as a list of disciplines. Give a row an `id` when other seed
rows link to it. Leave calculated columns out.

```json
"seed": {
  "areas": [ { "id": "gf", "name": "Ground floor" }, { "id": "ff", "name": "First floor" } ],
  "snags": [ { "ref": "SN-001", "area": "gf", "description": "Scuffed door", "status": "Open" } ]
}
```

## Tests

Tests prove the calculations. The self-test loads each test's rows and checks the results. Give rows
an `id` so expectations can name them. Columns with a fixed `default` are filled in automatically.

```json
"tests": [
  { "name": "Overdue flag", "settings": { "dueDays": 14 },
    "tables": {
      "areas": [ { "id": "a1", "name": "Ground floor" } ],
      "snags": [ { "id": "s1", "ref": "SN-001", "area": "a1", "description": "Scuffed door", "raised": "2020-01-01", "status": "Open" } ]
    },
    "expect": [
      { "table": "snags", "row": "s1", "field": "due", "equals": "2020-01-15" },
      { "table": "areas", "row": "a1", "field": "open", "equals": 1 },
      { "table": "snags", "rows": 1 },
      { "formula": "COUNT(snags WHERE overdue = 'Overdue') = 1" }
    ] }
]
```

An expectation is `{ "table", "row", "field", "equals" }` (add `"tolerance": 0.01` for rounding),
`{ "table", "rows" }` for a row count, or `{ "formula" }` that must be true.

## Changing a tool that is in use

- Always increase `version`. Never change `id`.
- Adding a table, a column or a view needs nothing else.
- Renaming, removing or retyping a column or table changes the **shape** of stored data. Increase
  `schemaVersion` by 1 and add a migration for the new number, so files saved by the old tool upgrade
  when they are opened. Never edit or remove an existing migration.
- Add a test with `"schemaVersion"` set to the old number and rows in the old shape, to prove the
  upgrade.
- A migration must turn the same old file into the same new data wherever it is opened, so that
  copies upgraded by different people can still be combined. `TODAY()` and `USER()` cannot be used in
  migration steps. Rows that `textToRef` creates get the same id in every copy.

```json
"migrations": [
  { "to": 2, "description": "Locations become a Sites table", "steps": [
    { "op": "textToRef", "table": "assets", "field": "location", "to": "site", "target": "sites", "match": "name", "blankValue": "Unassigned" }
  ] },
  { "to": 3, "steps": [
    { "op": "renameField", "table": "assets", "from": "value", "to": "cost" },
    { "op": "setField", "table": "assets", "field": "status", "formula": "IF(disposed, 'Disposed', 'In use')", "when": "ISBLANK(status)" },
    { "op": "removeField", "table": "assets", "field": "disposed" }
  ] }
]
```

| Step | Keys | Does |
|:-|:-|:-|
| `renameField` | `table`, `from`, `to` | Renames a column in every row. |
| `removeField` | `table`, `field` | Deletes a column's values. |
| `setField` | `table`, `field`, `value` or `formula`, optional `when` | Sets a column in every row (or rows where `when` is true). Formulas here read the old row's columns only. |
| `renameTable` | `from`, `to` | Renames a table. |
| `mapValues` | `table`, `field`, `map` | Replaces values, such as `{ "Yes": "Approved" }`, for renamed options. |
| `textToRef` | `table`, `field`, `to`, `target`, `match`, optional `blankValue` | Turns free text into links: finds or creates a `target` row whose `match` column equals the text. |

A migration with `"steps": []` is fine when nothing needs converting.

## Built in to every tool

Project number and name, created by, updated by, checked by (with a data fingerprint), revisions,
undo, recovery of unsaved work, CSV import and export, printing, the saved-copy upgrade flow, and
combining copies that several people edited (More, Combine with another copy). Do not add columns
for these.

## Wording in the tool

Sentence case. Plain UK English. Button labels are verbs. Help text and check messages say exactly
what to do. No em dashes, no emoji. Never rely on colour alone.
