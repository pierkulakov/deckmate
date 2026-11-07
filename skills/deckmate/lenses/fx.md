---
area: fx
title: Combat effects
---
## Requirements
- Give every shot, hit, smoke, fire, marker, and explosion a gameplay cause, start, and end.
- Match brightness, size, and duration to danger; decoration must not overpower a threat.
- Match visible boundaries to damage, blocking, or capture areas; visuals must not promise a different outcome.
- Use tracers to show shot direction and timing, and hit effects to show resolved gameplay outcomes.
- Distinguish friendly and enemy effects by shape and motion, not just color; keep the signal visible at low settings.
- Set CPU, GPU, overdraw, particle, light, and decal budgets for peak combat; reduce decoration first.
## Area questions
- How many shooters, hits, explosions, smoke clouds, and markers coexist in typical and peak combat?
- What must the player recognize, and how quickly: the threat, owner, direction, boundary, or end of an effect?
- When does the simulation apply damage and change the area relative to the effect's anticipation, impact, and fade?
- Which signals distinguish friend from foe without relying on color vision?
- Against which backgrounds, under which lighting, and from which gameplay cameras could the effect disappear or obscure the target?
- What are the target frame time and platform, and which elements can be reduced without losing the gameplay rule?
## References
- League of Legends — evaluate effects by gameplay, value, color, shape, and timing, not the beauty of a single frame ([Riot guide](https://www.deck.gallery/league-of-legends-2017/slide/1-visual-effects-guide-the/)).
- League of Legends — study the hierarchy of ultimates and crowd control, hitbox accuracy, and noise reduction in large fights ([Riot](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/)).
- VALORANT — study clear smoke boundaries from different angles and silhouette preservation at lower quality settings ([Riot](https://technology.riotgames.com/news/valorant-shaders-and-gameplay-clarity)).
- Destiny 2 — verify danger, timers, and area boundaries in the actual scene and lighting; drop secondary particles first under load ([analysis](https://80.lv/articles/destiny-2-vfx-production-tips)).
- Overwatch — study how exaggerated explosions and flashes avoid washing out the action ([analysis](https://80.lv/articles/overwatch-technical-overview)).
## Warning signs
- An effect obscures a unit, reticle, or more dangerous threat despite its secondary gameplay role.
- A ring, smoke cloud, or flame looks wider or narrower than the actual area; hits appear before the simulation resolves them.
- Every event is equally bright and long, turning large fights into a continuous flash.
- Friendly and enemy effects differ only in hue, and danger signals disappear at low settings.
- Measurements use one effect against an empty background instead of peak combat on the target platform.
## How to verify
- Measure CPU and GPU separately, overdraw, and frame-time shares in peak combat; repeat at every quality level ([Niagara method](https://dev.epicgames.com/documentation/unreal-engine/measuring-performance-in-niagara)).
- Show gameplay-camera footage without debug overlays against light and dark backgrounds; have a person identify the threat, side, and area boundary.
- Compare footage frame by frame with the gameplay log: starts, damage, area endings, and hits must match the visuals.
