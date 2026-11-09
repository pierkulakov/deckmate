---
deckmate: project-template
schema: 1
id: rpg
title: RPG
description: Quests, items, creatures and conversations for a party adventure with turn-based combat.
locales:
  ru:
    title: RPG
    description: Квесты, предметы, существа и разговоры для группового приключения с пошаговым боем.
category: games
genre: rpg
order: 6
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: quests
    space: gdd
    title: Quests
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: knowledge
    journey: rpg-quests
    description: Objectives, choices, prerequisites and rewards.
  - id: items
    space: gdd
    title: Items
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: tools
    journey: rpg-items
    description: Equipment, consumables, restrictions and item effects.
  - id: creatures
    space: gdd
    title: Creatures
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: units
    journey: rpg-creatures
    description: Allies and enemies with battle roles and encounter behavior.
  - id: combat-abilities
    space: gdd
    title: Combat Abilities
    kind: asset
    icon: swords
    color: "#5e7bd6"
    art: game-design
    description: Turn costs, targeting rules, status effects and counterplay.
  - id: dialogues
    space: gdd
    title: Dialogues
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: design-notes
    description: Conversation branches, speaker intent and consequences.
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
  - deck: quests
    title: The Missing Courier
    markdown: Find a courier at the flooded pass. Recover the medicine or deliver their warning first; the choice changes the village reward and a later conversation. Both routes must resolve the quest.
  - deck: items
    title: Ember Ring
    markdown: A ring that converts one basic attack per battle into fire damage. Its charge resets after combat; equipping another copy cannot grant extra charges. Intended for an early optional reward.
  - deck: creatures
    title: Mossback Guardian
    markdown: A slow defender that spends one turn bracing before a heavy strike. Breaking its guard opens a recovery turn. Use one in a tutorial encounter to teach turn order and status effects.
---

Build an adventure around choices, rewards and a readable turn-based battle system. Keep quests, items, creatures, combat abilities and dialogue in GDD; send implementation work to Production. Journeys cover a branching quest, an equippable item and a combat creature. Optional examples give each of those paths a starting brief.
