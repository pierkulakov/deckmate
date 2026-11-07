---
id: craft
title: "Implement Crafting Transaction: %PARENT_TITLE%"
roleId: code
dependsOn:
  - requirements
effort: 5
priority: null
zoneId: production
---

Implement ingredient consumption and output delivery as one accountable recipe process. Station failure must follow the documented pause or cancellation behavior.

- [ ] Validate ingredients and station state before starting
- [ ] Handle station loss, interruption and refunds from the rules
- [ ] Apply output use and survival effects exactly once
