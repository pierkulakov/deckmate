# Project profile — 2026-11-05
Create `<project>/tasks/deckmate-project.md` to guide `analyze` and `audit`: where to find references, which player communities to consult, and how to reject unsuitable options.

## Step 1 — gather existing information (self)
- If `tasks/deckmate-project.md` exists, read its header; ask only about empty or outdated fields.
- Find `PRODUCT.md`, `README.md`, `DESIGN.md`, and documents about goals, style, and principles in the project. Read headings and the first 40 lines; search the rest.
- Extract candidates for `genre`, `description` (game concept and core decision, or the problem the software solves), `platform`, `references` (reference games, or comparable products for software), `players` (communities), `principles` (design principles document path), and `goal` (goal document path), each with a `file:line` anchor.
- Treat a value without an anchor as a question for the user, not a fact.

## Step 2 — ask for missing information (self)
First determine the project kind from its documents and templates: a game (uses the questions below and the game fields) or a software project (uses the software branch). Ask in one message only for information missing from the documents.

Game projects:
- genre, concept, and scale (player count, session length);
- platform and controls;
- 3–6 reference games and what to borrow from each, one line per game; “the whole game” is insufficient;
- player communities: Steam, Reddit, Discord, and forums, with links;
- principles and goal documents, if you could not find them.

Software projects (no game fields; use `description` for the problem the tool solves, and `references` for comparable products):
- who the users are and the task they solve with the project;
- platform and constraints (where it runs, integrations, performance);
- 3–6 comparable products and what to borrow from each, one line per product; “everything” is insufficient;
- where users discuss such tools (forums, communities, issue trackers), with links;
- principles and goal documents, if you could not find them.

Leave a field empty if the answer is “I don't know”; do not invent a value.

## Step 3 — write (self)
Show the complete file and write it only after user approval. In an existing file, change only the affected header fields:

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

For readers: give each field's source as an anchor or “provided by <name>, <date>.”
```

- Use a lowercase genre key matching a file in `<project>/tasks/deckmate-genres/` or this skill's `genres/`; digits are allowed (`4x`). A software project with no matching genre guide leaves `genre` empty. Tell the user if no guide exists; do not invent a path.
- Keep `players` as a text field containing links and research questions, not a required YAML list. Quote YAML strings and escape embedded quotes/backslashes as needed. Use `""` for unknown text fields and `[]` for no references.
- Before writing, check that every reference has `game` and `take`, supplied community links are explicit, and nonempty `principles` and `goal` paths exist relative to the project. Leave missing paths empty. Give the user the file path and list empty fields. The complete schema above needs no files from the Deckmate repository.
