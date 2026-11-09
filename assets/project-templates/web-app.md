---
deckmate: project-template
schema: 1
id: web-app
title: Web App
description: Features, screens, API endpoints, bugs and release slices for a web product.
locales:
  ru:
    title: Веб-приложение
    description: Фичи, экраны, эндпоинты API, баги и релизные срезы для веб-продукта.
category: software
genre: null
order: 12
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: features
    space: spec
    title: Features
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: design-notes
    description: "Feature briefs: the problem, the behavior and how it is accepted."
  - id: screens
    space: spec
    title: Screens
    kind: asset
    icon: image
    color: "#5e7bd6"
    art: ui
    description: "Each screen's purpose, layout, states and flows."
  - id: api
    space: spec
    title: API
    kind: asset
    icon: code
    color: "#5e7bd6"
    art: knowledge
    description: "Endpoints, contracts, authentication and error behavior."
  - id: bugs
    space: spec
    title: Bugs
    kind: asset
    icon: bug
    color: "#5e7bd6"
    art: bugs
    journey: bug-fix
    description: Reported defects with reproduction steps and severity.
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
  - id: quality
    space: production
    title: Quality
    kind: task
    icon: bug
    color: "#b64c5b"
    art: bugs
    roles:
      - qa
    description: Reproductions, regression checks and release verification.
tags:
  - name: feature
    color: "#5e7bd6"
    emoji: ✨
  - name: api
    color: "#94713e"
    emoji: 🔌
  - name: bug
    color: "#b64c5b"
    emoji: 🐞
  - name: release
    color: "#5e9c76"
    emoji: 🚢
samples:
  - deck: features
    title: Saved Filters
    markdown: "Let users save a filter set and reuse it from the list header. The first version stores a name and the filters per account; sharing and defaults come later."
  - deck: api
    title: POST /sessions
    markdown: "Create a session from email and password. Returns the user and a token on success; unknown credentials get a 401 with a generic message. Rate limit: five attempts per minute per account."
  - deck: bugs
    title: Coupon freezes checkout
    markdown: "Applying a coupon on the review step spins forever on the second attempt. Reproduces with an expired code only; the first attempt shows the correct error message."
---

A product spine for SaaS and web tools: features, screens and API contracts in the spec; engineering and quality in production. The Bugs deck runs the Bug Fix Journey from reproduction to verified fix. Release slices stay visible as cards in Features, tagged for the release they ship in.
