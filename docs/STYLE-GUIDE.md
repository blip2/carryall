# Web application style guide (LLM instruction file)

For agents and assistants building **web applications**: dashboards, internal tools, digital
products and client-facing platforms. Carryall's core styles implement this guide. Every Carryall
app should follow it too. Drop it into `CLAUDE.md`, `.cursorrules`, a system prompt or an agent's
instructions.

**Accessibility target: WCAG 2.1 AA+.** It overrides visual preference wherever the two conflict.

---

## 0. Precedence

When rules collide, resolve in this order:

1. **Accessibility** (WCAG 2.1 AA+, plus local law: EAA, ADA, Australian DDA)
2. **Usability**: can the intended user complete the task
3. **Visual consistency**
4. **Aesthetic preference**

Never trade 1 for 3. If a visual asset cannot be made accessible in a given context, substitute an
accessible equivalent and note the deviation.

---

## 1. Typography: sans-serif only

**Do not use Times New Roman or other serif faces in application UI.** They degrade at small sizes,
in dense data tables, in form labels and under zoom.

```css
--ca-font: Arial, "Helvetica Neue", Helvetica, system-ui, -apple-system, sans-serif;
--ca-mono: "SF Mono", Menlo, Consolas, "Roboto Mono", monospace;
```

- **Arial Regular** is the primary UI font.
- **Arial Bold** for headings, section titles, statistic numerals and chart labels. No italic.
- **Monospace** for code, IDs, job numbers, reference strings and tabular figures.
- A serif face is permitted *only* for long-form editorial reading passages (a marketing page, an
  article body). Never for UI chrome, forms, tables or navigation.

**Type rules**
- Base body size **16px minimum**. Never below 12px for any text, including captions and helper text.
- Set sizes in `rem`, never `px`, so user browser settings are respected.
- Line height 1.5 for body, 1.2 to 1.3 for headings.
- Line length 60 to 80 characters for reading passages.
- Must remain usable at **200% zoom** and reflow to a single column at 320px width without loss of
  content or function.
- Never disable user font scaling. Never set `user-scalable=no`.
- **Never use images of text.** Real text only, so it can be resized, recoloured and read aloud.
- Sentence case for headings, buttons and labels. Initial capital only, no full stop on headings.

---

## 2. Colour

### Primary

| Token | Hex | Use |
|---|---|---|
| `--ca-red` | `#e61e28` | Primary action, accent, focus |
| `--ca-black` | `#000000` | Body text |
| `--ca-white` | `#ffffff` | Surface |

### Secondary: charts, data visualisation and status only

| Order | Token | Hex |
|---|---|---|
| 1 | `--ca-red` | `#e61e28` |
| 2 | `--ca-purple` | `#7d4196` |
| 3 | `--ca-blue-dark` | `#005aaa` |
| 4 | `--ca-teal` | `#32a4a0` |
| 5 | `--ca-pink` | `#c83c96` |
| 6 | `--ca-green` | `#4ba046` |
| 7 | `--ca-blue-bright` | `#1e9bd7` |
| 8 | `--ca-sage` | `#91967d` |
| 9 | `--ca-orange` | `#e66e23` |
| 10 | `--ca-slate` | `#50697d` |
| 11 | `--ca-grey-light` | `#f1ede9` |

Use in sequence: four series use colours 1 to 4; eight series use 1 to 8.

### Measured contrast ratios (computed, WCAG 2.1)

| Foreground | On white | On black | Verdict |
|---|---|---|---|
| Red `#e61e28` | **4.58** | 4.58 | AA body text (just). Fails AAA. |
| Purple `#7d4196` | **6.84** | 3.07 | AA on white |
| Dark blue `#005aaa` | **6.90** | 3.04 | AA on white |
| Slate `#50697d` | **5.74** | 3.66 | AA on white |
| Pink `#c83c96` | **4.62** | 4.54 | AA on white (just) |
| Teal `#32a4a0` | 3.02 | **6.95** | Large text / non-text only on white |
| Green `#4ba046` | 3.27 | **6.42** | Large text / non-text only on white |
| Bright blue `#1e9bd7` | 3.12 | **6.73** | Large text / non-text only on white |
| Sage `#91967d` | 3.06 | **6.86** | Large text / non-text only on white |
| Orange `#e66e23` | 3.17 | **6.62** | Large text / non-text only on white |
| Light grey `#f1ede9` | 1.16 | 18.03 | Background only, never text |

Black on white is 21:1. White on red is 4.58:1, acceptable for a button label at 16px, but do not
set small or light-weight text in white on red.

