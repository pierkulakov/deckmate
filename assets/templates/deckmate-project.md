---
genre: rts
description: 'One or two sentences about the genre, player fantasy, and core player decision.'
platform: 'Target platforms, input devices, and performance constraints.'
references:
  - game: 'First reference game title'
    take: 'A specific mechanic, decision, or constraint to study.'
  - game: 'Second reference game title'
    take: 'Another reference point; do not copy the entire game.'
players: 'Links to communities, player reviews, streams, or other sources of player experience.'
principles: 'docs/principles.md'
goal: 'docs/goal.md'
---
# Project profile
The profile is a short research brief: genre, game concept, platform, references, player sources, and paths to principles and goals.
Workflows receive this file's path through `{profile}` and read it for `research` assignments and synthesis; its contents are not copied into every workflow.
`{genre}` points to the file selected by `genre`: first check `<project>/tasks/deckmate-genres/<key>.md`, then the built-in `skills/deckmate/genres/<key>.md`.
Built-in keys are `action`, `adventure`, `platformer`, `puzzle`, `roguelike`, `rpg`, `shooter`, `simulation`, `sports` and `survival`, plus `strategy`, which routes to `rts`, `4x` and `tactics`; add custom genres in the project folder.
Fill in `genre`, `description`, `platform`, `players`, and at least one `references` entry. Empty examples are not sufficient for research.
In `references`, `game` names the game and `take` limits the study to one useful practice; a reference is not a checklist for copying a game.
In `players`, provide specific links and say where to find the target audience's complaints, habits, analyses, and debates.
`principles` and `goal` are relative paths to project documents. If a document is missing, leave an empty string; do not invent its contents.
Without a profile, the workflow asks for the genre, references, and player sources and offers to write this file. The genre guide provides a research framework, not answers about the project.
