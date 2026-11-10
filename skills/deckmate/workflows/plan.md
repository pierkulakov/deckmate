# Manage Deckmate entities — 2026-11-09
Use these rules to organize work. Change board entities through Deckmate, not raw Markdown or SQLite; `references/api.md` describes the HTTP actions used by this skill. API action names are not CLI commands. Create or change cards only after approval of the specific list.

## Read and initialize
- If a c-ref was supplied, begin with `brief <c-ref> --budget 1500`. Use `map` to get deck and Track IDs and `find --deck <id> --fields brief --limit 100` for a bounded inventory. Prefix all commands as in `workflows/work.md` with explicit `--data <project>`.
- To add starter decks, `init` lists template IDs; `init <template-id> --dry` previews changes, and `init <template-id> [--samples] --member <you>` applies them after approval. Keep `--samples` in the preview too if example Heroes are intended. This is `deckmate project init`, not `deckmate init <folder>` (which creates a demo in an empty folder). Applying a starter is additive, not a reset; inspect warnings and `remaining` before retrying.

## Card
- Keep the card as the source of truth for work: state, properties, and conversations belong to it, not its column.
- Give each Task one verifiable result: Visible / Work / Done, numeric tolerances, and a check command. Fill gaps before assigning it.
- For a prototype, name one hypothesis, the cheapest observable test, and success and stop criteria; a second iteration requires evidence from the first.
- Triage player or playtest feedback with the project owner before adding delivery scope; preserve the source and observed behavior, and report the decision or outcome back to the author.
- Assign one owner to each card: the person responsible for the next action or goal. For two assignees, use a Hero with a child card per assignee or a review handoff.
- Use owner for someone who needs all content changes: owners receive all changes by others, while watchers receive only major events.
- Turn a checklist item into a child card when it needs its own assignee or verification.
- Read the mechanic's rule before implementation. Put a native Task under its rule Doc when it needs `ask` to route questions there; a prose link alone is not a structural rule relationship. Copies drift. Use the project's own principles, not Deckmate repository documents.

## Deck, tags, and Track
- Use GDD for game objects (Asset decks and Heroes), Tasks for work by discipline, Knowledge for Docs, and Mixed for any kind.
- Shape decks around the team and game; use templates as inspiration, not prescriptions.
- Split decks with hundreds of cards into subareas; merge decks with fewer than 10 cards.
- Put a card in zero or one deck. A mechanic file is not a deck; use Track for a theme across decks.
- Give each deck a description of what belongs in it; use its template defaults for text, owner, effort, and priority without overwriting explicit card values. Auto Tag is separate deck automation.
- Use tags for topics across decks, Runs, and milestones. Do not replace a deck, Track, Run, or milestone with a tag; there is no separate admin permission enforced by Deckmate.

## Hero and Doc
- Start with the game result: an object or system. Use tasks to explain how to deliver it.
- Use a Hero for a result requiring several independent Tasks; use one Task for one check. Heroes have no Task workflow: completion is derived from eligible child Tasks; a native Hero without them can be marked done manually.
- A Task/Doc can be a child of one active top-level Hero or Doc. Do not nest Heroes or give a child its own children. A Task under a rule Doc cannot also be a Hero's child; use a link for the other relationship. Give child cards their own owners and Runs.
- Use a Doc for a rule or reference without a workflow state. Keep Docs small. A rule Doc that needs Decision Tasks must stay top-level; a Doc under a Hero cannot receive those children.
- Resolve the governing rule Doc's open design questions before starting downstream asset production; use a prototype Task to answer them instead of producing final assets.

## Journey
- Use a Journey when the same work repeats for objects of one type; do not turn a one-off card into a Journey. It belongs to an Asset/Mixed deck and applies to an existing top-level Hero in that deck, not a Doc. Each selected step creates a Task; assignment does not launch a model.
- Give each step instructions, an owner, a target deck, and effort; add dependencies only when a step needs another result.
- Use zones to distinguish required steps from optional variants; in preview select only steps needed for this object and keep their dependencies valid.
- For a missed step or repeated return, revise the Journey and record the step's lessons in `## Lessons` (legacy `## Грабли`); the revision does not change existing cards. Adding a lesson changes the Journey hash, not its version.
- Refine step effort from completed instances; estimates become reliable after 10 objects of that type.
- Get p-refs and step IDs from `pipelines`. Give the assignee `step <p-ref> <step-id>`, not the `pipeline <p-ref>` overview. Compare the current template version with the assigned Task's copied version.

