# Analyze one area of the game against a lens

**When:** the person asks what the game needs in one area (`fx`, `units`, `map-editor`, …), what is missing, or whether an idea deserves production. **Not this:** auditing board hygiene or rules-vs-cards fit → `workflows/audit.md`; cutting a feature into a Hero and child Tasks → `workflows/plan.md`.
**Person:** names the area, answers the questions, picks an option, approves the card list.
**Agent:** establishes the rules and the code facts, brings 2–3 options with one recommendation, creates cards only after approval.

Input as in the router: profile `tasks/deckmate-project.md` (missing → suggest `/deckmate profile` first); lens `tasks/deckmate-lenses/<area>.md`, then `lenses/<area>.md`, lowercase — if missing, the closest `area` / `title` match among `lenses/*.md`, told to the person; none fits → work without a lens and say so. Genre `tasks/deckmate-genres/<genre>.md`, then `genres/<genre>.md`, guides research when the profile has no references. Engine from project files: `ProjectSettings/ProjectVersion.txt` → `unity`, `*.uproject` → `unreal`, `project.godot` → `godot`, otherwise `none`; open `engines/<engine>.md` only for a detected engine.

Run every command as `deckmate project <command> … --data <project>` (variants in the router), adding `--read-only` until the person approves changes. Command syntax and output fields live in `references/cli.md`.

## Steps
1. Find the rules — `find "<area or a lens term>" --fields brief --limit 20` (`references/cli.md#find`)
   → `cards[].hits` with absolute source lines; extract rule excerpts, not code. A limited search is not a complete inventory.
2. Read the main cards — `brief <c-ref> --budget 1500` for the 3–5 main cards (`references/cli.md#brief`)
   → record each requirement as “rule → `file:line`”; an item without a source is a question, not a requirement. Lens Requirements absent from the rules → candidate questions.
3. Delegate the assignments — `deckmate agents run analyze <area> --project <project> --dry`
   → Inspect `tz-*.md`; launch only with permission and configured `tasks/deckmate-agents.md` ([team](team.md); `deckmate agents run --help`). If roles print `manual: no launcher`, or launch is forbidden, do their assignments yourself in sequence, keeping the same output files.
4. Compare requirement with reality — one row per requirement: exists (`file:line` anchor from `code.md`) | needed (rule) | effort | risk
   → “exists” without an anchor is “not checked”. Estimate effort by comparison with an accepted card of the same type; name what might break, with an example from `research.md` or the lens's Warning signs.
5. Give 2–3 options — scope, effort, risk, and what the game loses
   → drop options that conflict with the profile's `principles` and name the violated principle. For an unvalidated idea the first option is a cheap prototype or external test: one hypothesis, evidence to collect, success and stop criteria — no full production before that evidence.
6. Recommend — one option in a single line: reason plus a reference from `research.md`.
7. Cards after approval — show the list: title, Visible / Work / Done, deck, owner, effort (`workflows/plan.md`)
   → After approval, confirm your ID in the [members roster](team.md). Create or change cards only through the running server's UI / HTTP `create-card`, following the [server startup rule](../references/api.md); never write card files by hand. Check `map` warnings, then `find`. Move new Tasks to `discussing`: `state <c-ref> discussing --member <you>` without `--read-only` (`references/cli.md#state`; not for Hero/Doc). Never lift a project-wide read-only restriction; leave the approved list in the summary instead. Keep `{out}/summary.md` ≤ 30 lines: three main gaps against the profile's `goal`, recommendation, questions with recipients, links to role responses; show the first 10 lines and path.

## Done when
- `{out}/summary.md` names the gaps, the recommendation, and the questions with recipients; after approval the new Tasks sit in `discussing` (`find --state discussing --fields brief`).

## Rules
- A requirement without a source anchor is a question, not a requirement — rules live in project files, not in memory.
- Cheapest test first — evidence from one iteration gates the next; production before evidence buys rework.
- Omit claims without links; state when no source was found — an unverifiable claim is noise.
- Create cards only after the person approves the specific list.
- Every question gets a recipient through `ask` — an unanswered question blocks; a vague one rots.

## Pitfalls

## Assignment: research
**References: {area} — {date}.** Project `{project}` is read-only. Profile: `{profile}`. Genre: `{genre}`. Lens: `{lens}`. Engine: `{engine}`. An empty path means the file is missing.
1. Use the profile to guide research: `genre`, `platform`, `references` (inspect each game's `take`), and `players`. If the profile has no references, use the genre file; if that is missing too, use the lens's References section.
2. Find 4–6 games that handle “{area}” well, starting with these references: what to inspect, how to measure it, and a link (GDC, engine documentation, analysis, or timestamped video).
3. Find 3–5 player discussions about the area in the `players` communities, otherwise Steam, Reddit, or forums: praise, complaints, a quote ≤ 15 words, and a link.
4. Omit claims without links; if web access fails, use available project references, mark external claims unverified and list what needs later checking. Do not invent sources.
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
