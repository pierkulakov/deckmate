# Audit a deck, a Journey, or the whole project

**When:** the board grew messy, a Run ends, or the person asks what to clean up and whether cards still match the rules — for one deck (ID or name), one Journey (`p-ref`), or `project` for all of it. **Not this:** analyzing one game area against a lens → `workflows/analyze.md`; doing or reviewing a card → `workflows/work.md` / `workflows/review.md`.
**Person:** picks the scope, answers questions found without a recipient, approves the proposals list before anything changes.
**Agent:** reads the board with bounded commands, checks cards against `workflows/plan.md` and the area lens, writes `{out}/cards.md` and the proposals table — no card changes before approval.

Run every command as `deckmate project <command> … --data <project>` (checkout and npx variants in the router `SKILL.md`), adding `--read-only` until the person approves changes. Profile, genre, lens, and engine are chosen as in the router; command syntax and output fields live in `references/cli.md`.

## Steps
1. Board shape — `map` (`references/cli.md#map`)
   → deck IDs and `decks[].cards` counts: hundreds of cards suggest a split, a handful suggest checking whether two related decks should merge; track and pipeline IDs for the steps below.
2. Pulse — `summary --stale-hours 72` (`references/cli.md#summary`)
   → `counts.owners` (a `"owner": null` row appears only when unowned cards exist), `groups.blocked` (active prerequisites not `done`), `groups.review`, `groups.stale` (`started` idle past the window; default 24 hours).
3. Inventory — `find --deck <id> --fields brief --limit 100` with `--kind` / `--state` (`references/cli.md#find`); `track <track> --fields brief` for a theme across decks (`references/cli.md#track`); `pipelines` → `pipeline <p-ref>` → `step <p-ref> <step-id>` for a Journey (`references/cli.md#pipeline`)
   → save `{out}/cards.md`: c-ref, title, kind, state, owner, effort, Run, file path. Search excludes Archive/Trash; a full page is not the whole deck.
4. Hygiene pass — record each hit as “c-ref — signal”:
   - `owner: null` — no owner; `effort: null` on a Task — no estimate (empty effort counts as 1 and hides scope);
   - `groups.blocked` — Blocked by unaccepted dependencies; the card's `dependencies` name them. Archived, deleted, or missing prerequisites do not block — check whether the link is still needed;
   - `groups.stale` — stale `started`: ask whether the work is still active; `groups.review` — review older than one Run is stuck: read transitions with `changes <c-ref> --since <ISO>` (`references/cli.md#changes`);
   - deck sizes from step 1 — split or merge candidates to discuss, not to apply;
   - `find --kind hero` then `show <c-ref>` → `context.children` (`references/cli.md#show`) — a Hero with zero or one child Task (a signal to check, not a defect: a native Hero without Tasks can be marked done by hand);
   - open questions from `show <c-ref>` / `brief` — an item without an assignee has no recipient; a missing legacy Decision-task link is not a defect;
   - `run` / `milestone` absent on an active Task while `tasks/deckmate-runs.md` / `tasks/deckmate-milestones.md` list entries — unplanned work.
5. Card rules — each finding as “c-ref — violation — rule from `workflows/plan.md`”: Task without an observable Done criterion (numeric where the result is measurable), an owner, or effort; Task naming two assignees; Hero without a result inspectable in the game; Doc containing work that needs acceptance; Asset deck describing production steps instead of game objects; “waiting”, “after”, “when available” without a dependency.
6. Journey — steps missing instructions, an owner, a target deck, or effort; dependencies that do not wait on each other; required work repeatedly added outside the Journey; `## Lessons` (legacy `## Грабли`) not incorporated into instructions. Returns per step come from `GET /api/journey-metrics` (`references/api.md#audit-reads-without-cli-equivalents`): two or more returns at one step for similar reasons mean a missing step or instructions to revise; a step closed without work may be redundant.
7. Lens — match every Requirements item to a card or step and record gaps; check card text against Warning signs.
8. Evidence — resolve the scope first (`map` for a deck ID, `pipeline <p-ref>` for a Journey; step 3 saves the inventory), then run the `research`, `code`, and `docs` assignments below for one subject area, not a board scope: `deckmate agents run audit <area> --project <project> --dry --out <out>` with a meaningful area slug of letters, digits, `_`, `-` (for example `sound`, `production`) — a deck title with other characters is rejected, and a p-ref, though accepted, points the assignments at the wrong object.
   → Inspect `tz-*.md`; without `--dry` only with permission, otherwise perform them yourself in sequence (router: Delegate to agents). For scope `project`, finish the hygiene pass first and run assignments only for the areas that need evidence. Without a running server skip only the HTTP metrics ([audit reads](../references/api.md#audit-reads-without-cli-equivalents)); card history works offline through `changes <c-ref> --since <ISO>` ([changes](../references/cli.md#changes)) — never invent history.
9. Proposals — a table of ≤ 15 rows: proposal | basis (c-ref, rule, anchor) | effort | risk; low cost, high impact on the profile's `goal` first; drop what conflicts with the profile's `principles` and name the principle. The person approves the list; only then create the cards with `deckmate project create "<title>" --deck <deck-id> --member <you>` (MCP `create_cards` is the same step) and change them with [state](../references/cli.md#state) or [update](../references/cli.md#update), never by hand. Move each Task to `discussing`: `state <c-ref> discussing --member <you>` without `--read-only` (`references/cli.md#state`; Hero/Doc have no discussion state). Keep `{out}/summary.md` ≤ 30 lines; show the person the first 10 lines and the path.

## Done when
- `{out}/cards.md` holds the inventory and `{out}/summary.md` the proposals the person has seen; after the approved changes land, a fresh `summary --stale-hours 72` shows the signals drop.

## Rules
- Proposals before changes — the person approves the specific list; a silent edit breaks trust in the files.
- One finding, one anchor — a signal without a c-ref and a rule is an impression, not a finding.
- Estimate effort by comparison with an accepted card of the same type — done work is the only honest baseline.
- Carryover across two or more Runs means excess scope or poor splitting — fix scope, not the assignee.
- Blocked is calculated from dependencies, not a stored state — treat it as a question about the prerequisite.
- Hygiene is a pass, not a rewrite — propose the smallest change that removes the signal.

## Pitfalls
- `summary --stale-hours` reads the journal and fails on journal warnings — fix the journal first; do not route around it.
- No profile and the person declines to write one → audit structure and hygiene only, and list goal-based ranking and lens fit under Not checked.
- Web search is unavailable → mark the `research` assignment blocked with the queries you would run; never fill it from memory.
- A guarded write fails after files changed under it → reread the card with `brief` and retry with fresh data; never change `state` by editing the card file — the transition event would be lost.

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
3. Check whether the area's `Open questions` (Open) items name a recipient and an answer target; never require or create a `Decision: …` (Decision) task. Give two anchors for discrepancies between a card and its rule.
4. Write `{out}/docs.md` in ≤ 60 lines: a five-line Summary; Card without a rule; Rule without a card; Open; Discrepancies.
