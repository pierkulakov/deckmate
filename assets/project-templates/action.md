---
deckmate: project-template
schema: 1
id: action
title: Action
description: Weapons, enemies and combat maps built around responsive controls and readable threats.
locales:
  ru:
    title: Экшен
    description: Оружие, враги и боевые карты вокруг отзывчивого управления и читаемых угроз.
category: games
genre: action
order: 1
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: weapons
    space: gdd
    title: Weapons
    kind: asset
    icon: swords
    color: "#5e7bd6"
    art: tools
    journey: action-weapons
    description: Damage, range, handling and trade-offs for each weapon.
  - id: enemies
    space: gdd
    title: Enemies
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: units
    journey: action-enemies
    description: Threats with distinct tells, attack patterns and counters.
  - id: maps
    space: gdd
    title: Maps
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: maps
    journey: action-maps
    description: Combat spaces, sightlines, cover and traversal routes.
  - id: combat-abilities
    space: gdd
    title: Combat Abilities
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: technologies
    description: Dodges, parries and active skills with timing rules.
  - id: encounters
    space: gdd
    title: Encounters
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: game-design
    description: Enemy combinations and pacing for each combat beat.
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
  - deck: weapons
    title: Arc Gauntlet
    markdown: A short-range burst weapon. Three hits charge a knockback strike; missing leaves a recovery window. Test reach against a fast approaching enemy.
  - deck: enemies
    title: Shield Warden
    markdown: Blocks frontal attacks and turns slowly while winding up a shield slam. A side dodge exposes its flank. The raised shield must announce the attack before damage begins.
  - deck: maps
    title: Foundry Ring
    markdown: A compact arena around a central furnace. Two side routes let the player flank shielded enemies; a raised walkway introduces ranged pressure without hiding the exit.
---

Build the combat loop from weapons, enemies and maps, then track abilities and encounters as separate assets. Weapon, enemy and combat map Journeys connect design to art, animation, code, audio and playable checks. Optional examples demonstrate a short-range weapon, a shielded enemy and an arena with flanking routes.
