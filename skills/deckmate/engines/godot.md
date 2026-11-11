# Godot — where to look, how to measure, and pitfalls — 2026-11-11
## Where to look
- Read `project.godot` for settings, the main scene (`run/main_scene`), and autoload singletons and entry points.
- Read `.tscn` scenes and `.tres` resources as text: scripts attach through `[ext_resource type="Script" path="res://…"]`; search `*.tscn` for a script path to find its users.
- Find scripts in `*.gd` or C# `*.cs`; find signals in `connect(...)` calls and `[connection ...]` entries in `.tscn`.
- Treat a script as potentially dead only when its path appears in no scenes, `load`/`preload` calls, or autoload entries.
- Do not edit `.godot/` (Godot 4): it is an import cache. Move adjacent `*.import` and `*.uid` files with their source files.

## How to measure
- Use the editor debugger: Profiler for script and physics time per frame, Monitors for FPS, draw calls, and memory.
- Run headless with `godot --headless --path <folder> -s <runner-script>`; run GUT or GdUnit4 tests through their command-line runners.
- Measure an exported build in a benchmark scene. Report the scene, resolution, duration, median, and 95th-percentile frame time.

## How to verify a card
- Run the relevant scene in the editor and exercise the Task's acceptance scenario.
- For automated coverage, use the headless runner described above and record its result.
- For performance work, run the benchmark in an exported build and report the measurements above.
- Include the scene or runner, observed result, and any failures in the review report.

## Pitfalls
- Moving files outside the editor breaks `res://` paths in scenes. Rename them in the editor or find and update every reference.
- An open editor overwrites `.tscn` files on save. Do not edit a scene that a person has open.
