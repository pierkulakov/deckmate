---
area: map-editor
title: Map editor
---
## Requirements
- Keep the edit-to-combat loop within seconds, without manual copying, restarts, or full rebuilds.
- Use one loader, data schema, and gameplay implementation for editor and combat; do not maintain a separate combat scene copy.
- Let designers open a small playable slice with routes, spawns, cover, and objectives without finished art.
- Cover geometry, terrain, properties, deletion, and bulk operations with undo and redo; treat one brush stroke as one action.
- Store maps as verifiable typed data with stable ids and references; do not flatten gameplay objects into the editor scene.
- Validate assets, navigation, spawn points, and objectives before combat; identify the object and location in each error.
## Area questions
- Who edits maps, how often, what is the time limit in seconds before combat, and what is the maximum map size?
- What minimal slice proves the mechanic, and which layers does the designer need before final art?
- Which data belongs to combat, and which is auxiliary editor metadata?
- Which coordinates, stable ids, external assets, custom properties, and migrations are required?
- Which operations must be atomic for undo: a brush stroke, group paste, tile edit, or object deletion?
- How do building, launching, collaborative review, and publishing work, and where do errors surface at each stage?
## References
- Hammer (CS2) — measure the full path from tutorial map and prefab through compilation to gameplay testing, not just save time ([Valve](https://www.counter-strike.net/workshop/workshopfaq)).
- World Builder / Essence Editor (CoH3) — study the Build Mod → Custom Game loop and the separation of map, scenario, and tuning pack ([CoH3 practice](https://coh3stats.com/news/4588629064114889345)).
- Unity Terrain Tools — study brush masks, erosion, batch tile editing, and heightmap import without manual rework ([Unity](https://docs.unity3d.com/Packages/com.unity.terrain-tools@5.3/manual/index.html)).
- Frostbite in Battlefield 2042 — study linked, nondestructive terrain layers and data that lets entities modify terrain ([EA, GDC 2023](https://www.ea.com/news/frostbite-presents-at-gdc-2023)).
- Tiled — study documented JSON, layers, stable ids, properties, templates, and external tilesets as game data ([format](https://github.com/mapeditor/tiled/blob/master/docs/reference/json-map-format.rst)).
## Warning signs
- Only the editor scene is saved, while combat data is assembled manually or through a second, incompatible loader.
- Moving one piece of cover requires minutes of building, file copying, and client restarts.
- Undo reverses movement but not terrain, properties, group paste, or deletion; undo affects unrelated objects.
- Copying breaks ids and references, while hidden properties cannot be found, validated, or compared in a diff.
- Verifying a rule requires a complete map, final art, and a programmer.
## How to verify
- Measure ten move-cover-to-combat cycles; show the median and worst result in seconds with a screen recording.
- Undo and redo every operation; its diff must affect only its own data, and the map must match after a restart.
- Have a designer open a small slice without a programmer, break a spawn point, see a precise error, and fix it in the editor.
