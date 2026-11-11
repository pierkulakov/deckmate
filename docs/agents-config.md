# Deckmate agent configuration
Project file: `tasks/deckmate-agents.md`. Put YAML frontmatter between `---` markers and human-readable notes below the closing marker.
See [`assets/templates/deckmate-agents.md`](../assets/templates/deckmate-agents.md) for example launchers.
## Keys
| Key | Type and requirement | Meaning |
|---|---|---|
| `deckmate` | String, required | Format marker; must be `agents`. |
| `schema` | Integer, required | Schema version; supports `1`. |
| `launchers` | Object, required | Named launchers available for routing. |
| `launchers.<name>.run` | Non-empty list of strings; executable must be non-empty | Executable followed by arguments, which may be empty; use either `run` or trusted `command`, never both. |
| `launchers.<name>.command` | Non-empty string, only with `shell: true` | Explicitly trusted shell command, instead of `run`. |
| `launchers.<name>.shell` | Boolean, optional | `true` opts into trusted shell execution and requires `command`; `run` permits only `false` or omission. |
| `launchers.<name>.tools` | String, optional | Tool list for `{tools}`; the launcher defines its meaning. |
| `launchers.<name>.capUsd` | Finite number > 0, optional; required by `{cap}` | Cost cap passed to the launcher through `{cap}`. |
| `routing` | Object, required | Maps each role to a launcher name or `self`. |
| `limits` | Object, required | Orchestrator limits, not model limits. |
| `limits.parallel` | Safe integer ≥ 1, required | Maximum number of concurrent agents in one `run`. |
| `limits.startGapSeconds` | Finite number ≥ 0, required | Minimum interval between process starts, in seconds. |
Launcher names are local to the file and are not reserved identifiers.
If `run` or `command` contains `{tools}`, give the launcher a `tools` field: without it `{tools}` becomes an empty string.
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
The summary marks it `manual: no launcher`. A person opens the generated `tz-<role>.md` and saves the result as `<role>.md` in the output folder. A `self` route also starts no process and is displayed with the same status; the calling model handles that work.
Do not create an empty launcher or use `self` to request manual execution: an absent route makes that intent explicit.
## Substitutions in `run`
| Marker | Source | Rule |
|---|---|---|
| `{prompt}` | Assignment file created by `run` | Replaced as literal text within one list element. |
| `{cwd}` | Agent working directory | Replaced as literal text within one list element. |
| `{tools}` | `launchers.<name>.tools` | The orchestrator does not parse its contents. |
| `{cap}` | `launchers.<name>.capUsd` | A launcher using `{cap}` without `capUsd` fails validation. |
`run[0]` is the executable; the remaining elements are individual arguments. For example:
```yaml
run: ['agent', 'Read {prompt} and complete the assignment.', '--cwd', '{cwd}']
```
Each element is substituted once as plain text; it is never split or interpreted during substitution. Do not add shell quotes around path markers: those quotes would become part of the argument. In single-quoted YAML strings, backslashes are literal.
Deckmate launches executables with `shell: false`. On Windows it resolves executable names through `PATH` and `PATHEXT`; `.exe` and `.com` run directly with Node's argument quoting. Quotes, `%PATH%`, `!x!`, shell metacharacters and trailing backslashes remain literal argument text for these direct targets; Windows arguments containing CR or LF are rejected.
Windows `.cmd` and `.bat` targets (including npm shims) use an explicit `cmd.exe /d /s /c` adapter. Before starting any process, Deckmate refuses any argument or resolved script path containing CR, LF, `%`, `!` or `"`, naming the launcher and offending value in the error. This prevents BatBadBut-style command injection (CVE-2024-27980): `cmd.exe` parses the command line, and an npm shim expands `%*` again. Allowed values are double-quoted, with trailing backslashes doubled and no caret escaping; spaces, `&`, `|`, `^`, `(`, `)`, `<`, `>` and trailing backslashes remain literal. The `%`, `!` and `"` restrictions do not apply to direct `.exe` or `.com` targets.
Bare executable names are looked up in `PATH` only, without an implicit search of the project directory; empty Windows `PATH` entries are ignored. Use `./name` for a project-local script. Explicit relative paths resolve against the agent's working directory.
### Explicitly trusted shell mode
Use `command` only together with `shell: true`, and never with `run`. A legacy `command` without this opt-in fails validation; prefer migrating it to `run`.
`{prompt}` and `{cwd}` are forbidden in `command`. Deckmate instead provides the exact paths in the environment variables `DECKMATE_PROMPT` and `DECKMATE_CWD`, together with the inherited environment. Use the quoting and variable syntax appropriate to your shell, for example on POSIX:
```yaml
command: 'agent "$DECKMATE_PROMPT" --cwd "$DECKMATE_CWD" --tools "{tools}"'
shell: true
tools: 'Read,Write'
```
For Windows cmd, quote both variables:
```yaml
command: 'agent "%DECKMATE_PROMPT%" --cwd "%DECKMATE_CWD%" --tools "{tools}"'
shell: true
tools: 'Read,Write'
```
Only `{tools}` and `{cap}` are substituted into `command`, as trusted, unescaped text. `shell: true` makes shell behaviour, variable expansion and command safety the user's responsibility; prefer `run` for literal arguments.
Substitutions `{area}`, `{project}`, `{date}`, `{out}`, `{engine}`, `{lens}`, `{profile}`, and `{genre}` belong to workflow text, not agent configuration keys.
## Project profile and paths
The profile at `tasks/deckmate-project.md` defines the genre, game concept, platform, references, player sources, and paths to principles and goals.
`{profile}` receives the profile path if the file exists. `{genre}` receives the path selected by the `genre` key, preferring the project version.
Research assignments receive the profile and genre paths, and the calling model uses the same profile for synthesis. The calling session suggests writing a missing profile (the router does so before `analyze` and `audit`); the runner does not create it and passes empty values. Empty `{profile}` or `{genre}` values mean that the corresponding file is absent and must not be invented.
`run --lens <path>` selects a lens independently of the domain or deck name. `--out <folder>` sets the output folder and allows the project to remain read-only.
Both flags can be combined with `--dry`.
## Secrets and limits
Never put API keys, tokens, or passwords in YAML or notes: launchers read their own `.env.local`.
Validation prints launch arguments and trusted shell commands, so secrets in `run`, `command` or `tools` become visible in the terminal and report.
`parallel` and `startGapSeconds` control process launches only; they do not replace each launcher's cost limits.
## Validation
**Command:** `npx deckmate agents run <workflow> <area> --dry`, from the project folder.
For another project, add `--project <folder>`; from a Deckmate source checkout, `npm run agents -- run <workflow> <area> --dry --project <folder>` is the same command. Validation reads the workflow and configuration, creates assignments, and prints each final `run` as a JSON array without launching agents. Trusted shell launchers print a JSON object containing `command` and the two path environment variables.
Check that arguments contain no unresolved `{prompt}`, `{cwd}`, or `{tools}`, paths are correct, and manual roles are listed without being launched. Executable resolution happens only on an actual launch.