**Hard colour rules**
- **Never convey information by colour alone.** Always pair with text, icon, pattern or position.
  A red cell in a table needs a label; a green tick needs a text state.
- Body text: `#000000` on `#ffffff`, or `#ffffff` on a dark surface. Nothing marginal.
- Teal, green, bright blue, sage and orange are **below 4.5:1 on white**. Restrict them to large
  text (24px and up, or 19px bold), icons, borders, chart fills and non-text UI.
- Non-text contrast (borders, icons, form outlines, chart series boundaries): **minimum 3:1**.
- Minimum 3px spacing between adjacent chart colours; minimum 3px line width with distinct markers
  on line charts.
- Avoid textured or photographic backgrounds behind text.
- Use **semantic colour tokens** (`--ca-danger`, `--ca-success`) mapped to the palette, not raw hex
  in components.
- Support **light and dark mode** where feasible. Users with photophobia or migraine depend on it.
- Respect `prefers-reduced-motion` and `prefers-contrast`.

---

## 3. Logos

If a tool shows an organisation's logo, use the supplied SVG. Never recreate or re-letter it. Place
it consistently in the app header on every screen. Give it `alt` text naming the organisation when
it is a meaningful link, or `alt=""` plus `aria-hidden` when it is decorative.

---

## 4. Components: use the Carryall core first

- Use the core's views, forms, dialogs, tables, pills, KPI tiles and bar charts before writing
  custom UI. They already meet this guide.
- For custom views, build with `api.h()` and the core's classes (`ca-card`, `ca-table`, `ca-btn`,
  `ca-kpi`) and CSS custom properties, so visual consistency holds.
- Where you need more (complex forms, heavy custom interaction), use an unstyled,
  accessibility-first primitive and style it with the core tokens. Don't copy a third-party visual
  language such as Material, Fluent or Human Interface wholesale.

---

## 5. Accessibility requirements

### Must have, in every application

| Requirement | Implementation |
|---|---|
| Don't rely on colour alone | Pair every colour cue with text, icon or pattern |
| Semantic coding | Real HTML elements and landmarks; `<button>` not `<div onclick>`; one `<h1>`; ordered heading levels |
| Colour contrast | 4.5:1 body text, 3:1 large text and non-text, colour-blind safe |
| Legible text and graphics | Usable at 150 to 200% zoom, no clipped or overlaid text, resizable |
| Keyboard operation | Every pointer action has a keyboard equivalent; logical focus order; visible focus ring (never `outline: none` without replacement); no keyboard traps; skip-to-content link |
| Alt text and tooltips | Every image, icon and control has an accessible name |
| Helpful error messages | Specific, actionable, programmatically associated with the field, announced to assistive tech. Not "Invalid input" |
| Accessible downloads | Tagged, structured PDFs and exports that stand alone out of context |

### Should have

- Plain language content, short sentences, common words
- Visible system status: breadcrumbs, progress, loading and saved states; controls show their state
- Responsive design via hierarchical stylesheets, reflow to a single column
- Clear navigation: headings, landmarks, multiple routes to content
- Touch and click targets **minimum 44 × 44px**
- Print and export stylesheets that survive reverse contrast
- Recognition over recall: predictable interaction, warning before context changes

### Could / nice to have

Screen reader and voice input testing · audio and video transcripts · visual guidance for complex
content · adaptive layouts · multi-language with `lang` set in markup · multi-device · light and
dark modes · external memory aids (annotate, import, export) · saved user personalisation.

### Testing

- Automated: **Lighthouse** and **WAVE**, wired into CI.
- Manual: keyboard-only traversal, screen reader pass, 200% zoom, reflow at 320px.
- Publish an **accessibility statement** in line with UK GDS requirements, stating current support,
  known gaps and alternative routes to content.
- Build accessibility in from planning. Retrofitting after development means significant refactoring.

---

## 6. UI copy

Tone is **intelligent, confident and warm**, but in an application, compressed. Users are trying
to finish a task, not read an article.

**Rules**
- Plain English. Short. `Save changes` beats `Commit your modifications`.
- Second person for the user (`your projects`), first person plural for the organisation (`we`).
  Avoid mixing `my` and `your` in the same interface; pick one and hold it.
- **Buttons are verbs**: `Export report`, `Add asset`, `Delete job`. Never `OK`, `Submit` or
  `Click here`.
- **Sentence case** for every label, button, heading, menu item and tooltip.
- Spell out acronyms on first appearance in a given view, then abbreviate.
- **Errors**: say what went wrong and what to do next. `Job number must be eight digits`, not
  `Validation failed`.
