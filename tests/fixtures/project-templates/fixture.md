---
deckmate: project-template
schema: 1
id: fixture
title: Fixture
description: A small project template for catalog integration tests.
genre: rts
order: 1
spaces:
  - { id: gdd, title: Game Design Documents (GDD), kind: gdd }
  - { id: production, title: Production, kind: tasks }
decks:
  - { id: units, space: gdd, title: Units, kind: asset, icon: swords, color: '#5e7bd6', art: units, journey: fixture-units, description: Units and counters. }
  - { id: coding, space: production, title: Coding, kind: task, icon: code, color: '#5e1f8b', roles: [code], description: Gameplay systems. }
tags:
  - { name: bug, color: '#687e9c', emoji: '🐞' }
samples:
  - { deck: units, title: Footman, markdown: Cheap frontline infantry. }
  - { deck: units, title: Archer, markdown: Ranged support behind the frontline. }
---
Create a small unit roster and its implementation work.
