# Create a Carryall tool with Microsoft 365 Copilot

A Carryall tool is one HTML file. You only write one part of it, the app definition
(`<script id="ca-app">`), and Copilot writes that for you. You paste it into the blank template.

## You need

- The blank template, `carryall.html`
- Microsoft Edge or Google Chrome
- The **Carryall Tool Builder** agent in Copilot. If your organisation hasn't set it up, see
  [No agent? Use Copilot Chat](#no-agent-use-copilot-chat).

## 1. Plan (five minutes)

Write down, roughly:

- **What it's for**, in one sentence
- **What you track**: the lists (tables), e.g. *reviews* and *comments*
- **The fields** in each, with any fixed choices (e.g. priority: Critical, Major, Minor)
- **Calculations**: overdue flags, totals, days open
- **What you want to see**: lists, summaries by category or month, headline figures, a printable sheet

Skip project number, project name, revisions and checked-by. Every Carryall tool already has them.

## 2. Build with the agent

1. In Copilot, open the **Carryall Tool Builder** agent.
2. Describe your tool from your plan. Answer its questions.
3. Check the plan it proposes (tables, fields, views) and ask for changes before it writes code.
4. It replies with one code block starting `<script id="ca-app">`. Copy it all.

## 3. Install

1. Open `carryall.html` in Notepad or VS Code.
2. Select from `<script id="ca-app">` down to its `</script>` (just above `</body>`) and paste over it.
3. Change the `<title>` near the top to your tool's name.
4. Save as a new file, e.g. `snagging-tracker.html`.

## 4. Test

1. Open the file in Edge or Chrome and choose **Start new**.
2. Open **More › About this file › Run self-test**. Every line should say **Pass**. If not, paste the
   failures into the agent and ask it to fix them.
3. Add, edit and delete some rows. Check every tab.
4. Select **Download**, open the downloaded copy and check your data is still there.

## 5. Change it later

Paste your current `<script id="ca-app">` block into the agent and describe the change. If the tool is
already in use, say so. The agent will bump the version and add a *migration*, so existing saved
files upgrade when they are opened. Never change the tool's `id`.

## 6. Share it

Send the file to whoever hosts your organisation's tools. Once it is hosted, ask the agent to set
`home` to its web address, so saved copies point people to the latest version.

---

## No agent? Use Copilot Chat

1. Start a new Copilot chat and attach `docs/copilot/carryall-reference.md`.
2. Paste the contents of `docs/copilot/agent-instructions.md` as your first message, then add:
   *"Follow these instructions. I want to build: …"*
3. Carry on from step 2 above. Start a new chat for each tool.

## Setting up the agent (for tool owners)

In Microsoft 365 Copilot, create an agent with Agent Builder (or Copilot Studio):

| Setting | Value |
|---|---|
| Name | Carryall Tool Builder |
| Description | Builds Carryall tracker and calculator tools from a plain-English description. |
| Instructions | The whole of [`docs/copilot/agent-instructions.md`](copilot/agent-instructions.md) (about 5,300 characters) |
| Knowledge | [`docs/copilot/carryall-reference.md`](copilot/carryall-reference.md): upload it, or store it in a SharePoint folder and add that |
| Starter prompts | "Build a new tool to track…" · "Change my tool: here is my app script…" · "My self-test failed: here are the results…" |

Share the agent with the people who build tools. When the Carryall core is updated, `node tools/sync-core.mjs`
regenerates `carryall-reference.md`. Replace the agent's knowledge file with the new copy.