- **Empty states** do work: explain what belongs here and give the action to fill it.
- **Confirmations** name the consequence: `Delete 3 assets? This can't be undone.`
- Never blame the user. No `You failed to…`.
- Link text describes the destination. Never `here`, never a bare URL.

**Hard style rules**
- UK English `-ise` spellings. US spellings only for Americas-region deployments.
- **No em-dashes.** Spaced en dash ` – ` or a comma.
- **No Oxford commas** unless needed for clarity.
- Dates: `31 January 2014` or `31/01/14`. Day, month, year, no commas.
- Numbers: words for one to ten, numerals for 11 and above. Never open a sentence with a numeral.
  `m` = million, `bn` = billion. Use tabular figures in data tables.
- Always a space between number and unit. Use a non-breaking space so they don't split.
- Capitals for proper nouns and named individuals' titles only. Not for features, not for menu items.
- **No emoji** in product UI.
- No wordplay or puns.

---

## 7. Banned vocabulary

**Never in UI or product copy:** utilise · leverage · bespoke · cutting-edge · disruptive ·
game-changer · world-class · going forward · robust · holistic · revolutionise · seamless ·
empowering · solutions (as a catch-all) · unique · innovative (unqualified) · excellence (as a noun)

`utilise` and `leverage` mean **use**. Say use. `innovative`, `robust`, `unique` and `world-class`
mean nothing unless you immediately explain how, and if you can explain how, drop the adjective.

**Fossils to cut:** whilst, thus, regarding, in order to, as a matter of fact, very, however.

**Jargon:** acceptable where every user of the tool shares the vocabulary. In anything client-facing
or cross-discipline, expand it or explain it inline.

---

## 8. Inclusive language

Gender-neutral throughout: UI copy, documentation, code comments, variable names and seed data.

| Avoid | Use |
|---|---|
| he / she, his / her | they / their, or the entity |
| workmanship | quality of work, construction quality |
| man-hours / man-day | person-hours / person-day, staff-hours |
| manpower | staffing, resourcing, workforce |
| manned | staffed |
| chairman | chair |
| draftsman | drafter, technician |
| banksman | banksperson, spotter |
| manhole | maintenance hole, access chamber |
| Dear Sirs | Dear all, To whom it may concern |
| Mr/Miss/Mrs/Ms only | include Mx; make the title field optional |
| Male / Female only | include Non-binary / Other; M / F / X |
| master / slave | primary / replica, leader / follower |
| blacklist / whitelist | blocklist / allowlist |

Form design: never make gender or title mandatory. Support single-field names; not everyone has a
first and last name in that order.

---

## 9. AI-generated output: failure modes to suppress

- **Listing everything in threes.** The clearest tell.
- **"It's not about X, it's about Y."** Say the thing directly.
- **Over-bulleting.** Bullets only where a list genuinely helps.
- **Spurious capitalisation** of common nouns and feature names.
- **Em-dashes.**
- **Ambient equivocation**: balanced hedging where the interface should just state the fact.
- **Confident blandness**: copy that could have argued the reverse using nearly the same words.
- **Placeholder filler**: `Lorem ipsum`, invented metrics, fake client names in committed code.
- **Unverified facts and citations.** Check that any cited source or API actually exists.

**AI-generated imagery:** reject anything with malformed hands, distorted faces, the generic yellow
wash, nonsensical text or objects defying physics. Infographics must be factual and use the
palette. Prefer real photography; authenticity is what builds trust.

---

## 10. Pre-merge checklist

**Accessibility**
- [ ] Lighthouse and WAVE clean
- [ ] Full keyboard traversal, visible focus throughout, no traps
- [ ] Screen reader pass: every control has an accessible name
- [ ] Usable at 200% zoom; reflows at 320px
- [ ] No information conveyed by colour alone
- [ ] Contrast verified: 4.5:1 text, 3:1 non-text
- [ ] Targets at least 44 × 44px
- [ ] Errors specific, actionable and announced
- [ ] Accessibility statement present and current

**Visual and copy**
- [ ] Sans-serif throughout the UI; no Times New Roman
- [ ] Palette tokens only, no stray hex
- [ ] Carryall core components used where they exist
- [ ] Sentence case; buttons are verbs
- [ ] UK `-ise` spellings; no em-dashes; no Oxford commas
- [ ] No banned vocabulary
- [ ] Inclusive language in UI, docs, code and seed data
- [ ] No triplet lists, no "it's not X it's Y", no spurious capitals
