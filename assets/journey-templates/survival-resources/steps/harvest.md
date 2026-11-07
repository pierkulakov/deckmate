---
id: harvest
title: "Implement Resource Harvesting: %PARENT_TITLE%"
roleId: code
dependsOn:
  - yield
effort: 3
priority: null
zoneId: production
---

Connect harvesting to inventory and renewal data. Apply each yield once, including when gathering is canceled or the inventory is full.

- [ ] Grant the documented yield only on completed gathering
- [ ] Handle cancellation and full inventory without lost resources
- [ ] Persist depletion and renewal timing across saves
