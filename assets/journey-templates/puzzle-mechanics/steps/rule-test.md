---
id: rule-test
title: "Verify Rule Consistency: %PARENT_TITLE%"
roleId: qa
effort: 3
dependsOn:
  - feedback
priority: null
zoneId: production
---

Exercise the rule across small board states and repeated undo cycles.

- [ ] Replay a recorded solution from reset
- [ ] Check rejected moves leave the state unchanged
- [ ] Verify undo across a winning move and a dead end
