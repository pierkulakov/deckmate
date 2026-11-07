# Project profile — 2026-11-05
Create `<project>/tasks/deckmate-project.md` to guide `analyze` and `audit`: where to find references, which player communities to consult, and how to reject unsuitable options.

## Step 1 — gather existing information (self)
- If `tasks/deckmate-project.md` exists, read its header; ask only about empty or outdated fields.
- Find `PRODUCT.md`, `README.md`, `DESIGN.md`, and documents about goals, style, and principles in the project. Read headings and the first 40 lines; search the rest.
- Extract candidates for `genre`, `platform`, `references`, `players`, `principles` (design principles document path), and `goal` (goal document path), each with a `file:line` anchor.
- Treat a value without an anchor as a question for the user, not a fact.

## Step 2 — ask for missing information (self)
Ask in one message only for information missing from the documents:
- genre and scale (player count, session length);
- platform and controls;
- 3–6 reference games and what to borrow from each, one line per game; “the whole game” is insufficient;
- player communities: Steam, Reddit, Discord, and forums, with links;
- principles and goal documents, if you could not find them.

Leave a field empty if the answer is “I don't know”; do not invent a value.

## Step 3 — write (self)
Show the complete file and write it only after user approval. In an existing file, change only the affected header fields:

```markdown
---
genre: <genre>
platform: <platform>
references:
  - game: <game>
    take: <what to borrow>
players:
  - <link>
principles: <design principles document path>
goal: <goal document path>
---

For readers: give each field's source as an anchor or “provided by <name>, <date>.”
```

- Use a lowercase Latin word for `genre`, matching a filename in `genres/`; tell the user if no such file exists.
- Compare with `assets/templates/deckmate-project.md` in Deckmate; the template takes precedence if formats differ.
- Before writing, check that every reference has `take`, every `players` item is a link, and the `principles` and `goal` paths exist. Give the user the file path and list empty fields.
