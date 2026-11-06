---
id: referee
title: "Implement Rule Resolution: %PARENT_TITLE%"
roleId: code
dependsOn:
  - rulebook
effort: 5
priority: null
zoneId: production
---

Implement the rule in match state handling and record enough information to explain a decision. Repeated event delivery must not count twice.

- [ ] Apply the rule through one match-state transition
- [ ] Prevent duplicate score or penalty application
- [ ] Keep clock and restart ownership consistent
