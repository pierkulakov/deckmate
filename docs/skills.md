# Deckmate skills — `/deckmate`

The `skills/deckmate/` package teaches an agent to manage a project through its board: analyze a game domain, audit a deck, create cards, work on a card, and review results. It uses the open Agent Skills format (a folder with `SKILL.md`), supported by compatible agents without a marketplace. The `argument-hint` field in the frontmatter is a Claude Code extension: other hosts ignore it. The skill version is stored in `metadata.version`. The package contains no project-specific facts; it explains how to retrieve them with minimal context.

## Install in a project

Run from the project folder:

```sh
npx deckmate skills install
npx deckmate skills status
```

Add `--project <project folder>` to work on another folder. From a Deckmate source checkout, `npm run skills -- install --project <project folder>` runs the same command.

`install` copies the entire `skills/deckmate/` tree, including workflows, references, lenses, genres, and engines, to `<project>/.claude/skills/deckmate/` (Claude Code) and `<project>/.agents/skills/deckmate/` (Codex and compatible hosts). No other host-specific folder is installed. It records the absolute package/source path as `deckmateHome` in `tasks/deckmate.md` (or the existing legacy `tasks/freetion.md`); the runner uses it as a fallback. The installed skill is self-contained and does not require repository documentation in the user's project.

Installation requires an existing project manifest. Both `install` and `status` accept `--from <Deckmate folder>` to select a package/source tree; otherwise they use the running package, not the manifest's recorded home. `status` reports source version, installed versions, and byte-for-byte `matches`/`differs` (or not installed). Reinstall to update, including after an `npx` cache path changes. Installation replaces differing Deckmate skill copies, removes obsolete files there, and preserves other skills; keep custom lenses/genres in `tasks/`, not in these managed copies. Commit the installed copies with the project.

