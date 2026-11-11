# Write the project profile

**When:** `tasks/deckmate-project.md` is missing, empty, or stale. **Not this:** planning cards → `workflows/plan.md`; researching one area → `workflows/analyze.md`.
**Person:** answers the questions and approves the file.
**Agent:** gathers anchors from project documents, asks only for what is missing, writes after approval.

**Used by:** `analyze` and `audit` read the profile for research assignments (`{profile}`), the router suggests this workflow before them, and the profile's `genre` key selects the genre guide for `{genre}`. Without it, research assignments start from questions instead of sources.

## Steps
1. Check the existing profile — if `tasks/deckmate-project.md` exists, read its header and ask only about empty or outdated fields.
2. Gather from documents — scan `PRODUCT.md`, `README.md`, `DESIGN.md`, and goal or style documents (headings plus the first 40 lines, then search). Extract candidates for the profile fields, each with a `file:line` anchor. A fresh starter board has none of these files: skip to step 3, and take only the genre key from the starter.
3. Ask for the rest — one message, game or software branch (below), only fields without an anchor. Treat a value without an anchor as a question, not a fact; leave a field empty when the answer is "I don't know".
4. Show the complete file, write it after approval — in an existing file change only the affected header fields; then give the person the path and list the empty fields.

**Game projects:** genre, concept, and scale (players, session length) · platform and controls · 3–6 reference games with one specific behavior to borrow from each ("the whole game" is not an answer) · player communities (links) · paths to principles and goal documents.
**Software projects:** no game fields — `description` states the problem the tool solves, `references` lists comparable products with one behavior each · users and their task · platform and constraints · communities with links · principles and goal paths.

```markdown
---
genre: "<genre>"
description: "<game concept and core player decision>"
platform: "<platform, controls, and performance constraints>"
references:
  - game: "<game>"
    take: "<specific behavior to study>"
players: "<community links and what to research in each>"
principles: "<project-relative design principles document path, or empty>"
goal: "<project-relative goal document path, or empty>"
---

For readers: give each field's source as an anchor or "provided by <name>, <date>."
```

## Done when
- `tasks/deckmate-project.md` exists with the header above; the person has the path and the list of empty fields.

## Rules
- Keep the field list exactly — `genre`, `description`, `platform`, `references` (`game` + `take`), `players`, `principles`, `goal`; `players` stays one text field with links and questions, not a YAML list.
- Use a lowercase `genre` key matching `genres/<key>.md` (project `tasks/deckmate-genres/` overrides built-in; digits allowed, e.g. `4x`); software without a guide leaves `genre` empty — say so instead of inventing a path.
- Quote YAML strings; escape embedded quotes and backslashes; use `""` for unknown text fields and `[]` for no references.
- Verify before writing — every reference has `game` and `take`, community links are explicit, nonempty `principles`/`goal` paths exist relative to the project; leave missing paths empty.
- Never invent a value — an empty field is a visible question, a made-up one is silent damage.

## Pitfalls
- A `genre` key with no guide breaks `{genre}` — check the key against the genre files before writing.
- Unquoted YAML strings swallow colons and quotes silently — quote every free-text field.
