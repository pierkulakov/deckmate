---
id: turns
title: "Implement Creature Turns: %PARENT_TITLE%"
roleId: code
dependsOn:
  - battle-role
effort: 5
priority: null
zoneId: production
---

Implement the turn selection and abilities from the battle brief. The creature must handle invalid targets without stalling the battle.

- [ ] Select only legal targets and affordable abilities
- [ ] Apply and expire status effects at the specified turn boundaries
- [ ] Resolve interrupted actions and defeated targets safely
