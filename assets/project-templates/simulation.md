---
deckmate: project-template
schema: 1
id: simulation
title: Simulation
description: Resources, buildings, recipes and worker needs for a simulation of production and everyday life.
category: games
genre: null
order: 7
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
    description: Sources, sinks, storage and units of simulated resources.
  - id: buildings
    space: gdd
    title: Buildings
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: buildings
    journey: simulation-buildings
    description: Facilities, placement rules, capacity and operating behavior.
  - id: recipes
    space: gdd
    title: Production Recipes
    kind: asset
    icon: tasks
    color: "#5e7bd6"
    art: technologies
    journey: simulation-recipes
    description: Inputs, outputs, processing times and by-products.
  - id: worker-needs
    space: gdd
    title: Worker Needs
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: units
    journey: simulation-worker-needs
    description: Needs, satisfaction thresholds and effects on worker behavior.
  - id: services
    space: gdd
    title: Services
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: rules
    description: Access, coverage and capacity for shared worker services.
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
  - deck: buildings
    title: Community Bakery
    markdown: A two-worker building that consumes flour and fuel to produce bread. It pauses when output storage is full and resumes without losing a batch. Place its entrance on a connected road.
  - deck: recipes
    title: Bread Batch
    markdown: Convert 2 flour and 1 fuel into 4 bread after one production cycle. Reserve inputs at the start, deliver output at completion and return reserved inputs if the job is canceled before processing.
  - deck: worker-needs
    title: Daily Meal
    markdown: Workers seek one meal when hunger crosses a threshold. Reachable food restores the need; an unmet need reduces work speed gradually. Workers should not abandon the same job repeatedly to seek unavailable food.
---

Model how resources move through buildings and recipes, and how worker needs affect the system. GDD holds the simulation rules; Production holds implementation and verification. Journeys take a building, a production recipe and a worker need from a short brief to observable behavior. Optional examples form a small food-production loop.
