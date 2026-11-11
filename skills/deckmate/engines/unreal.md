# Unreal — where to look, how to measure, and pitfalls — 2026-11-11
## Where to look
- Read `<name>.uproject` for modules and plugins; find C++ in `Source/<module>/`, module dependencies in `<module>.Build.cs`, and custom plugins in `Plugins/*/`.
- Find settings in `Config/Default*.ini`, assets in `Content/**/*.uasset`, and levels in `*.umap`.
- `.uasset` files are binary. Text searches miss Blueprint logic and references; inspect them in the editor's Reference Viewer.
- Find entry points in `GameMode`, `PlayerController`, `UCLASS`, `UFUNCTION(BlueprintCallable)`, and `UPROPERTY` exposed to Blueprints.
- Call C++ dead only when it has no code callers or Blueprint references. Only the editor can verify the latter; otherwise report it as unverified.
- Do not read or edit generated directories: `Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`.

## How to measure
- Use `stat unit`, `stat fps`, and `stat gpu` in the game; capture a frame with `ProfileGPU`.
- Capture traces with Unreal Insights and `-trace=cpu,gpu,frame`; measure a Development build, not the editor.
- Run Automation tests with `UnrealEditor-Cmd <file.uproject> -ExecCmds="Automation RunTests <filter>;Quit" -unattended -nullrhi -log`.

## How to verify a card
- Run the relevant level in the editor and exercise the Task's acceptance scenario.
- For automated coverage, run the matching Automation tests as described above and inspect the log.
- For performance work, capture a Development build trace in the benchmark scene.
- Include the level, test or trace result, and any failures in the review report.

## Pitfalls
- A `.uasset` file cannot be merged. Coordinate parallel edits with locking (Git LFS lock, Perforce checkout).
- After changing C++ headers, rebuild the full editor instead of using Live Coding.
