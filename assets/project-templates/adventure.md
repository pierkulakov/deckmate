---
deckmate: project-template
schema: 1
id: adventure
title: Adventure
description: Story beats, locations, characters, puzzles and dialogue choices for exploration-led adventures.
category: games
genre: null
order: 2
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: story-chapters
    space: gdd
    title: Story Chapters
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: knowledge
    description: Dramatic beats, reveals and chapter entry conditions.
  - id: locations
    space: gdd
    title: Locations
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: maps
    journey: adventure-locations
    description: Explorable places with landmarks, exits and discoveries.
  - id: characters
    space: gdd
    title: Characters
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: units
    description: Motives, relationships and changes across the story.
  - id: puzzles
    space: gdd
    title: Puzzles
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: tools
    journey: adventure-puzzles
    description: Clues, usable objects and solution requirements.
  - id: dialogues
    space: gdd
    title: Dialogues
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: design-notes
    journey: adventure-dialogues
    description: Conversation branches, conditions and narrative consequences.
  - id: coding
    space: production
    title: Coding
    kind: task
    icon: code
    color: "#5e1f8b"
    art: coding
    roles:
      - code
    description: Gameplay systems, data integration and tools.
  - id: art
    space: production
    title: Art
    kind: task
    icon: palette
    color: "#d57240"
    art: art
    roles:
      - art
    description: Models, sprites, materials and visual effects.
  - id: game-design
    space: production
    title: Game Design
    kind: task
    icon: gamepad
    color: "#94713e"
    art: game-design
    roles:
      - design
    description: Rules, tuning and playable design experiments.
  - id: audio
    space: production
    title: Audio
    kind: task
    icon: audio
    color: "#477967"
    art: audio
    roles:
      - audio
    description: Sound effects, ambience and event timing.
  - id: bugs-qa
    space: production
    title: Bugs & QA
    kind: task
    icon: bug
    color: "#b64c5b"
    art: bugs
    roles:
      - qa
    description: Reproduction cases, regression checks and playtest findings.
  - id: ui
    space: production
    title: UI
    kind: task
    icon: image
    color: "#5d9ba4"
    art: ui
    roles:
      - ui
    description: Interaction prompts, choices and accessible feedback.
tags:
  - name: bug
    color: "#687e9c"
    emoji: 🐞
samples:
  - deck: locations
    title: Tidewatch Lighthouse
    markdown: An abandoned lighthouse overlooks a harbor. A jammed service lift blocks the upper floor; a maintenance log points toward the keeper and a hand-operated alternative.
  - deck: puzzles
    title: Brass Tide Lock
    markdown: Three rotating rings reproduce a tide diagram found in the keeper's log. Each ring has a distinct shape as well as a color; an incorrect alignment can be reset without consuming an item.
  - deck: dialogues
    title: Keeper at the Jetty
    markdown: The keeper shares the service route after the player mentions the damaged lift. Repeating the conversation preserves discovered information and avoids granting a duplicate key.
---

Keep story chapters, locations, characters, puzzles and dialogue scenes connected through clear asset briefs. Location, puzzle and dialogue Journeys cover exploration cues, clue logic and branching conversations. Optional examples introduce a lighthouse, its mechanical lock and a conversation that reveals a new route.
