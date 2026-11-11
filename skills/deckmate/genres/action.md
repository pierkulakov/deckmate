---
genre: action
title: Action games
---
## First playable
- Hypothesis: a readable attack and response make a close encounter satisfying.
- Play a graybox duel; record missed threat cues, hits taken, and player reactions.
- Create Heroes for one weapon and one enemy; integrate them in a playable encounter.
- Start with `deckmate project init action --data <project>`.
## References
- God of War (2018) — study how a close, player-controlled camera forced a redesign of enemy placement and threat cues while keeping the series' combat identity ([GDC](https://www.gdcvault.com/play/1026423/Evolving-Combat-in-God-of)).
- Monster Hunter: World — study concept design through prototyping: a living, interconnected world and monster behavior tested before weapons were tuned ([GDC postmortem](https://gdcvault.com/play/1024981/-Monster-Hunter-World-Postmortem)).
- Dead Cells — study weapon identity through held animation frames, a hit freeze on critical strikes, conditional criticals, and pairing with a secondary weapon ([interview](https://www.gamedeveloper.com/design/designing-each-of-the-50-weapons-in-i-dead-cells-i-to-feel-distinctive)).
- Sifu — study the balance between credible martial-arts animation and cinematic readability, and the environment as part of every fight ([interview](https://www.unrealengine.com/en-US/developer-interviews/old-boy-john-wick-sifu-the-design-of-a-pak-mei-master)).
- The Art of Screenshake — study how screen shake, hit pauses, muzzle flash, and knockback change the feel of the same game one layer at a time ([talk](https://www.youtube.com/watch?v=AJdEqssNZ-U)).
## Player communities
- [r/MonsterHunter](https://www.reddit.com/r/MonsterHunter/) — look for weapon loyalty, hitbox complaints, and how players describe monster tells and openings.
- [r/GodofWar](https://www.reddit.com/r/GodofWar/) — look for debates about the camera, off-screen attack indicators, enemy variety, and difficulty settings.
- [r/deadcells](https://www.reddit.com/r/deadcells/) — look for weapon tier debates, build synergies, and weapons that feel bad despite good numbers.
## Genre pitfalls
- Tightening the camera without new awareness cues makes off-screen enemies feel unfair — rebuild enemy management around the close camera (example: God of War (2018); [source](https://www.gdcvault.com/play/1026423/Evolving-Combat-in-God-of)).
- A ranged option with no cost pulls players out of the intended exchange — watch playtests and rework the cost before kiting becomes the norm (example: Dead Cells's bows and grenades; [source](https://www.gamedeveloper.com/design/how-watching-people-play-i-dead-cells-i-incorrectly-influenced-its-designers)).
- Weapons that differ only in numbers blur together — give each a conditional effect, an animation weight, and a synergy (example: Dead Cells; [source](https://www.gamedeveloper.com/design/designing-each-of-the-50-weapons-in-i-dead-cells-i-to-feel-distinctive)).
- Hit feedback left for a polish pass is never tuned — treat shake, hit pauses, and knockback as design decisions tested against the plain version ([source](https://www.youtube.com/watch?v=AJdEqssNZ-U)).
