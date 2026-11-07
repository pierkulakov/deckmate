---
id: regression
title: "Add a Regression Test: %PARENT_TITLE%"
roleId: qa
dependsOn: [fix]
effort: 2
priority: null
zoneId: fix
---

Protect the fix with a test based on the reproduction steps. Done when the test fails on the old code, passes on the new code, and is included in the test suite.

- [ ] Write a test based on the reproduction steps
- [ ] Confirm failure on the old code
- [ ] Add the test to the test suite
