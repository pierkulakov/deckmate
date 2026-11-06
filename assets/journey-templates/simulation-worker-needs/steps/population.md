---
id: population
title: "Verify Need Across Workers: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - behavior
  - feedback
effort: 3
priority: null
zoneId: production
---

Run a small population through satisfied, scarce and unreachable-service conditions. Observe both individual recovery and competition for capacity.

- [ ] Check thresholds and recovery at normal simulation speed
- [ ] Test scarce resources and a fully occupied service
- [ ] Remove access and confirm workers recover when it returns
