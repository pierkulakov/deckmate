---
id: full-match
title: "Verify Venue Match Flow: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - surface
  - ambience
effort: 3
priority: null
zoneId: production
---

Play a full match and deliberately trigger boundary cases. Include every restart type and camera movement near the edge of the field.

- [ ] Test scoring areas, out-of-bounds and each restart location
- [ ] Check camera coverage at corners and behind scoring areas
- [ ] Complete a match with no trapped players or hidden play
