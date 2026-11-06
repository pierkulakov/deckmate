---
area: units
title: Units and soldiers
---
## Requirements
- Make walking, running, turning, starting, and stopping convey actual speed and direction; prevent foot sliding.
- Make stances and transitions distinguishable from the gameplay camera and consistent with cover, collision, and accuracy states.
- Support weapons in the hands with correct barrel alignment and reloads; preserve grip and pose when changing weapons.
- Show gameplay states through wounds and death; reactions and physical bodies must not falsely suggest life.
- Connect boarding and exiting to the soldier, seat, and vehicle hatch; interruption must neither duplicate the soldier nor lose the command.
- Set crowd LODs and animation, simulation, CPU, and GPU budgets; keep identity, side, and state readable at distance.
## Area questions
- How many soldier types and simultaneous bodies are visible from each camera, and how many need full animation?
- Which speeds, accelerations, surfaces, slopes, body sizes, and obstacles must locomotion account for?
- Which stances and transitions change hitboxes, cover, accuracy, speed, or available orders?
- Which weapon classes, grips, barrels, magazines, and upper-body actions can be combined?
- Which wounds are visible, when does death occur, and how are boarding, exiting, and blast reactions interrupted?
- What are the target frame time and platform, and which LOD steps preserve gameplay signals?
## References
- Overwatch — study stance, extreme poses, held key poses, and movement character, not just the walk cycle ([GDC analysis](https://babel.speldesign.uu.se/2016/04/03/gdc-overwatch-animation-talk-summary/)).
- The Last of Us Part II — study next-pose selection based on movement and intent, transition quality, and responsiveness ([GDC](https://media.gdcvault.com/GDC+2021/Motion_Matching_In_TLOU2.pdf)).
- Total War: Warhammer II — study simulation/presentation separation, LODs, and multithreading at peak unit counts ([analysis](https://www.gamedeveloper.com/design/designing-i-total-war-warhammer-ii-i-to-handle-tons-of-units-and-massive-battles)).
- VALORANT — study silhouettes, recognition of side and distance, and preservation of these signals at lower quality settings ([Riot](https://technology.riotgames.com/news/valorant-shaders-and-gameplay-clarity)).
## Warning signs
- Feet slide, turning happens without body rotation, or visible speed contradicts displacement.
- A soldier appears prone or in cover while the hitbox, accuracy, and available orders remain unchanged.
- A weapon floats, the second hand does not support it, the barrel points away from the shot direction, or switching weapons teleports the pose.
- Wounds look like death or vice versa; boarding teleports the soldier, and interruption leaves them in two places.
- Distant LODs lose side, stance, or wound signals; the crowd looks smooth on video but exceeds the frame budget.
## How to verify
- Run a stance × weapon × wound × vehicle matrix with interruptions; record every transition from the gameplay camera.
- Overlay speed, hitboxes, and seat occupancy on animation footage; treat any disagreement with gameplay rules as a defect.
- Measure CPU, GPU, animation updates, and memory for the peak crowd at each LOD, not for a single soldier.
- Show close, gameplay, and distant views to a person; they must distinguish side, state, weapon, and movement direction.
