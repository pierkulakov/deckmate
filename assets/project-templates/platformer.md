---
deckmate: project-template
schema: 1
id: platformer
title: Platformer
description: Movement abilities, levels, enemies and power-ups for precise jumps and readable traversal challenges.
category: games
genre: platformer
order: 3
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: movement-abilities
    space: gdd
    title: Movement Abilities
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: animation
    journey: platformer-movement-abilities
    description: Jump, dash and traversal rules with measurable ranges.
  - id: levels
    space: gdd
    title: Levels
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: maps
    journey: platformer-levels
    description: Routes that teach, combine and test movement skills.
  - id: enemies
    space: gdd
    title: Enemies
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: units
    description: Opponents whose timing interacts with traversal.
  - id: power-ups
    space: gdd
    title: Power-ups
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: technologies
    journey: platformer-power-ups
    description: Temporary or persistent changes to player abilities.
  - id: hazards
    space: gdd
    title: Hazards
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: tools
    description: Traps, moving surfaces and recoverable failure states.
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
  - id: animation
    space: production
    title: Animation
    kind: task
    icon: activity
    color: "#a66dc2"
    art: animation
    roles:
      - animation
    description: Movement, transitions and readable action timing.
tags:
  - name: bug
    color: "#687e9c"
    emoji: 🐞
samples:
  - deck: movement-abilities
    title: Air Dash
    markdown: A single horizontal burst available once per jump. Landing restores the charge. Keep the dash distance fixed so level gaps can teach and test its reach.
  - deck: levels
    title: Windmill Ascent
    markdown: A short vertical route introduces the air dash over safe ground, combines it with rotating platforms and finishes at a checkpoint before the final gap.
  - deck: power-ups
    title: Spring Seed
    markdown: Temporarily raises jump height. The remaining effect is shown before the player commits to a gap; expiration cannot remove a jump already in progress.
---

Organize movement abilities, levels, enemies, power-ups and hazards around the player controller. Movement, level and power-up Journeys establish measurable traversal rules, teach them in playable spaces and check recovery after failure. Optional examples cover an air dash, a windmill route and a temporary jump boost.
