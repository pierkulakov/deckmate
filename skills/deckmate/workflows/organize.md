# Organize the board

**When:** check whether cards follow the [layout rules](../layout-rules.md), or decide where one new thing belongs. This workflow is read-only: it never creates, moves, accepts or edits cards and decks.

## Audit the current board

Run the MCP tool `organize` with `{}`, or:

`deckmate project organize --data <project> --read-only`

The compact `table` rows are `card → deck → Hero → reason`; `at` is the inclusive `path:from-to` source pointer for each finding. The heuristics report duplicate deck names within one space, Heroes outside their entity area, game content in a tool deck, Hero Sub Cards outside discipline decks, and rule text stored in a Hero. A finding is a review cue, not permission to change files. Read the cited source before proposing a fix.

Read `mode` before interpreting the response: `audit` uses `table`, `placement` uses the top-level recommendation, and `placements` uses `placements[]`. Inspect `warnings` for omitted findings or shortened output, follow the cited `at`/`readNext` ranges, and never report a truncated audit as complete.

## Place a new thing

Call `organize` with `{ "about": "<new thing>" }`, or:

`deckmate project organize --about "<new thing>" --data <project> --read-only`

The response includes `about`, `card` (`hero`, `subcard` or `doc`), `deck`/`deckId`, parent `hero`/`heroRef`, `ruleDoc`, `reason`, `readNext` and optional `warnings`. `deckId: null` means the deck does not exist yet: check for the same name in this project and space before creating it. Follow `readNext` pointers to verify the recommendation against existing cards. For several new things in one `about`, the mode is `placements` with one placement object per part. Create only after the person approves the specific cards, through `create_cards` or [create](../references/cli.md#create).

For similar entities, use a Journey step-chain template instead of repeating manual placement. Do not create cards for completed work or accept work here; preserve existing accepted work, and never accept your own work.
