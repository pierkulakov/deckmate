# Audit a deck or Journey — 2026-11-05
Input: deck (ID or name) or Journey (`p-ref`); choose the profile, genre, and lens for the deck's area using `SKILL.md`. Deliver proposals with effort estimates and, with the user's approval, cards created and then moved to `discussing` (discussion).

## Step 1 — inventory (self)
- Prefix board commands as in `workflows/work.md`, with explicit `--data <project>` and `--read-only` during research. HTTP reads need a running server on the same project; see `references/api.md`. If unavailable, mark event/metrics checks as not checked rather than inventing history.
- For a deck, get its ID from `map` and cards from `find --deck <id> --fields brief --limit 100`. Search excludes Archive/Trash; raise the limit up to 1000 or narrow filters if it is full. Get events from `GET /api/activity?source=sandbox&deckId=<id>` and follow `nextCursor`, even after an empty page.
- For a Journey, get its p-ref from `pipelines`, use `pipeline <p-ref>` for the overview and canonical UUID, and `step <p-ref> <step-id>` for steps in question. Use `GET /api/journey-metrics?source=sandbox&journeyId=<UUID>` for returns, not the p-ref.
- Find stale cards with `summary --stale-hours 72`.
- Save the inventory to `{out}/cards.md` for the roles to read: c-ref, title, kind, state, owner, effort, Run, and file path.

## Step 2 — check cards (self)
Record each finding as “c-ref — violation — rule from `workflows/plan.md`”:
- Task missing Done criteria with a number or check command, an owner, or effort; Task naming two assignees in its text;
- Hero with zero or one child card; Doc containing work that needs acceptance;
- Asset deck describing production steps instead of game objects or systems; Hero without a result that can be inspected in the game;
- “waiting,” “after,” or “when available” without a dependency; dependency on an archived card;
- Blocked card without a question and recipient; `Open questions` (Open) item without a recipient;
- `started` (in progress) with no activity for over 72 hours; `review` (review) lasting longer than a Run; carryover across two or more Runs without a reason.

## Step 3 — check the Journey and lens (self)
- Find steps missing instructions, an owner, or a target deck; find dependencies between steps that do not wait on each other.
- Treat two or more returns at a step for similar reasons as evidence of a missing step or instructions to revise. A step closed without work may be redundant.
- Find required work repeatedly added outside the Journey and steps routinely skipped; propose template instructions, dependencies, effort, or optional zones that match completed instances.
- Find lessons in the step file's `## Lessons` (legacy `## Грабли`) section that have not been incorporated into its instructions.
- Match every item in the lens's Requirements section to a card or step; record gaps. Check card text against Warning signs.

## Step 4 — delegate assignments (self)
- After saving `{out}/cards.md`, assign `research`, `code`, and `docs` roles as described in Delegate to agents in `SKILL.md` only with permission; otherwise perform the assignments yourself in sequence.

## Step 5 — proposals (self)
- Write a table of ≤ 15 rows: proposal | basis (c-ref, rule, anchor) | effort | risk. Put low-cost proposals with a large impact on the profile's `goal` first.
- Reject proposals that conflict with the profile's `principles` and name the violated principle.
- Create cards and move each to `discussing` as in step 4 of `workflows/analyze.md`; keep `{out}/summary.md` ≤ 30 lines and show the user the first 10 lines and the path.

## Assignment: research
**Area pipeline: {area} — {date}.** Project `{project}` is read-only. Profile: `{profile}`. Genre: `{genre}`. Lens: `{lens}`. Engine: `{engine}`. An empty path means the file is missing.
1. Use the profile's `genre`, `platform`, and `references` to guide research; use the genre file if the profile is empty.
2. Find production stages for “{area}” objects in these games and the `{engine}` documentation: stage, who does it, deliverable, and verification. Use 3–5 sources and link each row.
3. Identify stages teams often skip and the consequences.
4. Write `{out}/research.md` in ≤ 50 lines: a five-line Summary; a “stage | who | deliverable | check | link” table; Often skipped.

## Assignment: code
**Card evidence in code: {area} — {date}.** Project `{project}` is read-only; do not launch the editor or a build. Engine: `{engine}`; follow `{project}/.agents/skills/deckmate/engines/{engine}.md` if present. Lens: `{lens}`. Deck inventory: `{out}/cards.md`.
1. For cards in `done` (accepted) and `review` (review), give a `file:line` anchor for the promised result, or “no evidence” with the searches performed.
2. Mark “{area}” code with no card in `{out}/cards.md` as “code without a card” and provide an anchor.
3. Identify tests and test scenes that check the cards; list cards without verification.
4. Write `{out}/code.md` in ≤ 60 lines: a five-line Summary; a “c-ref | evidence | anchor” table; Code without a card; No verification; Not checked.

## Assignment: docs
**Rules and cards: {area} — {date}.** Project `{project}` is read-only. Lens: `{lens}`. Engine: `{engine}`. Deck inventory: `{out}/cards.md`.
1. For each card, provide its source rule in project documents with an anchor, or “no rule.”
2. List rules and decisions for “{area}” without cards, with anchors.
3. Check whether the area's `Open questions` (Open) items have a recipient and a `Decision: …` (Decision) task. Give two anchors for discrepancies between a card and its rule.
4. Write `{out}/docs.md` in ≤ 60 lines: a five-line Summary; Card without a rule; Rule without a card; Open; Discrepancies.
