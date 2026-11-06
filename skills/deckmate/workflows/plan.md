# Manage Deckmate entities — 2026-11-05
Each row gives a rule and, where the repo spells it out, a reference to its file. For entity definitions, see “Model” in `docs/catalog.md`; use this workflow to organize work.

## Card
- Keep the card as the source of truth for work: state, properties, and conversations belong to it, not its column.
- Give each Task one verifiable result: Visible / Work / Done, numeric tolerances, and a check command. Fill gaps before assigning it. See `docs/catalog.md`.
- For a prototype, name one hypothesis, the cheapest observable test, and success and stop criteria; a second iteration requires evidence from the first.
- Triage player or playtest feedback with the project owner before adding delivery scope; preserve the source and observed behavior, and report the decision or outcome back to the author.
- Assign one owner to each card: the person responsible for the next action or goal. For two assignees, use a Hero with a child card per assignee or a review handoff.
- Use owner for someone who needs all content changes: owners receive all changes by others, while watchers receive only major events.
- Turn a checklist item into a child card when it needs its own assignee or verification.
- Read the mechanic's rule before implementation. Link a Task to its rule Doc; copies drift. See “Product Principles” in `PRODUCT.md` and `docs/catalog.md`.

## Deck, tags, and Track
- Use GDD for game objects (Asset decks and Heroes), Tasks for work by discipline, Knowledge for Docs, and Mixed for any kind.
- Shape decks around the team and game; use templates as inspiration, not prescriptions.
- Split decks with hundreds of cards into subareas; merge decks with fewer than 10 cards.
- Put a card in zero or one deck. A mechanic file is not a deck; use Track for a theme across decks. See “Model” in `docs/catalog.md`.
- Give each deck a description of what belongs in it; use a deck's Template Card for a new card's text, owner, and tag without overwriting explicit card values. See `docs/catalog.md`.
- Use tags for topics across decks, Runs, and milestones; an admin maintains project tags. Do not replace a deck, Track, Run, or milestone with a tag. See “Model” in `docs/catalog.md`.

## Hero and Doc
- Start with the game result: an object or system. Use tasks to explain how to deliver it.
- Use a Hero for a result requiring several independent tasks; use one Task for one check. See `docs/catalog.md`.
- Put a child card under one Hero; do not nest Heroes. Give child cards their own owners and Runs.
- Use a Doc for a rule or reference without a workflow state. Keep Docs small and link them under a Hero.
- Resolve the governing rule Doc's open design questions before starting downstream asset production; use a prototype Task to answer them instead of producing final assets.

## Journey
- Use a Journey when the same work repeats for objects of one type; do not turn a one-off card into a Journey. See `docs/catalog.md`.
- Give each step instructions, an owner, a target deck, and effort; add dependencies only when a step needs another result.
- Use zones to distinguish required steps from optional variants; in preview select only steps needed for this object and keep their dependencies valid.
- For a missed step or repeated return, revise the Journey and record the step's lessons; the revision does not change existing cards. See “Journey lessons and metrics” in `docs/catalog.md`.
- Refine step effort from completed instances; estimates become reliable after 10 objects of that type.
- Give the assignee `step <p-ref> <step-id>`, not the `pipeline` overview. See “SQLite, short references, and the agent interface” in `docs/catalog.md`.

## Effort and priority
- Set effort on every Task, using 0 for trivial work: empty effort is counted as 1, which hides scope.
- Estimate effort relatively: compare with an accepted card of the same type and estimate disciplines separately; keep a project tag on reference cards used as baselines.
- Forecast each object type and discipline from remaining effort and accepted effort per Run; recalculate at every Run boundary and cut lower-priority scope when the forecast misses its milestone.
- If work exceeds the assignee's capacity for one Run, split it under a Hero by verifiable results; there is no universal hours threshold. See `docs/catalog.md`.
- Read priority `high / medium / low` as required / medium / bonus for delivery.

## Runs and milestones
- Follow the commitment path: deck → milestone → Run → hand → `started` (in progress); small teams may move directly from deck to hand.
- Use a one-week Run with YYYY-MM-DD dates. Give each card one Run and one milestone; use a Hero with child cards for work spanning several. See `docs/catalog.md`.
- Before a Run, record one observable goal and check each owner's card count and total effort against capacity. Detail only the next Run; keep later work at Hero or milestone level until new evidence arrives.
- At Run end, reconcile accepted and carried-over cards and record carryover reasons. Treat repeated carryover as evidence of excess scope or poor splitting, not assignee blame. See `docs/catalog.md`.
- Review the Run goal and previous improvement actions; propose at most three new improvement Tasks, each with one owner and verification, and carry unfinished actions into the next review.
- Use accepted effort from past Runs as capacity; it becomes reliable after 3–4 Runs. If scope exceeds capacity, explicitly reduce scope or complexity instead of relying on carryover.
- Use a milestone for a release, delivery, or production phase; a Hero's milestone passes to its child cards.
- For a fixed-date milestone, inventory its required Heroes and plan backward with integration and stabilization as explicit scope; for a release, include launch and post-release support and reserve time for late fixes.
- Use a card due date for a one-off deadline with an explicit owner; use a milestone for many cards or unclear ownership.
- Complete one object or a small batch through the full pipeline into the integrated, playable build before starting mass production; use it to measure pace.

## Dependencies and Blocked
- Replace “waiting” with a dependency on a specific card; keep independent steps parallel.
- Although dependency warnings can be bypassed, require the assignee to wait until every prerequisite is `done` (accepted). See `docs/catalog.md`.
- Use Blocked for a conversation with someone who can remove the obstacle: recipient, question, and unblock condition. Unblocking restores the previous state.

## Hand
- Use Hand for what to do next, Run for the coming weeks, and decks for possibilities.
- Keep hands short; many teams use 3–5 cards. Finish started work before refilling. See “Hand” in `docs/catalog.md`.
- Keep Hand and owner separate: a card in a hand neither assigns its owner nor launches an agent. Give an agent an explicit hand and `next <member>`. See “Hand” in `docs/catalog.md`.

## Review and Guardians
- Use `started` only while someone is actively working on the card; ask whether stale started work is still active.
- Use Review for feedback or approval; leave review and return to work for substantial revisions.
- Allow only the guardian to close a card directly; others submit for review. The guardian is the human project owner, who accepts the result and appearance; the reviewing agent checks technical tolerances, and the assignee submits to `review` (review). See `docs/catalog.md`.
- Do not treat an agent report as `done`. Supply `returnReason` when leaving `review` without acceptance. See `docs/api.md`.

## Open questions and decisions
- Keep each open rule question as a separate item in the rule Doc's `Open questions` (Open) section. See “Open rule questions” in `docs/catalog.md`.
- Ask a human through a `Decision: …` (Decision) task (`raise-decision`, or `ask` for agents); record the answer with `record-decision`, which moves it to `Решено` (Resolved). See “Open rule questions” in `docs/catalog.md`.
- End each conversation with an explicit decision; keep different card questions in separate conversations.

## Cleanup
- Start with filters: no owner, no milestone, not in a Run, Blocked, stale, or long in `review`.
- Apply bulk changes only to the filtered set. Archive excess cards; restore deleted cards individually.
