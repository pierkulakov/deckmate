---
deckmate: project-template
schema: 1
id: pet-project
title: Pet Project
description: One idea, an honest MVP cut and a short task list for a spare-time build.
locales:
  ru:
    title: Пет-проект
    description: Одна идея, честное урезание до MVP и короткий список задач для сборки в свободное время.
category: software
genre: null
order: 11
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: ideas
    space: spec
    title: Ideas
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: design-notes
    description: The idea, its audience and why it is worth building.
  - id: mvp
    space: spec
    title: MVP Scope
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: rules
    description: "The smallest shippable version: in scope, out of scope, saved for later."
  - id: engineering
    space: production
    title: Engineering
    kind: task
    icon: code
    color: "#5e1f8b"
    art: coding
    roles:
      - code
    description: Implementation, data integration and developer tooling.
tags:
  - name: idea
    color: "#e0a63e"
    emoji: 💡
  - name: mvp
    color: "#5e9c76"
    emoji: 🚀
  - name: later
    color: "#687e9c"
    emoji: 🧊
samples:
  - deck: ideas
    title: Recipe Radar
    markdown: "Track the recipes you actually cook and turn them into a weekly shopping list. The first version searches by ingredient only; accounts and sharing can wait."
  - deck: mvp
    title: "MVP: Search and List"
    markdown: "In scope: ingredient search, a seven-day shopping list and local storage. Out of scope: accounts, sharing and price lookup. Target: a phone-first web build in four spare evenings."
---

For one-person spare-time builds: one deck for the idea, one for the MVP cut and one deck for the work. No roles or Journeys to configure — write the idea down, cut the scope and start building. Grow into a fuller template when the project outgrows it.
