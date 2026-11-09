---
deckmate: journey-template
schema: 1
id: bug-fix
title: Bug Fix
description: Take a bug from reproduction through root cause analysis, a fix, a regression test, and reporter verification.
locales:
  ru:
    title: Исправление бага
    description: Провести баг от воспроизведения через поиск первопричины, исправление, регрессионный тест и проверку тем, кто сообщил о баге.
category: QA
tags: [QA]
author: Deckmate
updated: 2026-11-04
roles:
  - { id: qa, title: QA }
  - { id: code, title: Coding }
zones:
  - { id: diagnostics, title: Diagnostics }
  - { id: fix, title: Fix }
  - { id: verification, title: Verification }
steps: [steps/reproduce.md, steps/cause.md, steps/fix.md, steps/regression.md, steps/author-check.md]
---
