---
deckmate: project-template
schema: 1
id: puzzle
title: Puzzle
description: Puzzle mechanics, reusable elements, levels and difficulty sets with clear rules and recoverable mistakes.
category: games
genre: puzzle
order: 4
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: mechanics
    space: gdd
    title: Mechanics
    kind: asset
    icon: gamepad
    color: "#5e7bd6"
    art: game-design
    journey: puzzle-mechanics
    description: Legal actions, state transitions and win conditions.
  - id: puzzle-elements
    space: gdd
    title: Puzzle Elements
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: tools
    journey: puzzle-elements
    description: Reusable pieces with clear interaction and state feedback.
  - id: levels
    space: gdd
    title: Levels
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: maps
    journey: puzzle-levels
    description: Starting arrangements, solutions and teaching goals.
  - id: difficulty-sets
    space: gdd
    title: Difficulty Sets
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: research
    description: Level groupings that introduce and combine reasoning skills.
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
  - deck: mechanics
    title: Quarter-turn Reflection
    markdown: Each move rotates one mirror by ninety degrees. A beam updates after every move; undo restores the exact previous state. The goal is to illuminate every receiver.
  - deck: puzzle-elements
    title: Mirror Tile
    markdown: A rotatable diagonal mirror with four visible orientations. A directional mark shows how an incoming beam will turn. Locked tiles use both a lock symbol and a distinct border.
  - deck: levels
    title: First Reflection
    markdown: A small board with one movable mirror and one receiver. The starting beam points away from the target, making the effect of a single rotation easy to observe before a second mirror is introduced.
---

Keep puzzle mechanics and reusable elements separate from the levels that teach them. Mechanic, element and level Journeys define legal moves, visible state changes and solution checks. Difficulty sets group lessons and challenge variants. Optional examples use reversible beam rotation, a mirror tile and an introductory reflection level.
