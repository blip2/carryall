# Create a tool with Microsoft 365 Copilot

A Carryall tool is one HTML file that holds a list of records, the screens to edit them and the
calculations. You don't write any code. Copilot writes a **tool definition** (a block of text that
describes your tables, columns, calculations and views), and the Carryall **tool builder** checks it,
lets you try it and turns it into your finished tool.

The builder does the checking that Copilot can't. If anything in the definition is wrong, it tells
you exactly what and where, and gives you the problems as text to paste back into Copilot. A few
rounds of that are normal.

## You need

- The blank template, [carryall.html](../carryall.html). Download it once and keep it somewhere handy.
- Microsoft Edge or Google Chrome.
- The **Carryall Tool Builder** agent in Copilot. If your organisation hasn't set it up, see
  [No agent? Use Copilot Chat](#no-agent-use-copilot-chat).

## 1. Plan (five minutes)

Write down, roughly:

- **What it's for**, in one sentence.
- **What you keep track of**: the lists (tables), such as *reviews* and *comments*, or *loads* and
  *distribution boards*.
- **The fields** in each list, with any fixed choices (priority: Critical, Major, Minor).
- **Links** between lists: each comment belongs to a review; each load is fed from a board.
- **Calculations**: totals, overdue flags, days open, diversity, anything added up through links.
- **What you want to see**: lists, totals by category or month, headline figures, a printable sheet,
  a cross-tab.
- **Starting rows**, if every new document should begin with some (a list of disciplines, say).

Skip project number, project name, revisions and checked by. Every Carryall tool already has them.

## 2. Describe it to Copilot

1. In Copilot, open the **Carryall Tool Builder** agent.
2. Describe your tool from your plan, and answer its questions.
3. Check the plan it proposes and ask for changes before it writes anything.
4. It replies with the tool definition in one block. Use the block's **Copy** button to copy all of it.

## 3. Check it in the tool builder

1. Open **carryall.html** in Edge or Chrome. It opens the tool builder.
2. Paste the definition into the box and select **Check definition**.
3. If it lists problems, select **Copy problems for Copilot**, paste them into the Copilot chat and
   send. Copilot replies with a corrected definition: paste that into the box (replacing the old one)
   and check again.
4. Repeat until the builder says **Ready to use**. That includes a self-test, which runs every
   calculation against the example rows Copilot included and checks the results.

The builder also quietly corrects small slips (a type written as "dropdown" rather than "choice",
say) and lists them under **Tidied automatically**. The downloaded tool uses the corrected version.

## 4. Try it and download it

1. Select **Preview the tool**. Add, edit and delete a few rows in each tab, and check the numbers.
   Nothing you enter in the preview is kept.
2. Select **Back to the builder**, then **Download**. You get your finished tool, for example
   `snagging-tracker.html`, with no data in it.
3. Open the downloaded file and choose **Start new** to start using it.

## 5. Share it

Anyone can use the file: send it, or put it on SharePoint or a file share. People open it, add their
data and select **Download** to save a copy with their data in it.

For a tool that many people use, ask whoever hosts your organisation's tools to publish it, then ask
Copilot to set `home` to its web address. Saved copies then offer to open their data in the latest
version of the tool.

## 6. Change it later

1. Open the tool and choose **More**, then **Change this tool**. The builder opens with the current
   definition.
2. Select **Copy definition**, paste it into Copilot and describe the change. If people already use
   the tool, say so.
3. Paste Copilot's new definition into the builder, check it, preview it and download the new version.
   Replace the old tool file (or the hosted copy) with it.

Copilot increases the tool's version for every change. If a change affects data people have already
saved (renaming or removing a field, say), it also adds a *migration*, so old saved files upgrade
when they are opened in the new tool. The builder warns you if a change looks like it would strand
saved data without one. Never let the tool's `id` change.

## Tips

- **Ask for a test.** The agent always includes one: a few example rows and the results it expects.
  If a calculation matters, work one example out by hand and ask Copilot to add it as a test.
- **One change at a time** is easier to check than five.
- **If Copilot keeps getting the same thing wrong**, start a new chat, paste the current definition and
  the builder's problems, and ask again.
- **What tools can do**: linked lists, calculations across links (including trees, such as loads
  adding up through distribution boards), totals, flags, dashboards, printable sheets and cross-tabs.
  **What they can't**: attachments, photos, maps, email, or more than a few thousand rows.
- The full list of what a definition can contain is in the
  [tool definition reference](../src/definition-reference.md).

---

## No agent? Use Copilot Chat

1. Start a new Copilot chat and attach [carryall-reference.md](copilot/carryall-reference.md).
2. Paste the [agent instructions](copilot/agent-instructions.md) as your first message, then add:
   *"Follow these instructions. I want to build: …"*
3. Carry on from step 2 above. Start a new chat for each tool.

## Setting up the agent (for tool owners)

In Microsoft 365 Copilot, create an agent with Agent Builder (or Copilot Studio):

| Setting | Value |
|:-|:-|
| Name | Carryall Tool Builder |
| Description | Builds Carryall tracker and calculator tools from a plain-English description. |
| Instructions | The whole of the [agent instructions](copilot/agent-instructions.md) (about 6,700 characters, under the 8,000 limit) |
| Knowledge | [carryall-reference.md](copilot/carryall-reference.md): upload it, or store it in a SharePoint folder and add that |
| Starter prompts | "Build a new tool to track…" · "Change my tool: here is its definition…" · "The tool builder found these problems…" |

The instructions hold the rules Copilot must always follow, because an agent only reads the parts of a
knowledge file that match the question. The knowledge file holds the full reference and two complete
example definitions.

Share the agent with the people who build tools. When the Carryall core is updated,
`node tools/sync-core.mjs` regenerates `carryall-reference.md`: replace the agent's knowledge file with
the new copy, and its instructions if they changed.

### Why a definition, not code

Copilot in Microsoft 365 writes its answer once and can't run it, so it can't find its own mistakes.
A definition is a small, strict format, so the builder can check every part of it and explain each
problem in words Copilot can act on. Code has too many ways to be almost right. Developers can still
write tools in JavaScript (see `AGENTS.md`), but definitions are the recommended route for everyone.
