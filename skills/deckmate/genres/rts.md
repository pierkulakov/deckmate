---
genre: rts
title: Real-time strategy
---
## References
- StarCraft II — study the dynamic navigation mesh, path smoothing, and steering during group collisions ([GDC](https://www.gdcvault.com/play/1014514/AI-Navigation-It-s-Not)).
- Age of Empires II — study collisions and formations, deterministic replays, and the cost of fixing familiar behavior ([Meeting C++](https://meetingcpp.com/mcpp/slides/2025/25%2B%20Years%20of%20Pathfinding%20Problems442903.pdf)).
- Supreme Commander — study strategic zoom, issuing orders from the strategic view, and the boundary between overview and precise selection ([interview](https://www.gamespot.com/articles/supreme-commander-updated-qanda-army-size-strategic-view-and-nuclear-warfare/1100-6164174/)).
- Company of Heroes 3 — study how terrain, capture points, squads, and vehicles interact with a map tested through Custom Game ([practice](https://coh3stats.com/news/4588629064114889345)).
## Player communities
- [r/starcraft](https://www.reddit.com/r/starcraft/) — look for replay analysis, balance debates, newcomer progression, and competitive play habits.
- [r/CompanyOfHeroes](https://www.reddit.com/r/CompanyOfHeroes/) — look for complaints about readability, map control, factions, and analysis of team decisions.
## Genre pitfalls
- Changing pathfinding without replay checks alters familiar formations and outcomes: Age of Empires II treats behavioral compatibility as a separate constraint ([source](https://meetingcpp.com/mcpp/slides/2025/25%2B%20Years%20of%20Pathfinding%20Problems442903.pdf)).
- A distant overview without precise orders does not replace squad control: Supreme Commander separates the strategic view from individual unit interaction ([source](https://www.gamespot.com/articles/supreme-commander-updated-qanda-army-size-strategic-view-and-nuclear-warfare/1100-6164174/)).
- Resource cost without comparison to gameplay value collapses strategic variety; evaluate scarcity and choice together ([economy analysis](https://www.gamedeveloper.com/business/in-game-economics-for-strategy-games)).
