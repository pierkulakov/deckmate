---
genre: puzzle
title: Puzzle games
---
## First playable
- Hypothesis: one rule produces a discovery players can understand and apply.
- Test a paper puzzle and a variation without explanation; record attempts, stalls, and rule explanations.
- Create Heroes for the core mechanic and first puzzle; include a way to undo mistakes.
- Start with `deckmate project init puzzle --data <project>`.
## References
- Portal — study chambers that train the button and box before portals, a first portal placed so players see themselves, and a chamber that introduced concepts too quickly ([developer commentary](https://theportalwiki.com/wiki/Portal_developer_commentary)).
- Baba Is You — study levels found by exploring word interactions, and cutting levels whose intended solution needed too many supporting rules ([interview](https://www.gamedeveloper.com/design/designing-i-baba-is-you-i-s-delightfully-innovative-rule-writing-system)).
- Opus Magnum — study open-ended puzzles whose toolset is expressive enough that players find optimizations the designers never planned ([GDC](https://gdcvault.com/play/1025715/Open-Ended-Puzzle-Design-at)).
- The Witness and Miegakure — study finding a mechanic's core ideas by following its rules to their consequences instead of inventing puzzles one by one ([IndieCade talk](https://marctenbosch.com/news/?p=181)).
## Player communities
- [r/puzzlevideogames](https://www.reddit.com/r/puzzlevideogames/) — look for recommendations by mechanic, complaints about difficulty spikes, and praise for games finished without a guide.
- [r/BabaIsYou](https://www.reddit.com/r/BabaIsYou/) — look for where players stall, level-editor rule sets, and reactions to late-game rule combinations.
- [r/TheWitness](https://www.reddit.com/r/TheWitness/) — look for how players describe the moment a rule clicked and which panels felt unfair.
## Genre pitfalls
- Two ideas in one level skip the lesson — even with training as a goal from the start, a chamber introducing two concepts moves too fast (example: Portal's Test Chamber 08; [source](https://theportalwiki.com/wiki/Portal_developer_commentary)).
- Levels that need many active rules at once overwhelm before they teach — cut setups that are overly specific (example: Baba Is You; [source](https://www.gamedeveloper.com/design/designing-i-baba-is-you-i-s-delightfully-innovative-rule-writing-system)).
- An unsolvable state without a cheap way back punishes experimentation — keep a broken rule one undo away (example: Baba Is You's “is you”; [source](https://www.gamedeveloper.com/design/designing-i-baba-is-you-i-s-delightfully-innovative-rule-writing-system)).
- Designing to one intended optimal solution wastes an open-ended system — leave optimal strategies unplanned and let players find them (example: Opus Magnum; [source](https://www.gamedeveloper.com/business/road-to-the-igf-zachtronics-i-opus-magnum-i-)).
- A mechanic chosen for novelty rather than its consequences runs dry — follow the mechanic's rules to consequences worth exploring before committing (example: The Witness and Miegakure; [source](https://marctenbosch.com/news/?p=181)).
