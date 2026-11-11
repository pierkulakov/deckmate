---
genre: adventure
title: Adventure games
---
## First playable
- Hypothesis: players can infer a solution from clues and enjoy the discovery.
- Test one paper or graybox scene without hints; record time stuck and clues noticed.
- Create Heroes for one location and its central puzzle; connect clue, action, and outcome.
- Start with `deckmate project init adventure --data <project>`.
## References
- Monkey Island and Thimbleweed Park — study puzzle dependency charts: non-linear puzzle chains designed without dead ends or bottlenecks ([source](https://grumpygamer.com/puzzle_dependency_charts)).
- Firewatch — study a dialog system that grew from interrupt-heavy barks into long conversations that pause and restart as the player moves ([GDC](https://gdcvault.com/play/1024000/Do-You-Copy-Dialog-System)).
- Oxenfree — study conversations that run while walking, can be interrupted, and are built so the story drives the mechanics ([GDC](https://gdcvault.com/play/1024270/Building-Game-Mechanics-to-Elevate)).
- Return of the Obra Dinn — study deduction as identifying who the dead were from environmental clues, and a 1-bit style kept readable over hours ([interview](https://www.gamedeveloper.com/design/for-lucas-pope-i-return-of-the-obra-dinn-i-was-a-bunch-of-appealing-design-problems)).
- Outer Wilds — study levels that control the pacing and delivery of narrative with knowledge as the only progression ([GDC 2020](https://gdconf.com/news/see-4d-level-design-outer-wilds-deconstructed-gdc-2020)).
## Player communities
- [r/adventuregames](https://www.reddit.com/r/adventuregames/) — look for complaints about moon-logic puzzles and pixel hunting, and praise for fair clue placement.
- [Adventure Game Studio forums](https://www.adventuregamestudio.co.uk/forums/) — look for puzzle-design threads, dialogue tooling, and postmortems of small adventures.
- [r/outerwilds](https://www.reddit.com/r/outerwilds/) — look for how players describe getting stuck, what hints they wanted, and which discoveries they remember.
## Genre pitfalls
- Backwards puzzles, arbitrary solutions, and unclear goals make players feel stupid — give every puzzle a clear end objective, obvious sub-goals, and rewarded intent (example: Monkey Island; [source](https://grumpygamer.com/why_adventure_games_suck)).
- Designing puzzles as a flowchart instead of a dependency chart produces dead ends and uneven flow — chart which puzzle unlocks which before writing any (example: Maniac Mansion; [source](https://grumpygamer.com/puzzle_dependency_charts)).
- Dialogue that stops the game turns talking into a menu — let conversation run while the player walks and can be interrupted (example: Oxenfree; [source](https://gdcvault.com/play/1024270/Building-Game-Mechanics-to-Elevate)).
- A style that reads well in a screenshot can tire over a four-hour game — outline every shape and rework rendering for long-session comfort (example: Return of the Obra Dinn; [source](https://www.gamedeveloper.com/design/for-lucas-pope-i-return-of-the-obra-dinn-i-was-a-bunch-of-appealing-design-problems)).
