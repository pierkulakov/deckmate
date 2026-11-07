---
id: branch-test
title: "Verify Dialogue Outcomes: %PARENT_TITLE%"
roleId: qa
effort: 3
dependsOn:
  - logic
  - presentation
  - cues
priority: null
zoneId: production
---

Traverse every branch and return with changed story conditions to verify that the conversation remains coherent.

- [ ] Visit every reachable choice and exit
- [ ] Test repeat visits after receiving a reward
- [ ] Check text and flags against the branch specification
