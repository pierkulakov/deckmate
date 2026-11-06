---
id: state
title: "Implement Puzzle State Model: %PARENT_TITLE%"
roleId: code
effort: 5
dependsOn:
  - rules
priority: null
zoneId: production
---

Implement deterministic state transitions so replaying a move sequence produces the same board.

- [ ] Represent the full puzzle state explicitly
- [ ] Implement legal moves and win detection
- [ ] Restore exact prior state on undo
