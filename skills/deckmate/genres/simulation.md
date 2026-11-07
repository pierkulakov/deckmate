---
genre: simulation
title: Simulation games
---
## References
- Factorio — study why large-base update speed is bound by memory latency, and prefetching in the entity update loop ([Factorio blog](https://www.factorio.com/blog/post/fff-204)).
- RimWorld — study defining the game as a story generator and the design methods that followed from that frame ([GDC](https://gdcvault.com/play/1024232/-RimWorld-Contrarian-Ridiculous-and)).
- SimCity (2013) — study GlassBox agents as light resource carriers between units, capacity-limited bins, and depletable map layers ([GDC 2012](https://www.gamedeveloper.com/design/gdc-2012-breaking-down-em-simcity-em-s-glassbox-engine)).
- Oxygen Not Included — study introducing mechanics gently without tutorials and playtesting to find where players get stuck ([Klei interview](https://www.gamedeveloper.com/design/-tutorials-are-not-fun-so-a-klei-dev-offers-tips-on-avoiding-them)).
## Player communities
- [r/factorio](https://www.reddit.com/r/factorio/) — look for ratio spreadsheets, UPS complaints at scale, and how players describe production bottlenecks.
- [r/RimWorld](https://www.reddit.com/r/RimWorld/) — look for colony stories, complaints about need spirals, and debates about storyteller difficulty.
- [r/Oxygennotincluded](https://www.reddit.com/r/Oxygennotincluded/) — look for questions about hidden mechanics, heat management, and what the game failed to explain.
## Genre pitfalls
- Entity counts that fit the design can still miss the frame budget: Factorio's large bases are limited by memory latency, not arithmetic ([source](https://www.factorio.com/blog/post/fff-204)).
- Agents that carry rules as well as resources do not scale; GlassBox kept agents light to run more than ten thousand at once ([source](https://www.gamedeveloper.com/design/gdc-2012-breaking-down-em-simcity-em-s-glassbox-engine)).
- The developer of a system cannot see its learning problems; Klei relies on playtesting to find where players stall and adds only enough guidance ([source](https://www.gamedeveloper.com/design/-tutorials-are-not-fun-so-a-klei-dev-offers-tips-on-avoiding-them)).
- A simulation judged by accuracy rather than the stories it produces drifts from play: RimWorld derives its methods from the story-generator frame ([source](https://gdcvault.com/play/1024232/-RimWorld-Contrarian-Ridiculous-and)).
