---
name: deckmate
description: "Use when a person asks to start or profile a Deckmate project, plan cards or milestones, work or ask about a card, review or audit results, organize the board, analyze a game or software area, write a GDD, run a Journey, run a playtest, or set up a team. Also handles /deckmate start | profile | plan | milestone | work | ask | review | audit | organize | analyze | gdd | journey | playtest | team."
metadata:
  version: "2026-11-12"
argument-hint: "[start · profile · plan [c-ref] · milestone · work <member|c-ref> · ask <c-ref> · review <c-ref> · audit <deck|p-ref|project> · organize [about] · analyze <area> · gdd · journey [p-ref] · playtest · team]"
---
# Deckmate — router

Choose one case: honor an explicit `/deckmate` subcommand when it matches the requested action, and otherwise choose by the intended outcome, not a verb alone. If multiple cases remain plausible, ask one disambiguating question and perform no writes or launches; for sequential intents, confirm the order and finish one workflow before entering the next. If no case fits, answer normally without invoking Deckmate or requesting a project path — a code review, test, engine name, GDD term, or agent team alone does not imply work on a Deckmate board. For an existing project, use the current folder or nearest ancestor containing `tasks/deckmate.md` (legacy `tasks/freetion.md`); if none exists, ask for the project path. `start` can instead create a project.
Use an explicit absolute project path: `deckmate project … --data <project>`, `npx deckmate project … --data <project>`, or `npm run project -- … --data <project>` in a Deckmate source checkout. Project commands need Node.js 26+ and can run offline; guarded writes find the running server of this project and otherwise write the files, so a different project on the port no longer blocks them ([Common options](references/cli.md#common-options)). An MCP client gets the same operations as tools through `deckmate mcp`, registered by `deckmate skills install`.
Read skill files relative to this file, not from `deckmateHome` in the manifest. Command details: [CLI](references/cli.md); native cards: [card format](references/cards.md#card-file-format); actions without a command or tool: [HTTP](references/api.md).

## If the person wants… → open

| Situation | Workflow → file |
|---|---|
| Start a new game or software project in an empty folder | `start` → `workflows/start.md` |
| Capture the project's genre, references, communities and goal | `profile` → `workflows/profile.md` |
| Cut a feature into a Hero and child cards | `plan [c-ref]` → `workflows/plan.md` |
| Capture one Task or Doc, or a supplied batch of independent cards without feature splitting | `plan` → `workflows/plan.md`; use its intake-only route |
| Change an existing card's properties, links or planning; restore a hidden card | `plan [c-ref]` → `workflows/plan.md`; [HTTP actions](references/api.md#change-an-existing-card) |
| Plan a milestone, Runs or a launch; close a Run | `milestone` → `workflows/milestone.md` |
| Take a card, submit work, or rework a return | `work <member\|c-ref>` → `workflows/work.md` |
| Raise a new blocker, discuss c-…#N in chat, record a human answer, or implement a saved decision | `ask <c-ref>` → `workflows/ask.md` |
| Review someone's work, return it, or accept it | `review <c-ref>` → `workflows/review.md` |
| Audit a deck, a Journey, or the whole project | `audit <deck\|p-ref\|project>` → `workflows/audit.md` |
| Check board layout or where a new thing belongs | `organize [about]` → `workflows/organize.md`; [layout rules](layout-rules.md) |
| Analyze one game or software area against its rules, evidence and an applicable lens | `analyze <area>` → `workflows/analyze.md` |
| Maintain a GDD as decks, Heroes and rule Docs | `gdd` → `workflows/gdd.md` |
| Design, apply, work, or improve a repeatable pipeline | `journey [p-ref]` → `workflows/journey.md` |
| Run a playtest, triage feedback and bugs, confirm fixes | `playtest` → `workflows/playtest.md` |
| Set up a solo person, a small team, or several agents | `team` → `workflows/team.md` |
| Read project status, a member's notifications or Hand, or locate a card without changing it | Open [CLI](references/cli.md) for [summary](references/cli.md#summary), [inbox](references/cli.md#inbox), [hand](references/cli.md#hand), [find](references/cli.md#find), [brief](references/cli.md#brief) or [show](references/cli.md#show); do not enter a mutation workflow |

Read the selected workflow fully — or, for the read-only case above, the selected command reference — then load only the references that action requires. For `analyze` and `audit`, add `--read-only` to `deckmate project` commands (`deckmate agents run --dry` writes only assignments and starts nothing) and write only the designated output until card changes are approved.

## Load the profile, genre, lens and engine

- Read `tasks/deckmate-project.md` only if it exists; if missing, suggest `profile` before `analyze` or `audit`, which need it.
- Load profile, genre, lens and engine only when the selected action needs them. An empty genre means no genre guide; if neither a project nor a built-in guide exists, disclose that and proceed without inventing a path. A self-contained work, ask, review or metadata edit must not trigger profile creation or unrelated game-context reads.
- Genre: `<project>/tasks/deckmate-genres/<genre>.md`, then `genres/<genre>.md`; use the profile's `genre` key.
- Lens: `<project>/tasks/deckmate-lenses/<area>.md`, then `lenses/<area>.md`, using lowercase area names. If absent, compare only `area` and `title` headers, choose the closest fit and disclose it; otherwise proceed without one.
- Engine: `ProjectSettings/ProjectVersion.txt` → `unity`; `*.uproject` → `unreal`; `project.godot` → `godot`; otherwise `none`. If the board folder is separate from the engine project, use the engine the person names. Unknown engine → work with `none` and say so. Open `engines/<engine>.md` for that engine; `none` has no file.

## Delegate to agents

- Do `## Step N — … (self)` yourself; `## Assignment: <role>` (legacy `## Задание: <role>`) assigns a `research`, `code`, or `docs` role. Keep markers unchanged.
- Delegate only with the person's permission; otherwise perform assignments sequentially and keep their output paths.
- Run `deckmate agents run <workflow> <area> --project <project> --dry`, inspect `tz-*.md`, then remove `--dry` only with launch permission; preserve `--roles`, `--lens`, and `--out`. Dry runs still write assignments.
- When a closest-fit lens was selected, pass its absolute path with `--lens` on every `deckmate agents run` command; the runner does not perform the header-based fallback. Preserve that path in subsequent previews and launches.
- If the engine the person names differs from detection in the board folder, perform the assignments sequentially with the named engine and keep their output paths; the runner has no `--engine` option and would substitute a different value.
- Skill lookup is `.agents/skills/deckmate`, `.claude/skills/deckmate`, `skills/deckmate`, then the package. Reinstall if `deckmateHome` is stale; missing launchers are manual. Never overwrite a differing assignment: choose another output.
- Substitutions: `{area}` area; `{project}` absolute project; `{date}` YYYY-MM-DD; `{out}` `--out` or `<project>/research_notes/<area>-<date>/`; `{engine}` engine; `{lens}`, `{profile}`, `{genre}` file paths, empty if missing.
- Each role writes `{out}/<role>.md` and sees only its assignment; do not add conversation links. If the runner is unavailable, substitute values and save `{out}/tz-<role>.md` yourself.

## Ground rules

1. Files are the source of truth, never SQLite. Create and change cards through the `deckmate` MCP server (`create_cards`, `update_card`) or `deckmate project create` / `update`; without MCP and the CLI, only through the running server (UI / [HTTP](references/api.md)), never by hand. If `http://127.0.0.1:4317` does not answer, start `npx deckmate --no-open` in the project folder in the background and wait for a response; if startup fails, stop and tell the person. Reading, `next`, `brief`, `question`, `report`, `state`, `ask`, `answer` and `apply` still work without a server.
2. Questions and decisions follow [ask](workflows/ask.md): `ask` returns text, not a ref — copy the current `c-…#N` from `brief` before `question` or `answer`, never inventing the index; a decision index from `answer` or `next` is zero-based, not the 1-based question number.
3. Use the c-refs and p-refs that commands print; never invent or shorten them.
4. Create or change cards only after the person approves the specific list.
5. Submit to `review`; an agent never accepts its own work — [acceptance policy](workflows/review.md#acceptance-policy).
6. Use bounded reads: `brief --budget 1500`, `show --lines`, and `find --fields brief`; follow every required `readNext` range when `truncated` is true.
7. For every workflow, including audit assignments, check an open question's assignee and target on the card it concerns; a missing legacy Decision-task link is not a defect, and a Decision Task is never required or created.
8. Before proposing card creation or placement changes in any workflow, read the [layout rules](layout-rules.md) and check the proposed placement with `organize` against the cited source ranges. `organize` is read-only; after approval, apply moves through `plan` and `update_card`, not through `organize`.