## Effort and priority
- Set effort on every Task, using 0 for trivial work: empty effort is counted as 1, which hides scope.
- Estimate effort relatively: compare with an accepted card of the same type and estimate disciplines separately; keep a project tag on reference cards used as baselines.
- Forecast each object type and discipline from remaining effort and accepted effort per Run; recalculate at every Run boundary and cut lower-priority scope when the forecast misses its milestone.
- If work exceeds the assignee's capacity for one Run, split it under a Hero by verifiable results; there is no universal hours threshold.
- Read priority `high / medium / low` as required / medium / bonus for delivery.

## Runs and milestones
- Follow the commitment path: deck → milestone → Run → hand → `started` (in progress); small teams may move directly from deck to hand.
- Prefer a one-week Run unless the project uses another cadence; Deckmate also supports other durations. Use YYYY-MM-DD dates. Give each card at most one Run and one milestone; use a Hero with child cards for work spanning several.
- Before a Run, record one observable goal and check each owner's card count and total effort against capacity. Detail only the next Run; keep later work at Hero or milestone level until new evidence arrives.
- At Run end, reconcile accepted and carried-over cards and record carryover reasons. Treat repeated carryover as evidence of excess scope or poor splitting, not assignee blame.
- Review the Run goal and previous improvement actions; propose at most three new improvement Tasks, each with one owner and verification, and carry unfinished actions into the next review.
- Use accepted effort from past Runs as capacity; it becomes reliable after 3–4 Runs. If scope exceeds capacity, explicitly reduce scope or complexity instead of relying on carryover.
- Use a milestone for a release, delivery, or production phase. Assign child cards explicitly when they share the Hero's milestone; do not assume inheritance from the parent.
- For a fixed-date milestone, inventory its required Heroes and plan backward with integration and stabilization as explicit scope; for a release, include launch and post-release support and reserve time for late fixes.
- Use a card due date for a one-off deadline with an explicit owner; use a milestone for many cards or unclear ownership.
- Complete one object or a small batch through the full pipeline into the integrated, playable build before starting mass production; use it to measure pace.

## Dependencies and Blocked
- Replace “waiting” with a dependency on a specific card; keep independent steps parallel.
- Although dependency warnings can be bypassed in some operations, wait until every prerequisite is `done` (accepted); `next` excludes unaccepted or missing dependencies.
- Blocked is calculated from missing/unaccepted dependencies, not a stored state. Record a recipient, question, and unblock condition through `ask`; there is no block/unblock command or automatic restoration of a previous state.

## Hand
- Use Hand for what to do next, Run for the coming weeks, and decks for possibilities.
- Keep hands short; many teams use 3–5 cards. Finish started work before refilling.
- Keep Hand and owner separate: a card in a hand neither assigns its owner nor launches an agent. Add it to an explicit registered member's Hand through the UI, then use `next <member>`.

## Review and Guardians
- Use `started` only while someone is actively working on the card; ask whether stale started work is still active.
- Use Review for feedback or approval; leave review and return to work for substantial revisions.
- The assignee submits to `review`; the reviewing agent checks technical tolerances, and the human project owner decides acceptance and appearance. Deck guardians are configured registry members, not automatically the human owner; only they may accept when configured. The CLI does not enforce human-only or independent acceptance in a deck without guardians: follow this workflow regardless.
- Do not treat an agent report as `done` or accept your own work. CLI return: `state <c-ref> started --member <reviewer> --reason "<required, actual; fix>"`; use a one-line reason of at most 500 characters. Acceptance by an authorized independent reviewer after the human decision: `state <c-ref> done --member <reviewer>`.

## Open questions and decisions
- Keep each open rule question as a separate item in the top-level rule Doc's `## Open questions` (legacy `## Открыто`) section.
- Ask through CLI `ask <c-ref> "<question>" --member <you> --to <human-ID>`. `raise-decision` and `record-decision` are HTTP actions, not CLI commands; the latter records the human's answer in `## Decided` (legacy `## Решено`) and accepts the Decision Task. See `references/api.md`.
- End each conversation with an explicit decision; keep different card questions in separate conversations.

## Cleanup
- Start with filters: no owner, no milestone, not in a Run, Blocked, stale, or long in `review`.
- Apply bulk changes only to the filtered set. Archive excess cards; restore deleted cards individually.
