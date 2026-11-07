---
id: interruptions
title: "Verify Crafting Interruptions: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - output
  - craft
effort: 3
priority: null
zoneId: production
---

Test successful crafting and every point where the player or world can interrupt it. Check the inventory before and after each attempt.

- [ ] Complete the recipe and use its output for the stated effect
- [ ] Cancel, lose the station and fill inventory during crafting
- [ ] Save and reload an active craft without extra outputs or lost ingredients
