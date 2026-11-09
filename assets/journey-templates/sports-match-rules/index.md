---
deckmate: journey-template
schema: 1
id: sports-match-rules
title: "Sports: Match Rules"
description: Define a match rule with precise edge cases, implement its state changes and verify the result players see.
locales:
  ru:
    title: "Спорт: правила матча"
    description: Определить правило матча с точными граничными случаями, внедрить изменения состояния и проверить результат, который видят игроки.
category: Production
tags:
  - Sports
  - Production
author: Deckmate
updated: 2026-11-05
roles:
  - id: design
    title: Game Design
  - id: code
    title: Coding
  - id: art
    title: Art
  - id: qa
    title: Bugs & QA
zones:
  - id: production
    title: Production
steps:
  - steps/rulebook.md
  - steps/referee.md
  - steps/signals.md
  - steps/edge-cases.md
---
