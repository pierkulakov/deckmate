---
deckmate: agents
schema: 1
launchers:
  claude:
    command: 'claude -p "Read {prompt} and complete the assignment." --allowedTools "{tools}"'
    tools: 'Read,Grep,Glob,Write,WebSearch,WebFetch'
  reader:
    command: 'claude -p "Read {prompt} and complete the assignment." --allowedTools "{tools}"'
    tools: 'Read,Grep,Glob,Write'
  codex:
    command: 'codex exec --full-auto "Read {prompt} and complete the assignment."'
routing:
  research: claude
  code: codex
  docs: reader
  synthesis: self
limits:
  parallel: 3
  startGapSeconds: 20
---
# Deckmate agents
This example starts [Claude Code](https://docs.claude.com/en/docs/claude-code) and the [Codex CLI](https://github.com/openai/codex) in the project folder; any command-line agent works. Keep the substitution names in braces unchanged.
**Role** means a workflow task: `research` finds sources, `code` examines code, `docs` examines documents, and `synthesis` combines the findings.
**Launcher** means a named command that starts an agent. `routing` maps a role to a launcher; `self` leaves synthesis to the calling model.
`{prompt}` becomes the assignment file path, `{cwd}` the agent's working directory, and `{tools}` the `tools` value.
The launcher receives `tools` as one string; it defines how to parse it and which tools are allowed.
`limits.parallel` caps concurrent processes; `limits.startGapSeconds` sets the interval between starts, in seconds.
Remove a role from `routing` to generate its assignment without starting a process; it can then be completed manually.
Never put API keys or passwords in this file. Each launcher reads its own `.env.local` outside the repository.
Quote paths with spaces inside the YAML string. Single-quoted YAML strings preserve Windows backslashes literally.
