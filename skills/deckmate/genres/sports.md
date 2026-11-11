---
genre: sports
title: Sports games
---
## First playable
- Hypothesis: a basic contest feels responsive and rewards player timing.
- Play a short graybox match with one scoring action; record scores, input errors, and perceived control.
- Create Heroes for the scoring action and first match; integrate rules and feedback.
- Start with `deckmate project init sports --data <project>`.
## References
- Rocket League — study the design decisions behind car and ball handling and the networked physics that make them hold up online ([GDC](https://www.gdcvault.com/play/1024972/)).
- Super Mega Baseball 2 — study Ego, a 100-step difficulty scale per mechanic instead of easy/medium/hard, and its use for fair online matches across skill levels ([interview](https://gamingbolt.com/super-mega-baseball-2-baseball-is-back-with-a-bang)).
- FIFA 22 — study a goalkeeper system rewritten around hundreds of animations and tactical AI for all 22 players ([pitch notes](https://www.ea.com/ea-play/news/pitch-notes-fifa-22-gameplay-deep-dive)).
- OlliOlli World — study optional landing timing, split routes for newcomers and veterans, and a tone built around flow ([interview](https://www.nme.com/features/gaming-features/roll7-co-founders-talk-olliolli-world-its-a-love-letter-to-skateboarding-3148282)).
## Player communities
- [r/RocketLeague](https://www.reddit.com/r/RocketLeague/) — look for input lag and server complaints, mechanics tutorials, and arena preferences.
- [r/EASportsFC](https://www.reddit.com/r/EASportsFC/) — look for complaints about responsiveness, outcomes that feel scripted, and goalkeeper behavior.
- [Operation Sports](https://forums.operationsports.com/) — look for slider sets, realism debates, and franchise and career mode expectations.
## Genre pitfalls
- Venue variety that changes the rules splits the competitive scene — keep non-standard arenas out of ranked play (example: Rocket League; [source](https://www.pcgamer.com/uk/rocket-league-is-dropping-non-standard-arenas-for-competitive-season-6)).
- Three difficulty presets leave friends of different skill with no fair game — use one long per-mechanic scale and balance it from real match data (example: Super Mega Baseball 2; [source](https://gamingbolt.com/super-mega-baseball-2-baseball-is-back-with-a-bang)).
- Physics tuned offline breaks online — design handling and netcode together (example: Rocket League; [source](https://www.gdcvault.com/play/1024972/)).
- Timing mechanics that gate completion exclude most players — make landing timing optional and split routes by skill (example: OlliOlli World; [source](https://www.nme.com/features/gaming-features/roll7-co-founders-talk-olliolli-world-its-a-love-letter-to-skateboarding-3148282)).
