---
name: deckmate
description: "Use when a person asks to start or profile a Deckmate project, plan cards or milestones, work or ask about a card, review or audit results, analyze a game area, write a GDD, run a Journey, run a playtest, or set up a team. Also handles /deckmate start | profile | plan | milestone | work | ask | review | audit | analyze | gdd | journey | playtest | team."
metadata:
  version: "2026-11-11"
argument-hint: "[start · profile · plan [c-ref] · milestone · work <member|c-ref> · ask <c-ref> · review <c-ref> · audit <deck|p-ref|project> · analyze <area> · gdd · journey [p-ref] · playtest · team]"
---
# Deckmate — router

Choose one case. For an existing project, use the current folder or nearest ancestor containing `tasks/deckmate.md` (legacy `tasks/freetion.md`); if none exists, ask for the project path. `start` can instead create a project.
Use an explicit absolute project path: `deckmate project … --data <project>`, `npx deckmate project … --data <project>`, or `npm run project -- … --data <project>` in a Deckmate source checkout. Project commands need Node.js 26+ and can run offline; writes probe `DECKMATE_PORT` (default 4317), so a different project on that port blocks them (see [Common options](references/cli.md#common-options)).
Read skill files relative to this file, not from `deckmateHome` in the manifest. Command details: [CLI](references/cli.md); native cards: [card format](references/cards.md#card-file-format); server-only actions: [HTTP](references/api.md).

## If the person wants… → open

| Situation | Workflow → file |
|---|---|
| Start from scratch for a genre and engine | `start` → `workflows/start.md` |
| Capture the project's genre, references, communities and goal | `profile` → `workflows/profile.md` |
| Cut a feature into a Hero and child cards | `plan [c-ref]` → `workflows/plan.md` |
| Change an existing card's properties, links or planning; restore a hidden card | `plan [c-ref]` → `workflows/plan.md`; [HTTP actions](references/api.md#change-an-existing-card) |
| Plan a milestone, Runs or a launch; close a Run | `milestone` → `workflows/milestone.md` |
| Take a card, submit work, or rework a return | `work <member\|c-ref>` → `workflows/work.md` |
| Resolve a blocking question and record its answer | `ask <c-ref>` → `workflows/ask.md` |
| Review someone's work, return it, or accept it | `review <c-ref>` → `workflows/review.md` |
| Audit a deck, a Journey, or the whole project | `audit <deck\|p-ref\|project>` → `workflows/audit.md` |
| Analyze one game area against a lens | `analyze <area>` → `workflows/analyze.md` |
| Maintain a GDD as decks, Heroes and rule Docs | `gdd` → `workflows/gdd.md` |
| Design, apply, work, or improve a repeatable pipeline | `journey [p-ref]` → `workflows/journey.md` |
| Run a playtest, triage feedback and bugs, confirm fixes | `playtest` → `workflows/playtest.md` |
| Set up a solo person, a small team, or several agents | `team` → `workflows/team.md` |

Read the selected workflow fully, then only the references it names. For `analyze` and `audit`, add `--read-only` to `deckmate project` commands (`deckmate agents run --dry` writes only assignments and starts nothing) and write only the designated output until card changes are approved.

## Load the profile, genre, lens and engine

- Read `tasks/deckmate-project.md` only if it exists; if missing, suggest `profile` before `analyze` or `audit`, which need it.
- Genre: `<project>/tasks/deckmate-genres/<genre>.md`, then `genres/<genre>.md`; use the profile's `genre` key.
- Lens: `<project>/tasks/deckmate-lenses/<area>.md`, then `lenses/<area>.md`, using lowercase area names. If absent, compare only `area` and `title` headers, choose the closest fit and disclose it; otherwise proceed without one.
- Engine: `ProjectSettings/ProjectVersion.txt` → `unity`; `*.uproject` → `unreal`; `project.godot` → `godot`; otherwise `none`. If the board folder is separate from the engine project, use the engine the person names. Unknown engine → work with `none` and say so. Open `engines/<engine>.md` for that engine; `none` has no file.

## Delegate to agents

- Do `## Step N — … (self)` yourself; `## Assignment: <role>` (legacy `## Задание: <role>`) assigns a `research`, `code`, or `docs` role. Keep markers unchanged.
- Delegate only with the person's permission; otherwise perform assignments sequentially and keep their output paths.
- Run `deckmate agents run <workflow> <area> --project <project> --dry`, inspect `tz-*.md`, then remove `--dry` only with launch permission; preserve `--roles`, `--lens`, and `--out`. Dry runs still write assignments.
- Skill lookup is `.agents/skills/deckmate`, `.claude/skills/deckmate`, `skills/deckmate`, then the package. Reinstall if `deckmateHome` is stale; missing launchers are manual. Never overwrite a differing assignment: choose another output.
- Substitutions: `{area}` area; `{project}` absolute project; `{date}` YYYY-MM-DD; `{out}` `--out` or `<project>/research_notes/<area>-<date>/`; `{engine}` engine; `{lens}`, `{profile}`, `{genre}` file paths, empty if missing.
- Each role writes `{out}/<role>.md` and sees only its assignment; do not add conversation links. If the runner is unavailable, substitute values and save `{out}/tz-<role>.md` yourself.

## Ground rules

1. Files are the source of truth, never SQLite. Create and change cards only through the running server (UI / [HTTP](references/api.md)), never by hand. If `http://127.0.0.1:4317` does not answer, start `npx deckmate --no-open` in the project folder in the background and wait for a response; if startup fails, stop and tell the person. Reading, `next`, `brief`, `report`, `state` and `ask` still work without a server.
2. Use the c-refs and p-refs that commands print; never invent or shorten them.
3. Create or change cards only after the person approves the specific list.
4. Submit to `review`; an agent never accepts its own work — [acceptance policy](workflows/review.md#acceptance-policy).
5. Use bounded reads: `brief --budget 1500`, `show --lines`, and `find --fields brief`; follow every required `readNext` range when `truncated` is true.
