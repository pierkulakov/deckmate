# Deckmate agent configuration
Project file: `tasks/deckmate-agents.md`. Put YAML frontmatter between `---` markers and human-readable notes below the closing marker.
See `assets/templates/deckmate-agents.md` for an example with Claude Code and Codex CLI launchers.
## Keys
| Key | Type and requirement | Meaning |
|---|---|---|
| `deckmate` | String, required | Format marker; must be `agents`. |
| `schema` | Integer, required | Schema version; supports `1`. |
| `launchers` | Object, required | Named launchers available for routing. |
| `launchers.<name>.command` | String, required | Process command with brace-delimited substitutions. |
| `launchers.<name>.tools` | String, optional | Tool list for `{tools}`; the launcher defines its meaning. |
| `launchers.<name>.capUsd` | Number > 0, optional; required by `{cap}` | Cost cap passed to the launcher through `{cap}`. |
| `routing` | Object, required | Maps each role to a launcher name or `self`. |
| `limits` | Object, required | Orchestrator limits, not model limits. |
| `limits.parallel` | Integer ≥ 1, required | Maximum number of concurrent agents in one `run`. |
| `limits.startGapSeconds` | Number ≥ 0, required | Minimum interval between process starts, in seconds. |
Launcher names are local to the file and are not reserved identifiers.
If `command` contains `{tools}`, give the launcher a `tools` field: without it `{tools}` becomes an empty string.
Markdown after the YAML is not part of the configuration; it must not contain secrets either.
## Roles and routing
| Role | Purpose | Typical route |
|---|---|---|
| `research` | Web research, references, and player experience | A launcher with search tools. |
| `code` | Project code audit and map | A launcher with code-reading tools. |
| `docs` | Project documents and rule comparison | A launcher with file-reading tools. |
| `synthesis` | Combine results and draw conclusions | `self`: the calling model does the work without starting a process. |
`deckmate agents run` extracts assignments from `## Assignment: <role>` sections (the Russian `## Задание: <role>` is read too) in the selected workflow and looks up each role in `routing`.
Each `routing` value must name an existing launcher or be `self`, which is reserved for the calling model's own work.
Use `synthesis: self` to run synthesis in the local calling session.
### Role without a launcher: manual mode
Remove the role from `routing`; its assignment is still written, but no process starts.
The summary lists it separately. A person opens the generated `tz-<role>.md` and saves the result as `<role>.md` in the output folder.
Do not create an empty launcher or use `self` to request manual execution: an absent route makes that intent explicit.
## Substitutions in `command`
| Marker | Source | Rule |
|---|---|---|
| `{prompt}` | Assignment file created by `run` | Pass as one quoted argument. |
| `{cwd}` | Agent working directory | Pass as one quoted argument. |
| `{tools}` | `launchers.<name>.tools` | The orchestrator does not parse its contents. |
| `{cap}` | `launchers.<name>.capUsd` | A launcher whose command uses `{cap}` without `capUsd` fails validation. |
In single-quoted YAML strings, backslashes are literal; double quotes inside the string preserve Windows command arguments.
Substitutions `{area}`, `{project}`, `{date}`, `{out}`, `{engine}`, `{lens}`, `{profile}`, and `{genre}` belong to workflow text, not agent configuration keys.
## Project profile and paths
The profile at `tasks/deckmate-project.md` defines the genre, game concept, platform, references, player sources, and paths to principles and goals.
`{profile}` receives the profile path if the file exists. `{genre}` receives the path selected by the `genre` key, preferring the project version.
Workflows pass the profile to `research` assignments and synthesis; without it, they ask for the genre, references, and player sources.
`run --lens <path>` selects a lens independently of the domain or deck name. `--out <folder>` sets the output folder and allows the project to remain read-only.
Both flags can be combined with `--dry`.
## Secrets and limits
Never put API keys, tokens, or passwords in YAML or notes: launchers read their own `.env.local`.
Validation prints commands, so a secret in `command` becomes visible in the terminal and report.
`parallel` and `startGapSeconds` control process launches only; they do not replace each launcher's cost limits.
## Validation
**Command:** `npx deckmate agents run <workflow> <area> --dry`, from the project folder.
For another project, add `--project <folder>`; from a Deckmate source checkout, `npm run agents -- run <workflow> <area> --dry --project <folder>` is the same command. Validation reads the workflow and configuration, creates assignments, and prints commands without launching agents.
Check that commands contain no unresolved `{prompt}`, `{cwd}`, or `{tools}`, paths are correct, and manual roles are listed without being launched.
