---
id: blocked-flow
title: "Verify Building Resource Flow: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - visuals
  - simulation
  - ambience
effort: 3
priority: null
zoneId: production
---

Test the facility through a complete production cycle and each interruption. Check resource totals before and after each transition.

- [ ] Verify normal production conserves the documented resources
- [ ] Block access, remove workers and fill output storage in turn
- [ ] Reload a paused job and confirm it resumes once the cause is removed
