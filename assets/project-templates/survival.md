---
deckmate: project-template
schema: 1
id: survival
title: Survival
description: Resource gathering, crafting, threats, hunger and shelter for a readable survival loop.
locales:
  ru:
    title: Выживание
    description: Добыча ресурсов, крафт, угрозы, голод и укрытие для читаемого цикла выживания.
category: games
genre: survival
order: 10
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: resources
    space: gdd
    title: Resources
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: tools
    journey: survival-resources
    description: Gatherable materials and food, their locations, yields and renewal.
  - id: crafting-recipes
    space: gdd
    title: Crafting Recipes
    kind: asset
    icon: tasks
    color: "#5e7bd6"
    art: technologies
    journey: survival-crafting-recipes
    description: Ingredients, tools, stations, processing and crafted outputs.
  - id: threats
    space: gdd
    title: Threats
    kind: asset
    icon: swords
    color: "#5e7bd6"
    art: units
    journey: survival-threats
    description: Hostile creatures and hazards with warnings and counterplay.
  - id: survival-needs
    space: gdd
    title: Survival Needs
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: rules
    description: Hunger, thirst, exposure, recovery and warning thresholds.
  - id: shelters
    space: gdd
    title: Shelters
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: buildings
    description: Protection, construction requirements, storage and safe rest.
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
  - deck: resources
    title: River Reeds
    markdown: Gather reeds from shallow riverbanks for fiber and edible roots. Each patch yields a limited harvest and regrows only after a defined interval. Roots restore a small amount of hunger when prepared.
  - deck: crafting-recipes
    title: Cooked Roots
    markdown: Use 2 roots and 1 fuel at a campfire to produce one meal. The meal restores hunger after eating. An extinguished fire pauses cooking; cancellation must not duplicate the ingredients.
  - deck: threats
    title: Night Prowler
    markdown: A scavenger drawn toward exposed food near camp after dark. It warns with rustling before approaching. A maintained fire deters it, while players can retreat to shelter instead of fighting.
---

Build the loop from finding resources to crafting tools and enduring threats. GDD holds resources, recipes, threats, survival needs and shelters; Production holds the work that brings them into play. Journeys cover a gatherable resource, a craftable item and a threat. Optional examples connect food gathering, cooking and an encounter near camp.
