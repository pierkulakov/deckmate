---
id: template
title: Build Room Template
roleId: code
dependsOn:
  - layout
effort: 5
priority: null
zoneId: production
---

Build a reusable room with connectors, spawn markers and completion logic. Check that the generator can rotate or combine it only in supported configurations.

- [ ] Validate connectors and reachability for each supported orientation
- [ ] Connect spawn and reward markers to room data
- [ ] Verify completion, reset and repeated generation without stale state
