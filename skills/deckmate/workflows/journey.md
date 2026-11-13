# Produce repeated objects with a Journey

**When:** Several objects of one type need the same versioned pipeline of Tasks. **Not this:** Plan a one-off result → [plan](plan.md); execute an ordinary card → [work](work.md).
**Person:** Choose or design the Journey, map roles to decks, apply selected steps to a Hero, review returns, and approve template revisions.
**Agent:** Read the exact pipeline and step, work assigned Tasks, gather return metrics, and propose lessons and revisions.

## Steps
1. List current Journeys — `deckmate project pipelines --data <project>` ([command](../references/cli.md#pipelines)).
   → Take the exact `p-ref`, `version` and step `id`; if a p-ref was supplied, start at step 5.
2. Choose a starting point before designing another pipeline:
   - Reuse a deck Journey from step 1 when its object type and disciplines match.
   - Import a bundled or saved project template through UI / the [HTTP import recipe](../references/api.md#journeys); map every used role to a Task/Mixed deck and assign owners from the [members roster](team.md).
   - Create a Journey on an Asset/Mixed deck through the UI or [HTTP Journeys](../references/api.md#journeys); define instructions, owner, target Task/Mixed deck, effort and dependencies for every step, with priority and zones where needed.
3. Optional: preview a bundled project starter with examples — `deckmate project init <template-id> --dry --samples --data <project>` ([command](../references/cli.md#init)).
   → Inspect `items` and the sample Heroes; keep `--samples` in preview and application only when examples are wanted.
4. After approving that exact starter plan, apply it — `deckmate project init <template-id> --samples --member <you> --data <project>`.
   → Inspect `warnings` and `remaining`; this adds starter decks and Journeys rather than resetting the project.
5. Review the selected pipeline — `deckmate project pipeline <p-ref> --data <project>` ([command](../references/cli.md#pipeline)).
   → Read its canonical `id`, `version`, `deckId`, `zones` and step properties; this overview omits instruction Markdown.
6. Read one step before applying or executing it — `deckmate project step <p-ref> <step-id> --data <project>` ([command](../references/cli.md#step)).
   → Read the full `markdown`, `owner`, `deckId`, `dependsOn`, `effort`, `priority` and `zoneId`.
7. If needed, create an approved top-level Hero with `deckmate project create "<title>" --kind hero --deck <asset-or-mixed-deck-id> --member <you>` ([create](../references/cli.md#create); MCP `create_cards` is the same step); never create or change card files by hand. Check `map` warnings, then `find` for its c-ref. Apply the Journey via UI / HTTP `apply-journey` only to that Hero in its Asset/Mixed deck, selecting `stepIds` and `deckAssignments` with valid prerequisites.
   → Each selected step becomes a `not-started` child Task; `%PARENT_TITLE%` uses the Hero title. Reapplying the same Journey version preserves existing card edits and creates only missing step cards, without duplicates or launching assignees.
8. Verify the materialized family — `deckmate project show <hero-ref> --data <project>` ([command](../references/cli.md#show)).
   → Follow every `context.children[].id` with `deckmate project show <child-id> --data <project>`. Match `parentId` to the Hero's canonical ID, then check one child per selected `journey.stepId` at the applied `journey.version` and Journey ID; compare `dependsOn` with the prerequisite children's canonical IDs. Do not search the Hero title: child text need not contain it.
9. Start from the generated c-ref — `deckmate project brief <c-ref> --budget 1500 --data <project>` ([command](../references/cli.md#brief)).
   → Read the copied Task, current Journey step, template/card version difference and latest recorded return before resuming work.
10. When actively starting the Task, mark it — `deckmate project state <c-ref> started --member <you> --data <project>` ([command](../references/cli.md#state)).
   → Follow [work on a card](work.md) for Hand, questions, checks, submission to `review` and independent acceptance; assignment alone does not start an agent.
11. After returns or completed objects, read `GET /api/journey-metrics?source=sandbox&journeyId=<canonical UUID>` on the running local server ([HTTP reference](../references/api.md)).
   → Compare per-step `instances`, `accepted`, `returns`, `cycleHours`, `owners`, `actors` and `lastReturns`; use the canonical Journey `id` from `pipeline`.
12. Record a concrete lesson on the exact returned step through the UI or HTTP `add-journey-step-lesson`. It appends to `## Lessons`, changes the Journey hash without increasing its version, and does not rewrite existing Tasks.
13. After approving the specific process change, save the Journey through the UI or HTTP `update-journey`. Saving increments `version`; revised instructions, dependencies and effort affect future applications, not existing cards.

## Done when
- `show <hero-ref>` → `context.children` → `show <child-id>` confirms one Task per selected step for the applied Journey/version, with the expected canonical parent and prerequisite IDs.
- The agent used the generated c-ref, submitted evidence to `review`, and did not accept its own work; follow the [acceptance policy](review.md#acceptance-policy).
- `deckmate project step <p-ref> <step-id> --data <project>` contains the recorded lesson; after an approved revision, `deckmate project pipeline <p-ref> --data <project>` shows the new version while existing Tasks retain their copied `journey.version`.
- `GET /api/journey-metrics?source=sandbox&journeyId=<canonical UUID>` reflects the instances and returns used to justify the revision.

## Rules

Use the shared [card anatomy](../references/cards.md) for Task/Hero/Doc structure and estimates.

- Use a Journey for repeated objects and finish one integrated object before a batch — its playable result validates reuse and exposes missing steps.
- Adapt imported roles, owners and estimates to the project — portable templates leave owners unset and cannot predict the team's effort.
- Use dependencies for required input results and zones for selectable variants — visual grouping alone does not enforce prerequisites.
- Turn repeated returns into a lesson and an approved revision while retaining copied Task versions — future improvements must not silently change started work.

## Pitfalls
- `pipeline <p-ref>` has no instruction bodies → read the required `step <p-ref> <step-id>` instead of scanning every step file.
- The current template still shows `%PARENT_TITLE%` → substitution belongs in generated Tasks; the template is not rewritten.
- `brief` reports a newer template than the card → follow the assigned card's copied criteria, flag the mismatch, and do not expect `step` to reproduce its old version.
