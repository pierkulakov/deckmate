---
id: effect-logic
title: "Implement Pickup and Expiry: %PARENT_TITLE%"
roleId: code
effort: 3
dependsOn:
  - effect
priority: null
zoneId: production
---

Apply and remove the movement effect consistently, including repeated collection and checkpoint recovery.

- [ ] Apply the effect once per pickup
- [ ] Handle stacking and expiry using the specified rules
- [ ] Restore correct movement values after respawn
