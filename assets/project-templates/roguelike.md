---
deckmate: project-template
schema: 1
id: roguelike
title: Roguelike
description: Characters, items, enemies and room types for varied runs and lasting progression.
category: games
genre: roguelike
order: 5
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: characters
    space: gdd
    title: Characters
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: units
    description: Playable characters, starting kits and run identities.
  - id: items-power-ups
    space: gdd
    title: Items & Power-ups
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: tools
    description: Run-changing items, temporary bonuses and interactions.
    journey: roguelike-items-power-ups
  - id: enemies
    space: gdd
    title: Enemies
    kind: asset
    icon: swords
    color: "#5e7bd6"
    art: units
    description: Enemy patterns, threats and readable counters.
    journey: roguelike-enemies
  - id: room-types
    space: gdd
    title: Room Types
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: maps
    description: Reusable encounters, rewards and room connections.
    journey: roguelike-room-types
  - id: meta-progression
    space: gdd
    title: Meta-Progression
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: technologies
    description: Unlocks and rewards that survive the end of a run.
  - id: design-notes
    space: gdd
    title: Design Notes
    kind: knowledge
    icon: book
    color: "#687e9c"
    art: design-notes
    description: Design decisions, open questions and playtest observations.
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
tags:
  - name: bug
    color: "#687e9c"
    emoji: 🐞
samples:
  - deck: enemies
    title: Goblin
    markdown: A fast scavenger that winds up a short lunge, then retreats. The player can dodge sideways during the wind-up.
      Specify the tell, recovery window and behavior when its route is blocked.
  - deck: items-power-ups
    title: Fire Sword
    markdown: Melee hits apply a brief burn. Repeated hits refresh its duration rather than increasing its damage. Define
      feedback, stacking with other effects and cleanup when the weapon is replaced.
  - deck: room-types
    title: Combat Arena
    markdown: A compact combat room with two entrances, a central obstacle and a reward exit. Spawn enemies outside the
      entry safe area. Every entrance must lead to a reachable reward after the encounter ends.
---

Build a run from enemy patterns, item interactions and reusable rooms. Three Journeys turn those definitions into art, effects, logic, sound and tuning work. Characters and Meta-Progression hold starting kits and lasting unlocks; Design Notes captures shared decisions. Optional example Heroes show an enemy, an item and a room with their production steps.
