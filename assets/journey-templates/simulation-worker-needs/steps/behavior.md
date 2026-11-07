---
id: behavior
title: "Implement Need-Seeking Behavior: %PARENT_TITLE%"
roleId: code
dependsOn:
  - thresholds
effort: 5
priority: null
zoneId: production
---

Implement need updates and the decision to seek a reachable service or resource. A failed attempt must not trap the worker in a retry loop.

- [ ] Choose only reachable satisfaction targets
- [ ] Resume or cancel interrupted work according to the rules
- [ ] Rate-limit failed attempts and preserve need values in saves
