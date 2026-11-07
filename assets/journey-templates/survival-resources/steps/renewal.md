---
id: renewal
title: "Verify Resource Lifecycle: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - states
  - harvest
effort: 2
priority: null
zoneId: production
---

Gather the resource repeatedly through depletion and renewal. Check inventory counts and the survival effect of any edible output.

- [ ] Compare gathered quantities with the configured yield
- [ ] Test interrupted gathering and a full inventory
- [ ] Reload before renewal and verify the resource returns once
