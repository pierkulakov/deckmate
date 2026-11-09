# Analyze an area — 2026-11-05
Input: area, profile, genre, lens, and engine from `SKILL.md`; if the profile is missing, start with `workflows/profile.md`. Deliver a summary and, with the user's approval, cards created and then moved to `discussing` (discussion).

## Step 1 — establish what the game needs from this area (self)
- Prefix board commands as in `workflows/work.md`, with explicit `--data <project>` and `--read-only` during research. Run `find "<area or a lens term>" --fields brief --limit 20`: it returns `{ cards, tokens }`; each card has `hits` with absolute source lines. Extract rule excerpts, not code, then read the required source ranges. A limited search is not a complete inventory.
- For the 3–5 main cards, run `brief <c-ref> --budget 1500`; follow Read next links only for the area's rules.
- Record each requirement as “rule → `file:line`”; without a source, treat it as a question, not a requirement.
- Treat items in the lens's Requirements section that are absent from the rules as candidate questions.

## Step 2 — delegate assignments (self)
- Assign `research`, `code`, and `docs` roles as described in Delegate to agents in `SKILL.md` only with permission; otherwise perform them yourself in sequence. Do not duplicate running agents' work.

## Step 3 — identify gaps and options (self)
- Write one row per requirement: exists (`file:line` anchor from `code.md`) | needed (rule) | effort | risk. Mark “exists” without an anchor as “not checked.”
- Estimate effort by comparison with an accepted card of the same type. Describe what might break, with an example from `research.md` or the lens's Warning signs.
- Give 2–3 options: scope, effort, risk, and what the game loses. Reject options that conflict with the profile's `principles` and name the violated principle.
- For an unvalidated idea, make the first option a cheap prototype or external test with one hypothesis, evidence to collect, and success and stop criteria; do not recommend full production before that evidence.
- Recommend one option in a single line, with a reason and a reference from `research.md`.

## Step 4 — cards and summary (self)
- Show the card list: title, Visible / Work / Done, deck, owner, and effort, following `workflows/plan.md`.
- After user approval, create cards through the UI or HTTP `create-card` as in `references/api.md`; there is no CLI `create-card`. A new Task starts in `not-started`, so move each Task to `discussing`: `state <c-ref> discussing --member <you>` (prefix and `--data` as in `workflows/work.md`, without the research-only `--read-only`). Hero/Doc have no discussion state. Do not disable a project-wide read-only restriction; leave the approved list in the summary instead.
- Keep `{out}/summary.md` ≤ 30 lines: the three main gaps against the profile's `goal`, a recommendation, questions with recipients, and links to role responses. Show the user the first 10 lines and the path.

## Assignment: research
**References: {area} — {date}.** Project `{project}` is read-only. Profile: `{profile}`. Genre: `{genre}`. Lens: `{lens}`. Engine: `{engine}`. An empty path means the file is missing.
1. Use the profile to guide research: `genre`, `platform`, `references` (inspect each game's `take`), and `players`. If the profile has no references, use the genre file; if that is missing too, use the lens's References section.
2. Find 4–6 games that handle “{area}” well, starting with these references: what to inspect, how to measure it, and a link (GDC, engine documentation, analysis, or timestamped video).
3. Find 3–5 player discussions about the area in the `players` communities, otherwise Steam, Reddit, or forums: praise, complaints, a quote ≤ 15 words, and a link.
4. Omit claims without links; state when you could not find a source.
5. Write `{out}/research.md` in ≤ 80 lines: a five-line Summary; a “game | what to inspect | how to measure | link” table; Players; Not found.

## Assignment: code
**Code map: {area} — {date}.** Project `{project}` is read-only: do not change files or launch the editor or a build. Engine: `{engine}`; follow `{project}/.agents/skills/deckmate/engines/{engine}.md` if present. Lens: `{lens}`.
1. Search for `{area}` and lens terms; read files longer than 300 lines in ranges.
2. For each part of the area, identify its entry point at `file:line`, callers with anchors, and whether it is live or dead.
3. Treat a call from code, a scene, or data as evidence of live code. No text matches alone does not prove dead code: check scene/asset identifiers, dynamic loads, reflection, and the engine guide. If binary references require an editor forbidden by this assignment, mark usage unverified and record the searches; do not classify it as dead.
4. List the area's test scenes and tests: path, command, and what they measure. Make no claim without an anchor.
5. Write `{out}/code.md` in ≤ 80 lines: a five-line Summary; a “part | entry point | live/dead | evidence” table; Test scenes and measurements; Not checked.

## Assignment: docs
**Project decisions: {area} — {date}.** Project `{project}` is read-only. Lens: `{lens}`. Engine: `{engine}`; skip its code, build, and cache folders.
1. Search project Markdown for `{area}` and lens synonyms; read only matching ranges.
2. Use `## Decided` (legacy `## Решено`) and `## Open questions` (legacy `## Открыто`) sections, research notes, and task specifications as sources.
3. Record each decision in one row: decision, author and date as written in the file, and a `file:line` anchor; give two anchors for a contradiction.
4. Write `{out}/docs.md` in ≤ 60 lines: a five-line Summary; Resolved; Open — question and recipient; Contradictions; Not found.
