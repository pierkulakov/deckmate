---
id: accounting
title: "Verify Recipe Accounting: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - throughput
effort: 2
priority: null
zoneId: production
---

Check the recipe over repeated jobs, interruption and reload. Count resources at every handoff rather than relying only on animation.

- [ ] Verify totals after ten completed cycles
- [ ] Cancel before and after consumption and check exact refunds
- [ ] Reload a queued and an active job without duplicate outputs