Agents run board commands with Node.js 26+ and no server required: `npx deckmate project <command> --data <absolute-project>` (or `deckmate project …` on PATH). From a source checkout, `npm run project -- <command> --data <project>` is equivalent. Explicit `--data` avoids environment defaults; it does not disable a configured `DECKMATE_WRITE` sandbox. `--source sandbox` selects the writable root in direct/sandbox mode; live writes are rejected. Add `--read-only` or set `DECKMATE_READ_ONLY=1` for research. See [catalog.md](catalog.md#sqlite-short-references-and-the-agent-interface).

## Command

`/deckmate <workflow> [argument]` opens one workflow file and follows it.

| Workflow | Argument | Result |
|---|---|---|
| `analyze` | Domain: `fx`, `units`, `map-editor`, … | What the game needs, established practices, code coverage and gaps; a summary and, with your approval, cards in `discussing`. |
| `audit` | Deck (ID or title) or Journey (`p-ref`) | Coverage, returns, and inactive cards; proposals with costs. |
| `plan` | None or `c-ref` | Rules for managing cards, decks, Heroes, Journeys, Runs, milestones, tags, and questions in Markdown. |
| `profile` | None | A project profile in `tasks/deckmate-project.md`: genre, references, and players, based on project documents and your answers. |
| `work` | `c-ref` or member | The executor's route: `next` → `brief` → `show --lines` / `step` → `state started` → `ask` if blocked → checks → `report --state review`. |
| `review` | `c-ref` | Acceptance based on specification tolerances, diffs, and tests, not the executor's report. |

The skill locates the current folder or nearest ancestor with a manifest and passes it explicitly. The CLI itself does not search ancestors: data selection is `--data`, then `DECKMATE_DATA`, then cwd; skills/agents use `--project`, then cwd. Before approval of cards, `analyze` and `audit` write only their research output. Individual cards require the UI or HTTP `create-card`; there is no CLI `create-card`. CLI `project init` applies starter templates, while top-level `init <folder>` creates a demo. The skill never edits SQLite or lifts a project-wide read-only restriction to create cards.

## Package contents

| Path | Contents | Maintainer |
|---|---|---|
| `SKILL.md` | Router: locate the project, select a workflow, delegate only with permission, limit context, and enforce write rules. | Deckmate |
| `workflows/` | The six workflows above; the calling model performs `## Step N — … (self)`, while `## Assignment: <role>` (or the Russian `## Задание: <role>`) is extracted for an agent. | Deckmate |
| `references/api.md` | Self-contained HTTP setup, hash guards, card/deck creation, questions/answers, audit reads, and review rules; API actions are distinguished from CLI commands. | Deckmate |
| `lenses/` | Domain lenses (`fx`, `units`, `map-editor`): requirements, questions, references, warning signs, and checks. A project lens at `<project>/tasks/deckmate-lenses/<area>.md` takes precedence. | Deckmate and the project |
| `genres/` | Genre guides for the ten starter genres plus `rts`, `tactics`, `shooter` and `4x` (`strategy` routes to the three strategy sub-genres): references, player sources, and pitfalls. Project guides go in `<project>/tasks/deckmate-genres/<key>.md`. | Deckmate and the project |
| `engines/` | `unity`, `unreal`, `godot`: where to look, how to measure, and pitfalls. The engine is detected from project files. | Deckmate |

See `skills/deckmate/lenses/README.md` and `skills/deckmate/genres/README.md` for authoring rules: each entry needs a source and must remain independent of any one project.

## Project profile and agent configuration

Two optional project files under `<project>/tasks/`; source/package templates are in `assets/templates/`. The profile workflow includes its own complete example, so agents need not locate those templates.

| File | Purpose | When absent |
|---|---|---|
| `deckmate-project.md` | `genre`, `description` (game concept), `platform`, `references` (`game`/`take`), `players` (text with links/questions), and project-relative `principles`/`goal` paths. | The workflow asks for missing information and offers to save it; unknown text/paths stay empty. A project genre guide overrides the bundled guide. |
| `deckmate-agents.md` | Launchers (`command` with `{prompt}`, `{cwd}`, `{tools}`), routing for `research` / `code` / `docs` / `synthesis`, and concurrency limits. | All assignments are handed to you for manual execution. |

Configuration format and roles: [agents-config.md](agents-config.md). These files contain no API keys; launchers read their own secrets.

## Delegate work to agents

Run from the project folder, or add `--project <folder>`:

```sh
npx deckmate agents run <workflow> <area> --dry
npx deckmate agents run <workflow> <area> [--roles research,code] [--lens <path>] [--out <folder>]
```

From a Deckmate source checkout, `npm run agents -- run <workflow> <area> --project <folder> …` runs the same command.

`run` extracts `## Assignment:` sections (present in bundled `analyze`/`audit` only), substitutes `{area}`, `{project}`, `{date}`, `{out}`, `{engine}`, `{lens}`, `{profile}`, and `{genre}`, writes `{out}/tz-<role>.md`, launches configured role commands, and waits. The default output is `<project>/research_notes/<area>-<YYYY-MM-DD>/`. Each role writes `{out}/<role>.md`; the calling model synthesizes results. Other workflows have self steps only; the runner does not execute them.

`--dry` still writes assignments but launches nothing. Inspect them first and launch only with the user's permission; if delegation is prohibited, perform roles sequentially yourself. Preserve `--roles`, `--lens`, and `--out` between preview and execution. Differing existing assignment text is rejected: choose another output folder rather than overwriting work. Use `--lens` for a different domain name and an external `--out` for a read-only project. Missing launchers are marked for manual execution; a launcher failure produces nonzero exit status.

Workflow/lens/genre lookup checks installed `.agents`, installed `.claude`, project `skills/deckmate`, then the package tree selected by `deckmateHome`. Project lenses in `tasks/deckmate-lenses/` and genre guides in `tasks/deckmate-genres/` take priority; an explicit `--lens` wins over all lens defaults. A stale package path can be refreshed by reinstalling from the current package.

## Limit context

Read the selected skill workflow completely, but bound project-content reads: `brief <c-ref> --budget 1500` → required ranges through `show <file-card-ref> --lines a-b` or a direct file-range reader; `find <text> --fields brief` returns `{ cards, tokens }` with absolute-line `hits`. Journey ranges need `step <p-ref> <step-id>`, not an invented card ref. Increase a rejected brief budget to its reported minimum. Default brief output is Markdown with Read next ranges; `--json` exposes `truncated` and `readNext`. Hand truncation instead needs a larger limit (at most 100). Read role results starting with the summary and table.

Submit Tasks with `report <c-ref> --file <UTF-8-report.md> --member <you> --state review`; report headings must be level 5 or deeper. A reviewer returns with `state <c-ref> started --member <reviewer> --reason "<required, actual; fix>"` or accepts after the human owner's decision with `state <c-ref> done --member <reviewer>`. Guardians restrict acceptance when configured; without them the code does not enforce human-only or independent acceptance, but the skill forbids accepting one's own work. Blocked is dependency-derived, not a state. `raise-decision`/`record-decision` are HTTP actions, not CLI commands; inspect the saved rule Doc's `Decided` section if `brief` omits an answer.
