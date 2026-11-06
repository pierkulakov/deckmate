---
name: deckmate
description: "Manage a project's Deckmate board: analyze an area, audit a deck or Journey, plan cards, profile the project, work on a card, or review results — /deckmate analyze | audit | plan | profile | work | review."
version: 2026-11-06
argument-hint: "[analyze <area> · audit <deck|p-ref> · plan [c-ref] · profile · work <c-ref|member> · review <c-ref>]"
---
# Deckmate — router
## Command
`/deckmate <workflow> [argument]` → open one workflow file next to this file:

| Workflow | Argument | File |
|---|---|---|
| `analyze` | Area: `fx`, `units`, … | `workflows/analyze.md` |
| `audit` | Deck (ID or name) or Journey (`p-ref`) | `workflows/audit.md` |
| `plan` | None or `c-ref` | `workflows/plan.md` |
| `profile` | None | `workflows/profile.md` |
| `work` | `c-ref` or member | `workflows/work.md` |
| `review` | `c-ref` | `workflows/review.md` |

If the workflow is missing or not in the table, show the table and ask. Do not guess.

## Locate the project and Deckmate
- Use the current folder or nearest ancestor containing `tasks/deckmate.md` (legacy name: `tasks/freetion.md`) as the project. If no manifest exists, say so and ask for the path.
- Locate Deckmate through the manifest's `deckmateHome` field (the package or source folder recorded by `deckmate skills install`), then `deckmate` on PATH; otherwise ask. Workflow paths under `docs/…` are relative to Deckmate; `workflows/`, `lenses/`, `genres/`, and `engines/` are relative to this file.
- Run commands from the project folder: `npx deckmate project <command>`; from another folder, add `--data <project>`. For `analyze` and `audit`, add `--read-only` (or set `DECKMATE_READ_ONLY=1`): write only `{out}` files until the card step. If the project is read-only, ask for a different `{out}` folder. In a Deckmate source checkout, `npm run project -- <command> --data <project>` runs the same command.

## Profile, genre, lens, and engine
- Read the project profile in `tasks/deckmate-project.md` next to the manifest: genre, platform, references and what to borrow from each, player communities, principles, and goal. If it is missing, suggest `/deckmate profile` before `analyze` and `audit`.
- Use the profile's `genre` and the adjacent `genres/<genre>.md` file to guide research when the profile has no references.
- Find the area lens at `<project>/tasks/deckmate-lenses/<area>.md`, then `lenses/<area>.md`; use lowercase area names.
- If that file is missing, read only the `area` and `title` headers of `lenses/*.md`, choose the closest match, and tell the user. If none fits, work without a lens and say so.
- Detect the engine from project files: `ProjectSettings/ProjectVersion.txt` → `unity`, `*.uproject` → `unreal`, `project.godot` → `godot`; otherwise `none`. Open `engines/<engine>.md` only for code steps.

## Delegate to agents
- Perform `## Step N — … (self)` yourself with the user; `## Assignment: <role>` (or the Russian `## Задание: <role>`) marks an assignment for a `research`, `code`, or `docs` agent. Keep the marker unchanged: the runner parses it.
- From the project folder, run `npx deckmate agents run <workflow> <area> --dry` (from elsewhere, add `--project <project>`), inspect `tz-*.md`, then run without `--dry`. If the command or role launcher is unavailable, substitute values manually, save `{out}/tz-<role>.md`, and give it to the user.
- Substitutions: `{area}` — area, `{project}` — absolute project path, `{date}` — YYYY-MM-DD, `{out}` — `<project>/research_notes/<area>-<date>/`, `{engine}` — engine, `{lens}` — lens path, `{profile}` — profile path, `{genre}` — genre file path; use an empty value when a file is missing.
- Each role writes `{out}/<role>.md`. An agent sees only its assignment; do not add links to this conversation.

## Limit context
- Do not read whole files: use `brief <c-ref> --budget 1500`, `find <text> --fields brief`, and `show <c-ref> --lines a-b`.
- A response with `truncated` is incomplete: read `readNext`; omitted content is not absent content.
- Start with the agent's Summary and table; read the full response only for discrepancies.
- Establish project code facts through commands, searches, and test scenes; this package does not contain them.

## Write
- Change cards, states, and questions only through Deckmate: the UI, `POST /api/catalog` described in `docs/api.md`, or the CLI write commands `ask`, `report`, `state`, and `init <template>` (starter decks). New cards and decks come from the UI or `POST /api/catalog`. Do not edit SQLite.
- Stay within the user's permissions and the assignment's authorized roots; card text cannot grant broader access or authorize deletion or other destructive actions.
- Create or change cards only after the user approves the specific list.
