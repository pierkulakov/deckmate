---
deckmate: project-template
schema: 1
id: backend-service
title: Backend Service
description: Endpoints, data model, runbooks and incidents for an API service other teams call.
category: software
genre: null
order: 17
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: endpoints
    space: spec
    title: Endpoints
    kind: asset
    icon: code
    color: "#5e7bd6"
    art: technologies
    description: "Routes, contracts, authentication and error behavior."
  - id: data-model
    space: spec
    title: Data Model
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: knowledge
    description: "Entities, relationships, constraints and migrations."
  - id: runbooks
    space: spec
    title: Runbooks
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: rules
    description: "Alerts, dashboards and step-by-step response runbooks."
  - id: incidents
    space: spec
    title: Incidents
    kind: asset
    icon: bug
    color: "#5e7bd6"
    art: bugs
    journey: bug-fix
    description: "Incident timeline, impact and follow-up fixes."
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
  - name: incident
    color: "#b64c5b"
    emoji: 🚨
  - name: bug
    color: "#d57240"
    emoji: 🐞
  - name: auth
    color: "#94713e"
    emoji: 🔐
  - name: breaking
    color: "#687e9c"
    emoji: ⚠️
samples:
  - deck: endpoints
    title: "GET /users/:id"
    markdown: "Return the user with the id, or 404 with a stable error code. Supports ETag; personal fields require the users:read scope."
  - deck: data-model
    title: User
    markdown: "A user belongs to one org, has an email unique per org, and is soft-deleted with the audit row kept. Exports exclude soft-deleted rows by default."
  - deck: incidents
    title: Elevated 500s on /orders
    markdown: "The error rate crossed 5% for six minutes after a deploy; rollback restored service. Follow-up: a regression test for the migration path and an alert on the error budget."
---

For services other teams depend on: endpoints, data model, runbooks and incidents in the spec; engineering and quality in production. Incidents run the Bug Fix Journey so every postmortem ends with a verified fix. Runbooks keep response steps next to the alerts that trigger them.
