# Deckmate skills — `/deckmate`

The `skills/deckmate/` package teaches an agent to manage a project through its board: analyze a game domain, audit a deck, create cards, work on a card, and review results. It uses the open Agent Skills format (a folder with `SKILL.md`), supported by compatible agents without a marketplace. The package contains no project-specific facts; it explains how to retrieve them with minimal context.

## Install in a project

Run from the project folder:

```sh
npx deckmate skills install
npx deckmate skills status
```

Add `--project <project folder>` to work on another folder. From a Deckmate source checkout, `npm run skills -- install --project <project folder>` runs the same command.

`install` copies the package to `<project>/.claude/skills/deckmate/` and `<project>/.agents/skills/deckmate/`. It adds `deckmateHome` to the manifest frontmatter (`tasks/deckmate.md`, formerly `tasks/freetion.md`): the absolute path to the Deckmate package or source folder, used to find its workflows and `docs/`. Installation requires a project manifest. `status` shows the source version and each installed copy's version. Run `install` again to update, also after `npx` fetched a new Deckmate version; commit the copies with the project like any other file.

Agents run the board commands from the project folder with `npx deckmate project <command>` (add `--read-only` or set `DECKMATE_READ_ONLY=1` for read-only work); see the command list in [catalog.md](catalog.md#sqlite-short-references-and-the-agent-interface).

## Command

`/deckmate <workflow> [argument]` opens one workflow file and follows it.

| Workflow | Argument | Result |
|---|---|---|
| `analyze` | Domain: `fx`, `units`, `map-editor`, … | What the game needs, established practices, code coverage and gaps; a summary and, with your approval, cards in `discussing`. |
| `audit` | Deck (ID or title) or Journey (`p-ref`) | Coverage, returns, and inactive cards; proposals with costs. |
| `plan` | None or `c-ref` | Rules for managing cards, decks, Heroes, Journeys, Runs, milestones, tags, and questions in Markdown. |
| `profile` | None | A project profile in `tasks/deckmate-project.md`: genre, references, and players, based on project documents and your answers. |
| `work` | `c-ref` or member | The executor's route: `next` → `brief` → `show --lines` → `ask` → `report`. |
| `review` | `c-ref` | Acceptance based on specification tolerances, diffs, and tests, not the executor's report. |

The project is the current folder or the nearest ancestor with a manifest. Before the card-creation step, `analyze` and `audit` write only their research output to the workflow's output folder. Cards require your approval of a specific list and must be created through Deckmate (UI, API, or CLI); the skill never edits SQLite.

## Package contents

| Path | Contents | Maintainer |
|---|---|---|
| `SKILL.md` | Router: locate the project and Deckmate, delegate work, limit context, and enforce write rules. | Deckmate |
| `workflows/` | The six workflows above; the calling model performs `## Step N — … (self)`, while `## Assignment: <role>` (or the Russian `## Задание: <role>`) is extracted for an agent. | Deckmate |
| `lenses/` | Domain lenses (`fx`, `units`, `map-editor`): requirements, questions, references, warning signs, and checks. A project lens at `<project>/tasks/deckmate-lenses/<area>.md` takes precedence. | Deckmate and the project |
| `genres/` | Genre guides (`rts`, `tactics`, `shooter`, `4x`, `rpg`, `platformer`): references, player sources, and pitfalls. Project guides go in `<project>/tasks/deckmate-genres/<key>.md`. | Deckmate and the project |
| `engines/` | `unity`, `unreal`, `godot`: where to look, how to measure, and pitfalls. The engine is detected from project files. | Deckmate |

See `skills/deckmate/lenses/README.md` and `skills/deckmate/genres/README.md` for authoring rules: each entry needs a source and must remain independent of any one project.

## Project profile and agent configuration

Two project files; templates are in `assets/templates/`.

| File | Purpose | When absent |
|---|---|---|
| `deckmate-project.md` | Genre, game concept, platform, references and what to study in each, player sources, and paths to principles and goals. | The workflow asks for this information and offers to save it; the genre guide provides the research framework. |
| `deckmate-agents.md` | Launchers (`command` with `{prompt}`, `{cwd}`, `{tools}`), routing for `research` / `code` / `docs` / `synthesis`, and concurrency limits. | All assignments are handed to you for manual execution. |

Configuration format and roles: [agents-config.md](agents-config.md). These files contain no API keys; launchers read their own secrets.

## Delegate work to agents

Run from the project folder, or add `--project <folder>`:

```sh
npx deckmate agents run <workflow> <area> --dry
npx deckmate agents run <workflow> <area> [--roles research,code] [--lens <path>] [--out <folder>]
```

From a Deckmate source checkout, `npm run agents -- run <workflow> <area> --project <folder> …` runs the same command.

`run` extracts the workflow's `## Assignment:` sections, substitutes `{area}`, `{project}`, `{date}`, `{out}`, `{engine}`, `{lens}`, `{profile}`, and `{genre}`, writes `{out}/tz-<role>.md`, launches each role's command, and waits. Each role writes its result to `{out}/<role>.md`. `--dry` only writes assignments and prints commands; inspect these first. Use `--lens` when the domain differs from the deck name and `--out` when the project must remain read-only. The summary marks roles without launchers for manual execution. The calling model synthesizes results with `synthesis: self`.

## Limit context

The skill prohibits reading entire files: use `brief <c-ref> --budget 1500` → a suggested range with `show <c-ref> --lines a-b` → `find <text> --fields brief`. Follow `readNext` when `truncated` is true. Read agent output starting with the summary and table.
