---
deckmate: journey-template
schema: 1
id: character-animation
title: Animation Set
description: Create a character animation set from the clip list through blocking, polish, blending, and in-game verification.
locales:
  ru:
    title: Набор анимаций
    description: "Создать набор анимаций персонажа: от списка клипов через черновую раскладку, шлифовку и блендинг до проверки в игре."
category: Production
tags: [3D]
author: Deckmate
updated: 2026-11-04
roles:
  - { id: animation, title: Animation }
  - { id: code, title: Coding }
  - { id: qa, title: QA }
zones:
  - { id: prep, title: Preparation }
  - { id: production, title: Production }
  - { id: verification, title: Verification }
steps: [steps/clips.md, steps/blocking.md, steps/polish.md, steps/blending.md, steps/check.md]
---
