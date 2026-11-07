---
id: encounter
title: "Verify Creature Encounter: %PARENT_TITLE%"
roleId: qa
dependsOn:
  - visuals
  - turns
  - sound
effort: 3
priority: null
zoneId: production
---

Run an encounter at the target party level and check that the intended response works. Record failures in battle logic separately from balance observations.

- [ ] Complete encounters using both intended counterplay and a poor matchup
- [ ] Check turn order after stun, defeat and revival
- [ ] Verify intent, animation and sound agree on each attack
