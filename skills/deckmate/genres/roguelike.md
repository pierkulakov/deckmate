---
genre: roguelike
title: Roguelikes
---
## First playable
- Hypothesis: uncertain rewards create distinct decisions worth replaying after a loss.
- Play a short fixed-room run with a small random reward pool; record picks, deaths, and replay interest.
- Create Heroes for the first encounter and reward; connect them into a complete run.
- Start with `deckmate project init roguelike --data <project>`.
## References
- Slay the Spire — study a metrics server that records every decision, with pick rates, win rates, and damage taken feeding repeated balance cycles ([GDC](https://gdcvault.com/play/1025731/)).
- Spelunky — study a generator that lays a guaranteed solution path through a 4×4 room grid before filling side rooms, traps, and treasure ([analysis](https://tinysubversions.com/spelunkyGen/)).
- Hades — study knowledge and relationships carried across runs, death as a storytelling device, and a narrative built up during Early Access ([interview](https://www.gamedeveloper.com/design/roguelikes-and-narrative-design-with-i-hades-i-creative-director-greg-kasavin)).
- Dead Cells — study hidden assists and control tricks that keep a permadeath game hardcore without rage quits ([GDC](https://www.gamedeveloper.com/design/video-how-cheating-and-making-player-life-easier-helped-i-dead-cells-i-shine)).
- FTL — study anchoring design to one feeling, captaining a starship, and dropping mechanics that did not serve it ([GDC postmortem](https://gdcvault.com/play/1018034/Designing-Without-a-Pitch-FTL)).
## Player communities
- [r/slaythespire](https://www.reddit.com/r/slaythespire/) — look for card tier debates, win-rate data, and which relics feel mandatory.
- [r/HadesTheGame](https://www.reddit.com/r/HadesTheGame/) — look for build discussion, heat settings, and how players describe story progress across runs.
- [r/roguelikes](https://www.reddit.com/r/roguelikes/) — look for debates about permadeath, meta-progression, and what counts as fair randomness.
## Genre pitfalls
- Hand-balancing hundreds of cards and interactions is beyond a small team's intuition — build a metrics server and tune from pick and win rates instead (example: Slay the Spire; [source](https://www.gamedeveloper.com/design/how-i-slay-the-spire-i-s-devs-use-data-to-balance-their-roguelike-deck-builder)).
- Random layouts without a guaranteed route produce unwinnable levels — lay the solution path through the room grid before filling side rooms, traps, and treasure (example: Spelunky; [source](https://tinysubversions.com/spelunkyGen/)).
- An option with no cost pulls players out of the intended loop — watch playtests and rework the cost before kiting becomes the game (example: Dead Cells's unlimited ammo; [source](https://www.gamedeveloper.com/design/how-watching-people-play-i-dead-cells-i-incorrectly-influenced-its-designers)).
- Permadeath that erases everything also erases the story — carry knowledge and relationships across runs and treat death as narrative (example: Hades; [source](https://www.gamedeveloper.com/design/roguelikes-and-narrative-design-with-i-hades-i-creative-director-greg-kasavin)).
