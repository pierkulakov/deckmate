---
deckmate: project-template
schema: 1
id: strategy
title: Strategy
description: Units, buildings, technologies and maps for RTS, 4X and tactics.
category: games
genre: rts
order: 9
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: units
    space: gdd
    title: Units
    kind: asset
    icon: swords
    color: "#5e7bd6"
    art: units
    description: Unit roles, counters and battlefield behavior.
    journey: strategy-units
  - id: buildings
    space: gdd
    title: Buildings
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: buildings
    description: Structures, construction costs and production output.
    journey: strategy-buildings
  - id: technologies
    space: gdd
    title: Technologies
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: technologies
    description: Research unlocks, costs and strategic trade-offs.
    journey: strategy-technologies
  - id: maps
    space: gdd
    title: Maps
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: maps
    description: Starting positions, routes, resources and objectives.
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
tags:
  - name: bug
    color: "#687e9c"
    emoji: 🐞
samples:
  - deck: units
    title: Footman
    markdown: Cheap frontline infantry that holds a narrow approach. Strong when supported; vulnerable to ranged focus fire.
      Define cost, movement speed and two counter matchups before tuning.
  - deck: buildings
    title: Watchtower
    markdown: A stationary lookout that reveals approaching enemies but cannot attack. It costs a builder action and
      competes with early economy spending. Specify vision range, build time and destruction feedback.
  - deck: technologies
    title: Steel Tools
    markdown: A one-time research upgrade that improves worker gathering. Its cost delays the first expansion. Compare the
      break-even time on short and long matches; the bonus must never stack with itself.
---

Keep unit, building and technology definitions beside the work that produces them. Three Journeys cover 3D art, unit animation, gameplay logic, sound and balance, with a short icon-to-effect path for technologies. Maps and Design Notes provide space for terrain plans and shared decisions. Optional example Heroes demonstrate each Journey.
