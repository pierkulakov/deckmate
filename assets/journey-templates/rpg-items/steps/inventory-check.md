---
id: inventory-check
title: "Verify Item Lifecycle: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - visuals
  - effect
effort: 2
priority: null
zoneId: production
---

Exercise the item through acquisition, use, transfer and removal. Include a full inventory and a save made while its effect is active.

- [ ] Verify equip, unequip and repeated use do not duplicate effects
- [ ] Check full inventory and invalid target behavior
- [ ] Reload an active effect and confirm its remaining duration
