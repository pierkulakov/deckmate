# Unity — where to look, how to measure, and pitfalls — 2026-11-11
## Where to look
- Read `ProjectSettings/ProjectVersion.txt` for the editor version, `Packages/manifest.json` for packages, and `Packages/packages-lock.json` for exact versions.
- Find code in `Assets/**/*.cs` and assembly boundaries in `*.asmdef` (`name`, `references`, `includePlatforms`); code outside an asmdef goes into `Assembly-CSharp`.
- Find entry points in `MonoBehaviour` subclasses (`Awake`, `Start`, `Update`), `[RuntimeInitializeOnLoadMethod]`, and `ScriptableObject` data; find build scenes in `ProjectSettings/EditorBuildSettings.asset`.
- To find script users, search `*.unity`, `*.prefab`, and `*.asset` for the guid from its `.cs.meta` (`m_Script: {fileID: …, guid: …}`).
- Treat code as potentially dead only when it has no code references and its guid appears in no scenes or assets. Also check `Resources.Load`, Addressables, reflection, and string-based names.
- Read settings in `ProjectSettings/*.asset` (Quality, Graphics, Physics, Time, TagManager) and rendering configuration in URP or HDRP pipeline assets.
- Do not read or edit generated directories: `Library/`, `Temp/`, `Logs/`, `obj/`, `UserSettings/`.

## How to measure
- Use Unity Test Framework for EditMode and PlayMode tests. Without the editor UI: `Unity -batchmode -projectPath <folder> -runTests -testPlatform EditMode -testResults <file.xml> -logFile <file.log>`; do not combine `-quit` with `-runTests`.
- Run builds or custom steps with `Unity -batchmode -quit -projectPath <folder> -executeMethod <Class.Method> -logFile <file.log>`; use the exit code and log as evidence.
- Measure CPU and GPU milliseconds and GC Alloc per frame with Unity Profiler and Profile Analyzer, draw calls and SetPass with Frame Debugger, and memory with the Memory Profiler package.
- Measure a Development Build in a benchmark scene, not just the editor: the editor adds its own overhead.
- Report the scene, resolution, quality level, measurement duration, median, and 95th-percentile frame time.
- Read compilation and import errors in `Editor.log` (Windows: `%LOCALAPPDATA%\Unity\Editor\Editor.log`), not the agent output.

## How to verify a card
- Run the Task's acceptance scenario in the relevant scene or build using the editor.
- For automated coverage, run the EditMode or PlayMode tests described above and inspect the results file.
- For performance work, measure a Development Build in the benchmark scene as described above.
- Include the scenario, test or build result, and any failures in the review report.

## Pitfalls
- Every file and folder in `Assets/` has a `.meta` companion. A new asset without one or a move that omits it breaks guid references. Move both together and preserve the guid.
- Scenes and prefabs are YAML with `fileID` references; manual edits are risky. Change them through an Editor script or the editor. Have a person resolve scene merge conflicts (UnityYAMLMerge).
- An open editor overwrites scenes and assets on save and reimports changed files. Do not edit what a person has open; record who holds the scene on the card.
- A second Unity instance cannot open the same project. Run batch tests with the editor closed or on a project copy.
- For readable diffs, require `Asset Serialization: Force Text` and visible `.meta` files; check `ProjectSettings/EditorSettings.asset`.
- Script order (`Script Execution Order`, `[DefaultExecutionOrder]`) affects behavior. Check it before diagnosing a race.
- Code searches miss references assigned in the Inspector. Finding no calls is not proof without searching scenes and prefabs.
