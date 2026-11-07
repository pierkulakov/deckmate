---
id: expiry-test
title: "Test Power-up Edge Cases: %PARENT_TITLE%"
roleId: qa
effort: 2
dependsOn:
  - pickup-art
  - effect-logic
priority: null
zoneId: production
---

Exercise pickup and expiry near hazards and during traversal to verify that the effect remains understandable.

- [ ] Collect a duplicate while the effect is active
- [ ] Expire the effect during a jump
- [ ] Check death and respawn restore the intended state
