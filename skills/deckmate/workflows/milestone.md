# Plan a milestone and close a Run

**When:** A person needs a dated delivery, launch plan, Run plan or Run close. **Not this:** Cutting one feature into cards → [plan](plan.md).
**Person:** Sets the delivery outcome, date, capacity, scope and carryover choices; approves changes.
**Agent:** Inventories work and evidence, drafts the schedule, reconciles the Run and checks saved assignments.

## Steps
1. Agree on the milestone outcome and date, available people and time, and the release audience. Plan backward with integration, stabilization, launch communication, distribution, late fixes and post-release support as applicable.
2. Read `tasks/deckmate-milestones.md`, `tasks/deckmate-runs.md` and `tasks/deckmate-card-options.md` when present. Run [summary](../references/cli.md#summary): `deckmate project summary --limit 100 --fields brief --data <project>`.
   → It gives project or Track counts, owners, states and bounded groups including blocked work, not a Run/milestone filter or capacity forecast. Inspect each group's `total` and `truncated`.
3. Inventory candidates and estimates by deck with [find](../references/cli.md#find): `deckmate project find --deck <deck-id> --fields brief --limit 100 --data <project>`.
   → Compare each card's effort, owner, priority, Run and milestone; if the limit is reached, narrow the search or use the UI. Use Timeline for a complete Run or milestone scope and its statistics.
4. Propose the required Heroes and Tasks, a fixed Run cadence and one observable goal for the next Run. Forecast by discipline from accepted effort and availability, leaving buffer. Without a past Run, label capacity as an assumption agreed with the person, plan a smaller calibration Run, and revisit after its first close; detail later Runs only as evidence permits.
5. Show the dated milestone, launch scope, Run goals, assignments, assumptions and cuts. Compare each card's due date with its proposed Run dates and delivery date; ask before moving conflicting dates. Obtain approval of all changes; create new cards using [plan](plan.md).
6. In Timeline, create the milestone and Run schedule, then set each Run's goal and assign approved cards to their Run and milestone. Alternatively use the guarded HTTP planning actions and card-options edits described below; there is no CLI command to create or finish a Run or milestone.
7. At the Run boundary, inventory accepted and unfinished cards in Timeline, record carryover reasons and check the goal and previous improvement actions. Agree which unfinished cards to carry; use **Finish Run** for an early close or the schedule's configured carryover at its boundary. Record what moved and what stayed; automatic carryover does not record the team's reasons.
8. Propose at most three improvement Tasks, each with an owner and a check; carry unfinished improvements into the next retrospective. Get approval before creating or changing them. Recalculate the forecast and explicitly cut or simplify lower-priority scope if it exceeds capacity.
9. Verify assignments with [find](../references/cli.md#find) and the milestone/Run views in Timeline. Check accepted work with `deckmate project find --state done --fields brief --limit 100 --data <project>`; match its `run` and `milestone` values and use Timeline if the result reaches the limit.

## Files and writes
- `tasks/deckmate-milestones.md` has YAML front matter with `schema: 1` and a `milestones` list: each entry has `id`, `title`, `date` and `color`. Dates are `YYYY-MM-DD`; color is `#RRGGBB`.
- `tasks/deckmate-runs.md` has `schema: 1`, a `runs` list and optional `configurations`. Each Run has `id`, `number`, `start`, `end` and `goal`; start must precede end. Scheduled Runs also have `configurationId`. A configuration records cadence, finish time, time zone and carryover choices. Timeline creates schedules and manages generated dates and completion statistics.
- `tasks/deckmate-card-options.md` has `schema: 1` and a `cards` map keyed by canonical card IDs. Its `run` and `milestone` values are registry IDs, not titles; these properties do not belong in native card front matter.
- Manual file edits can be read, but unguarded shared-registry edits bypass conflict and lifecycle handling. Prefer the UI or [HTTP planning](../references/api.md#runs-and-milestones); `/api/catalog` uses `bulk-edit-cards` with `"change": {"kind":"options", "patch":{"run":"<run-id>", "milestone":"<milestone-id>"}}` for assignments, with fresh card, manifest and options hashes. Apply tags in the UI only in this workflow: `options.patch.tags` is rejected. Inspect saved warnings before retrying.
- A writable running server advances scheduled Runs at their boundary and carries the configured review / blocked / other groups. CLI reads do not advance a schedule. A finished scheduled Run keeps a frozen snapshot; a legacy standalone Run does not create one on Finish.

## Done when
- The approved milestone, launch tasks, Run goals and explicit card assignments are visible in Timeline and agree with the files and CLI results.
- The closed Run has a recorded goal comparison, carryover decisions and reasons, and at most three approved improvement Tasks; the next plan reflects available capacity and any scope cut.

## Rules
- Use a milestone for a shared delivery or production phase; a card has at most one Run and one milestone, and children need explicit assignments — parent values do not propagate.
- Keep a stable cadence, normally one week unless the project uses another, and one observable Run goal — a consistent interval makes comparison useful.
- Use accepted effort from past Runs as a capacity guide, adjusted for availability; treat the first 3–4 Runs as calibration, not a promise — estimates need local evidence. Run statistics do not provide historical effort per owner; use separate evidence or flag the gap.
- Estimate required Tasks before promising capacity; keep unestimated work visible — Planning sums only known effort and reports `unestimated`, while Hero progress uses weight 1 for unset effort ([card contract](../references/cards.md#task)). Neither is measured capacity.
- Compare estimated remaining work by discipline against observed pace and available Runs; cut scope or complexity when it cannot fit — carryover is not capacity.
- Finish one small integrated slice, playable for a game, before scaling production — measured work gives a better forecast than isolated drafts.
- Treat repeated carryover as a scope or splitting signal, not individual blame — the team can change the plan.
- Keep release and post-release work visible alongside build work, with time for late fixes — delivery continues beyond feature completion.

## Pitfalls
- An early **Finish Run** does not move the next scheduled Run: it keeps its generated start, and moving it to overlap the closed Run is refused (422) — treat the gap as buffer or change the schedule.
- No per-person capacity on the board → ask each person's hours per week and record them in the plan, not as a guess.
- A card has an owner but `next` returns no card → add an eligible Task to that member's Hand explicitly; ownership is not Hand membership.
- A manually written Run or milestone value appears on a card but has no matching registry ID → choose the actual ID in the UI; free-form values can leave dangling references.
