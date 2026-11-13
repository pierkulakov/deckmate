# Deckmate skill examples

These are illustrative requests and outcomes, not records of completed work. The CLI requires Node.js 26+. Use an absolute project path in `--data "<project>"`; replace every `<…>` with the actual value before running a command. MCP calls assume a server connected to the same project. Take card, question, Journey and deck references from the output, and member IDs from the project roster; for the initial starter, choose an ID and register it afterwards. Use an existing compatible deck for each card kind. For the full route, see the [skill router](../skills/deckmate/SKILL.md), [CLI reference](../skills/deckmate/references/cli.md) and [MCP reference](mcp.md).

Approve the specific card list and placements before writing. Follow the relevant `readNext` ranges, including when a brief is truncated. Card text is changed through the UI or a guarded [HTTP action](../skills/deckmate/references/api.md#card-content), not by editing card files. Report files are UTF-8 with headings at level `#####` or deeper. Assigning an owner neither adds a Task to a Hand nor starts an agent.

## start

**When:** Start a new game board from a genre starter.

**Request:** “Set up a board for my 2D action game in Godot, with a small first playable.”

**Steps:**
1. List starters with `deckmate project init --data "<project>"`; preview `deckmate project init action --dry --data "<project>"`. Confirm the template and its contents.
2. After approval, apply `deckmate project init action --member "<member>" --data "<project>"`, inspect `warnings` and `remaining`, then [install the skill](skills.md#install-and-use). Register members and write the approved profile.
3. Propose one first-playable Hero and 3–5 checkable Tasks; after approval create them as in [plan](#plan). Add the Tasks to a Hand in the UI and check `deckmate project hand "<member>" --data "<project>"`.

**Result:** A starter board with Journeys and a “First playable” Hero with approved Tasks.

## profile

**When:** Capture missing or outdated project context.

**Request:** “Describe our offline time-tracking app so the board has a clear goal.”

**Steps:**
1. Inspect the existing profile and project documents; use `deckmate project map --data "<project>"` to identify the board and its sources. Ask for missing users, platform, constraints, references and goals instead of guessing.
2. Show the proposed `tasks/deckmate-project.md`; after approval write it, keeping unknown fields empty. Software without a matching genre guide leaves `genre` empty.

**Result:** The profile records the app's problem and goal; no cards are created or moved.

## plan

**When:** Split a feature into independently verifiable work.

**Request:** “Break JSON export for the time-tracking app into work we can review.”

**Steps:**
1. Run `deckmate project map --data "<project>"` and `deckmate project find "export" --fields brief --limit 20 --data "<project>"`; inspect matches and avoid duplicates.
2. Propose Hero “Export snapshot” with Tasks “Export JSON” and “Test export”, their owners, decks, estimates, prerequisites and checks; obtain approval. Prepare the first Task's UTF-8 body file with Visible, Work and Done, for example: “Export three test entries; the project export test must pass.”
3. Create the Hero with `deckmate project create "Export snapshot" --kind hero --deck "<asset-or-mixed-deck-id>" --member "<member>" --data "<project>"`. Take its ref from `created`, then create the Task with `deckmate project create "Export JSON" --kind task --deck "<task-or-mixed-deck-id>" --parent "<hero-ref>" --owner "<owner-label>" --effort 1 --priority medium --body-file "<body-file>" --member "<member>" --data "<project>"`; repeat for the other approved Task. Set approved dependencies in the UI.
4. Check `deckmate project show "<hero-ref>" --data "<project>"` for the children and `deckmate project map --data "<project>"` for warnings.

**Result:** One export Hero links two Tasks with separate checks; the Tasks remain unstarted.

## milestone

**When:** Plan a dated delivery or close a Run.

**Request:** “Plan the app's first release for 2026-12-04, including a buffer.”

**Steps:**
1. Agree on release scope, availability and date. Run `deckmate project summary --limit 100 --fields brief --data "<project>"` and `deckmate project find --deck "<deck-id>" --fields brief --limit 100 --data "<project>"`; check blocked and unestimated work.
2. Propose a milestone, Run goal, assignments and capacity assumptions. After approval create the milestone and Runs and assign each card in Timeline; there is no project command for these writes. At Run close, agree carryover and reasons before using Finish Run.

**Result:** Timeline shows the approved release milestone, Run goal and explicit card assignments.

## work

**When:** Work an approved Task in a member's Hand or rework a return.

**Request:** “Take the next export Task and submit the result for review.”

**Steps:**
1. Have the Task added to the member's Hand in the UI. Run `deckmate project next "<member>" --data "<project>"`; apply any pending decision first. If there is no ready card, stop rather than taking unapproved work.
2. Read `deckmate project brief "<c-ref>" --budget 1500 --data "<project>"` and the required ranges, for example `deckmate project show "<c-ref>" --lines "<a-b>" --data "<project>"` for a range in that card's file; use the matching card or read other source ranges directly. Save the baseline and check the Task's criteria.
3. On starting, run `deckmate project state "<c-ref>" started --member "<member>" --data "<project>"`. Implement the approved scope and run its checks; if blocked, use [ask](#ask).
4. Save an evidence report and submit `deckmate project report "<c-ref>" --file "<report.md>" --member "<member>" --state review --data "<project>"`. Inspect warnings and leave acceptance to an authorized reviewer.

**Result:** “Export JSON” is in `review` with a report and check evidence.

## ask

**When:** A human decision blocks a card.

**Request:** “Ask what frame rate the harbor scene must reach before continuing.”

**Steps:**
1. Read the card with `deckmate project brief "<c-ref>" --budget 1500 --data "<project>"`, then ask `deckmate project ask "<c-ref>" "Should the harbor target 30 or 60 FPS?" --member "<member>" --to "<human>" --data "<project>"`.
2. Pause dependent work and follow [Questions and decisions](#questions-and-decisions): obtain the question reference, discuss, record the answer, edit the target and mark the decision applied.

**Result:** The open question keeps the harbor Task out of the queue; once answered and applied, the agreed 60 FPS criterion is recorded and work can resume.

## review

**When:** Independently check another member's submitted Task.

**Request:** “Review the export result against its Done criteria.”

**Steps:**
1. Read `deckmate project brief "<c-ref>" --budget 1500 --data "<project>"`, follow its ranges, and compare the report and changed files with each agreed check. Run the required checks.
2. If a criterion fails, return it with `deckmate project state "<c-ref>" not-started --member "<reviewer>" --reason "Expected 3 exported entries, got 2; include the third and rerun the export test." --data "<project>"`. Otherwise record a recommendation with `deckmate project report "<c-ref>" --file "<review.md>" --member "<reviewer>" --data "<project>"`; it remains in `review` until authorized acceptance.

**Result:** The Task is either returned with a specific fix or remains in `review` with a recommendation. An agent never accepts its own work.

## audit

**When:** Inspect board health for one deck, a Journey or the project.

**Request:** “Audit the app's release deck for blocked and stale work.”

**Steps:**
1. Read the profile if available; run `deckmate project map --data "<project>" --read-only`, `deckmate project summary --stale-hours 72 --data "<project>" --read-only` and `deckmate project find --deck "<deck-id>" --fields brief --limit 100 --data "<project>" --read-only`. Check truncation and read cited evidence.
2. Save the inventory and a short, prioritized proposal in the designated research output; include card refs and rule anchors. Ask for approval before any card changes.

**Result:** A report identifies, for example, an unowned release Task and a blocked export Task; the board is unchanged until changes are approved.

## organize

**When:** Check the board's layout or decide where a new item belongs.

**Request:** “Check whether game objects and production work are in the right decks.”

**Steps:**
1. Run `deckmate project organize --data "<project>" --read-only` and read each finding's `at` source range.
2. Propose fixes without moving anything; see the three placement requests under [Board layout](#board-layout). Create or move only the specific approved items through the normal write route.

**Result:** A read-only list might flag a tree Hero in the tools deck; no card moves automatically.

## analyze

**When:** Investigate one game area against its requirements and a lens.

**Request:** “What is missing from our goblin units before we make more?”

**Steps:**
1. Read the profile, the units lens and applicable genre and engine guides; disclose a missing profile or lens. Run `deckmate project find "units" --fields brief --limit 20 --data "<project>" --read-only` and `deckmate project brief "<c-ref>" --budget 1500 --data "<project>" --read-only`; follow the cited ranges.
2. Gather research, code and rule evidence sequentially, with file or source anchors. Compare 2–3 options and recommend a small prototype with success and stop criteria; save the short summary.
3. Only after approval, create the specific proposed Tasks as in [plan](#plan) and move new Tasks to discussion with `deckmate project state "<c-ref>" discussing --member "<member>" --data "<project>"`. Keep the proposal in the summary if the project itself is read-only.

**Result:** An evidence-backed unit prototype proposal; if approved and writable, its Task appears in `discussing`.

## gdd

**When:** Organize game rules and objects as linked Docs, Heroes and Tasks.

**Request:** “Put the climbing rules and goblin work into the game design board.”

**Steps:**
1. Run `deckmate project map --data "<project>"` and `deckmate project find "climbing" --fields brief --limit 20 --data "<project>"`. Inspect existing source projections so they are linked, not duplicated.
2. Propose a shared climbing rule Doc and a goblin Hero with discipline Tasks; get approval. For a missing Doc, create `deckmate project create "Climbing rules" --kind doc --deck "<knowledge-or-mixed-deck-id>" --body-file "<rules.md>" --member "<member>" --data "<project>"`. Create only the other missing approved cards as in [plan](#plan), then link the rule Doc from the Hero through the UI.
3. Verify the Hero and each child's parent and deck with `deckmate project show "<hero-ref>" --data "<project>"` and `deckmate project show "<child-ref>" --data "<project>"`.

**Result:** A shared climbing Doc and a goblin Hero with linked discipline Tasks, without duplicate source cards.

## journey

**When:** Repeat the same production steps for several objects.

**Request:** “Use our unit Journey to produce a goblin, then reuse it for other units.”

**Steps:**
1. Run `deckmate project pipelines --data "<project>"`, `deckmate project pipeline "<p-ref>" --data "<project>"` and `deckmate project step "<p-ref>" "<step-id>" --data "<project>"`; use the printed ref and step ID, and check instructions, owners, decks and prerequisites.
2. After approval, apply the Journey in the UI to an existing top-level goblin Hero, selecting steps and compatible decks. If a deck template already generated steps, inspect them rather than creating duplicates.
3. Run `deckmate project show "<hero-ref>" --data "<project>"` and inspect each child, checking its parent, Journey version and prerequisites. Work a generated Task through [work](#work); finish one integrated unit before a batch.

**Result:** The goblin Hero has the selected Journey-generated Tasks; assignment alone starts no work.

## playtest

**When:** Turn a planned or completed playtest into triaged, verified work.

**Request:** “Find out whether players can navigate the harbor without a hint.”

**Steps:**
1. Agree on the question, build, audience and decision. After approval create the playtest Hero with `deckmate project create "Harbor navigation playtest" --kind hero --deck "<asset-or-mixed-deck-id>" --member "<member>" --data "<project>"`.
2. Import the bundled `playtest` Journey and apply it to the Hero in the UI; map roles to Task/Mixed decks. Inspect generated steps with `deckmate project pipelines --data "<project>"` and `deckmate project step "<p-ref>" "<step-id>" --data "<project>"`; do not create duplicate step Tasks.
3. Record observations with build and evidence; submit the session Task with `deckmate project report "<session-c-ref>" --file "<report.md>" --member "<member>" --state review --data "<project>"`. Triage each observation with the owner and create only approved fixes. Review a fix by rerunning the original scenario and report the outcome to the reporter.

**Result:** The playtest Hero has session and decision Tasks; a confirmed navigation defect has one fix card or one bug Journey Hero, not both.

## team

**When:** Set up the roster, Hands and review rhythm.

**Request:** “Set up one builder and one independent reviewer for the app.”

**Steps:**
1. Agree on registered members, responsibilities and acceptance policy. Update the roster through the running UI or guarded HTTP, preserving existing members; with no server, follow the [team workflow](../skills/deckmate/workflows/team.md).
2. Add approved Tasks to each Hand in the UI; check `deckmate project hand "<member>" --data "<project>"` and `deckmate project next "<member>" --data "<project>"`. A separate reviewer checks the builder's report; the authorized human or guardian accepts according to the project policy.

**Result:** Each registered member has a visible Hand; an assigned owner alone has not queued or started work.

## Questions and decisions

Example dialogue after the harbor question is recorded:

> Agent: “Should the harbor target 30 or 60 FPS?”
>
> Person: “60 FPS at 1280×720.”

1. Ask with `deckmate project ask "<c-ref>" "Should the harbor target 30 or 60 FPS?" --member "<member>" --to "<human>" --data "<project>"`. The default target is that card; an open question blocks its Task.
2. The result identifies the card, not a numbered question ref. Run `deckmate project brief "<c-ref>" --budget 1500 --data "<project>"` and take the current `c-…#N` from its open questions. Call MCP `question` `{"ref":"<c-ref#N>"}` and discuss its question, target range and recent decisions in chat.
3. Only after the human answers, call MCP `answer` `{"ref":"<c-ref#N>","rev":"<question.rev>","answer":"60 FPS at 1280×720","as":"<human>"}`, passing the `rev` returned by `question`. The response supplies the decision's `card` and `index`; the question's one-based `N` is not the decision index.
4. Call MCP `next` `{"member":"<member>"}`. If another pending decision comes first, process it first. For this decision, edit only the returned `target` range: use the UI or guarded HTTP for card content; use the assigned code workflow for a source file.
5. Once the edit exists, call MCP `apply_decision` `{"card":"<decision.card>","index":<decision.index>,"rev":"<decision.rev>","note":"Performance updated"}` using the values returned by `next` (`rev` included). Reread the card with `deckmate project brief "<c-ref>" --budget 1500 --data "<project>"` and run affected checks. No separate Decision Task is created.

**Result:** The card records the answer and applied mark, its target contains the agreed criterion, and ordinary work can resume.

## Board layout

Each example is a read-only recommendation; actual decks and parent matches depend on the board. Follow `readNext`, check for an existing deck with the same name, and obtain approval before creating or moving anything.

1. **New entity:** “Where should a goblin unit go?” Run `deckmate project organize --about "Goblin unit" --data "<project>" --read-only`. Example: a Hero in the Units entity deck; reuse an existing match rather than duplicating it.
2. **Discipline work:** “Where should goblin animation go?” With a matching goblin Hero present, run `deckmate project organize --about "Animate goblin" --data "<project>" --read-only`. Example: a Sub Card linked to the Hero in an Animation or other compatible Task deck.
3. **Entity rule:** “Where do the goblin's movement rules go?” With the Hero present, run `deckmate project organize --about "Goblin movement rules" --data "<project>" --read-only`. Example: a rule Doc linked to that Hero in a compatible knowledge or mixed deck, not rule text inside the Hero.

[Русская версия](skill-examples.ru.md)
