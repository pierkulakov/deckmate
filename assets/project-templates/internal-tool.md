---
deckmate: project-template
schema: 1
id: internal-tool
title: Internal Tool
description: Team requests, data sources, screens and access rules for an internal dashboard.
locales:
  ru:
    title: Внутренний инструмент
    description: Заявки команды, источники данных, экраны и правила доступа для внутреннего дашборда.
category: software
genre: null
order: 16
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: requests
    space: spec
    title: Requests
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: design-notes
    description: "Incoming requests with the team, owner and priority."
  - id: screens
    space: spec
    title: Screens
    kind: asset
    icon: image
    color: "#5e7bd6"
    art: ui
    journey: ui-screen
    description: "Each screen's purpose, layout, states and access rules."
  - id: data-access
    space: spec
    title: Data Access
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: knowledge
    description: "Datasets, queries and who may see what."
  - id: design
    space: production
    title: Product Design
    kind: task
    icon: palette
    color: "#94713e"
    art: design-notes
    roles:
      - design
    description: Product decisions, user flows and scope.
  - id: interface
    space: production
    title: Interface
    kind: task
    icon: image
    color: "#5d9ba4"
    art: ui
    roles:
      - ui
    description: Screen details, states and accessible interactions.
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
  - name: request
    color: "#5e7bd6"
    emoji: 📥
  - name: data
    color: "#5d9ba4"
    emoji: 📊
  - name: access
    color: "#b64c5b"
    emoji: 🔑
  - name: urgent
    color: "#d57240"
    emoji: ⚡
samples:
  - deck: requests
    title: Export for the weekly review
    markdown: "The ops team needs a Monday-morning CSV of last week's orders by region. It is hand-built in a spreadsheet today; owner and due date agreed with the requester."
  - deck: screens
    title: Order Search
    markdown: "Find orders by number, customer or status, with results under one second. Filters stay in the URL so a search can be shared; empty states suggest the two most common filters."
  - deck: data-access
    title: Support view of orders
    markdown: "Read access to orders and refunds for the support role. Personal data columns are hidden by default and unlocked per session with a logged reason."
---

For dashboards and internal tools that people request rather than buy: requests, screens and data access in the spec; design, interface and quality in production. Screens run the UI Screen Journey from purpose to accessibility checks. Access rules live next to the data they protect.
