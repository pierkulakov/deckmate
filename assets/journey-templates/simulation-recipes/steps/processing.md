---
id: processing
title: "Implement Recipe Processing: %PARENT_TITLE%"
roleId: code
dependsOn:
  - formula
effort: 3
priority: null
zoneId: production
---

Add the recipe to facility data and its production queue. A job must never spend the same input twice or discard output silently.

- [ ] Reserve inputs atomically when the job starts
- [ ] Apply the documented cancellation and refund rules
- [ ] Pause safely if output capacity becomes insufficient
