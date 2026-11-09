# Deckmate Desktop

Tauri 2 shell for [Deckmate](../README.md), a local project board over Markdown. The shell starts the Deckmate server on a saved local port and shows the board in a window; project files stay the source of truth. It replaces the Electron shell shipped through 0.5.0.

## Requirements

- To use the app: Windows 10 or 11 (x64). The interface renders through the system [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/), which is part of Windows 11; Windows 10 may need it installed separately. The installer sets it up when missing (which needs internet access), while the portable zip requires the Runtime to be present already. The app ships its own Node.js 26 runtime for the local server, so users need no terminal.
- To build: Rust stable with the MSVC toolchain, Node.js 26 with npm, and the repository's own build (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Development loop

| Work on | Run | Needs Rust |
|---|---|---|
| Board UI | `npm run dev` in the repository root, browser at `http://127.0.0.1:4318/` | no |
| Start screen | open `desktop/launcher/index.html` in a browser (mock bridge) | no |
| Shell from a checkout | `npm run build` in the root, then `npm run dev` in `desktop/` | yes |
| Shell logic | `cargo fmt --check --manifest-path desktop/src-tauri/Cargo.toml`; `cargo clippy --locked --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`; `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml` | yes |
| Shell self-test | `desktop/src-tauri/target/debug/Deckmate.exe --self-test <folder>` | yes |
| Shell smoke | `npm run desktop:smoke` in the repository root | yes |
| Updater end-to-end | `npm run desktop:updater-e2e` in the repository root | yes |
| Start-screen screenshots | `npm run capture:launcher` in the repository root | no |
| Release build | `node desktop/scripts/prepare-sidecar.mjs`, then `npm ci` and `npm run dist` in `desktop/` | yes |

Rust holds only what needs the OS: window, menu, dialogs, the server process, settings. Product logic stays in TypeScript. Pure Rust logic (settings normalization, path checks, the recent list, the ready line) has unit tests; `npm test` does not build Rust. A cold Rust build takes minutes; agents working in several worktrees can share one `CARGO_TARGET_DIR`, which Cargo locks.

`Deckmate.exe --self-test <folder>` starts the server on the given folder, checks that it answers HTTP and stops through stdin, prints one JSON line (`ok`, `url`, `startMs`, `stopMs`, `error`) and exits 0 or 1, without opening a window. A release build attaches to the parent console so the line is visible there; a debug build uses `node` from `PATH` and the repository's `dist/`, so it needs `npm run build` first.

`npm run desktop:smoke` drives the real debug window over CDP through the page bridges — the same path a person takes, without a person looking at the window: the launcher bridge and `getState()`, the window staying hidden until the first load, opening a project, the board bridge and its refusals, the navigation guard, returning to the start screen, creating a project, the Job Object reaping the server when the shell dies, and the saved `desktop.json`. It builds nothing itself (it wants the cargo debug build and `npm run build`) and keeps all state in a temporary settings folder.

The smoke also checks dirty-state refusals through the board bridge and native Quit menu, stable board origin/localStorage after restart, settings-save failures in commands and the launcher, renderer-crash recovery, and CDP keyboard input (printing/reloading disabled; editing shortcuts available).

`npm run capture:launcher` renders start-screen frames into `.deckmate/launcher-shots/` with the same mock bridge.

### Updater end-to-end check

On Windows with WebView2, build with `cargo build --manifest-path desktop/src-tauri/Cargo.toml`, close other Deckmate instances, then run `npm run desktop:updater-e2e` from the root. It uses the existing `desktop/node_modules/@tauri-apps/cli` and Cargo's bundled launcher; no board build or installation is needed.

The check copies the debug shell to a temporary folder, generates disposable keys, signs inert bytes with `--app-version`, generates `latest.json` through `scripts/updater-manifest.mjs`, and serves it over loopback HTTP. PID-scoped Win32/UI Automation drives the real Help menu and dialogs; CDP checks responsiveness. An adjacent empty `uninstall.exe` selects the installed path; its absence exercises portable detection.

Output has an `ok` line for **a** 9.9.9 + verified dry run, **b** current version, **c** damaged signature, **d** foreign key, **e** persisted Skip respected by the startup scheduler and manual checks, **f** Russian `notes_ru`, **g** portable notification/download-page link without downloading a package, plus **signed-version** mismatch rejection. Failures print logs/requests and exit nonzero.

Debug-only `DECKMATE_DESKTOP_UPDATER_ENDPOINT` enables/redirects checks; `DECKMATE_DESKTOP_UPDATER_PUBKEY` overrides the key. `DECKMATE_DESKTOP_UPDATER_DRY_RUN=1` exercises save/stop/pending handling, logs `updater dry run verified <version> <bytes>` instead of launching an installer, then clears pending state and restores the project. Release never reads these overrides. Settings, WebView2 profile and external-link log are isolated; `finally` terminates child trees by PID and deletes keys/fixtures. The real `%APPDATA%\Deckmate` is not used.

## How it works

### Modules

| Module in `src-tauri/src/` | What it does |
|---|---|
| `lib.rs` | Entry point: the `--self-test` mode, plugins, command registration, app lifecycle. |
| `app.rs` | Shell state and project lifecycle: open, create, stop, superseding launches, status events, startup auto-open, quit. |
| `server.rs` | The server process: environment filtering, the free port, the ready line, stdin shutdown, timeouts, project creation through the CLI. |
| `paths.rs` | Program resolution (debug/release), the settings folder, Windows path classification (network, device), case-insensitive path comparison. |
| `bridge.rs` | The launcher and board Tauri commands and their authorization. |
| `workspace.rs` | Workspace source trust, page snapshots and shared save/menu refresh. |
| `webview.rs` | WebView2 handlers: navigation, popups, permissions, zoom keys, the console log; the board-bridge script. |
| `window.rs` | The main window: creation, hidden-until-loaded, bounds save and restore, zoom, navigation. |
| `settings.rs` | `desktop.json`: normalization, atomic writes, recent and workspace lists, bounds and zoom validation, the system locale. |
| `menu.rs` | The native menu and its events. |
| `updater.rs` | Scheduled and manual update checks, signature verification, installation and portable notifications. |
| `whats_new.rs` | The bundled What's new window and localized changelog. |
| `log.rs` | `server.log` with rotation and token masking. |
| `unsaved.rs` | Shared unsaved-work confirmation before project navigation, quit and update installation. |
| `fatal.rs` | Panic/startup logging and native fatal-error messages, including missing WebView2 Runtime. |
| `job.rs` | The Windows Job Object wrapper. |
| `texts.rs` | Shell texts, English and Russian side by side. |
| `self_test.rs` | The `--self-test` run. |

### Server process

- **Program.** A release build runs the bundled `node.exe` (next to `Deckmate.exe`) on `deckmate/dist/server/main.js`; the CLI is `deckmate/bin/deckmate.mjs`, also next to the executable. A debug build runs `DECKMATE_DESKTOP_NODE` (default `node` from `PATH`) on `DECKMATE_DESKTOP_SERVER` (default `<repo>/dist/server/main.js`, resolved from `CARGO_MANIFEST_DIR`); the CLI is `<repo>/bin/deckmate.mjs`. No packing is needed to run the shell from a checkout.
- **Environment.** The inherited environment without any `DECKMATE_*`, `FREETION_*`, `NODE_*` or `OPENSSL_*` variable (case-insensitive — `NODE_OPTIONS` or `OPENSSL_CONF` from a parent shell must not load code into the bundled Node), plus `DECKMATE_DATA=<folder>`, `DECKMATE_PORT=<chosen port>`, `DECKMATE_HOST=127.0.0.1`, `DECKMATE_INDEX=<settings dir>\index` and `DECKMATE_SHUTDOWN_STDIN=1`. The working directory is the settings folder, not the project folder: Windows refuses a working directory longer than 260 characters, and the server reads its folder from `DECKMATE_DATA`. The process starts with `CREATE_NO_WINDOW`.
- **Port.** The shell probes the saved `serverPort` first, keeping the board origin and its localStorage across project switches and restarts. If the port is occupied (or no port is saved), it binds `127.0.0.1:0`, reads the free port, releases it and saves the new port. Other probe errors are reported. Self-test always uses a free port. A fallback changes the origin; data stored under the occupied origin remains there.
- **Ready.** The first stdout match of `Deckmate: http://127.0.0.1:<port>` for exactly the port the shell chose — a further digit invalidates the match, so port 4318 never matches 43180 — within 20 s; the match survives chunk boundaries and a trailing path or query. An exit before that is `start-failed`, no match in time is `timeout`; both carry the last 12 stderr lines.
- **Shutdown.** The shell writes `{"type":"shutdown"}\n` to the server's stdin and waits up to 3 s, then kills it; a server that never became ready is killed outright. The server, started with `DECKMATE_SHUTDOWN_STDIN=1`, also shuts down at the end of stdin, so it never outlives the shell. The stdin handle is taken out of the tokio `Child` and held by the run loop: `Child::wait()` would close stdin while waiting, and the server would read that as the shell going away.
- **Job Object.** The server and the project-init CLI run inside a Windows Job Object with kill-on-close, so they die with the shell even on a hard kill.
- **Log.** `<settings dir>\server.log`: shell events (`start <folder> on port <p>`, `stop <folder>`, unexpected exit with code), every server output line prefixed `[stdout] ` or `[stderr] `, and renderer warnings and errors as `[renderer …]`. Above 5 MB it rotates to `server.log.1`, keeping one previous file; `token=` secrets are masked. Panics include a backtrace and show a native error before exit; startup errors use the same path, with a Microsoft download link when WebView2 Runtime is missing.
- **Creating a project.** `node <cli> init <folder>`, run from the nearest existing parent directory. Exit code 0 is success; otherwise the result is `create-failed` with the stderr tail. The folder then opens as a trusted path.

### Settings and logs

Everything lives in `%APPDATA%\Deckmate\` — the same folder Electron used as `userData`, not Tauri's `app_config_dir()` (which would be `%APPDATA%\com.deckmate.desktop`), so an upgrade keeps recent projects, language, zoom, window bounds and the index:

- `desktop.json` — settings: `lastProject`, `recent` (at most 10 entries `{ path, name, lastOpened }`), `workspace` (an ordered list of at most 30 `{ path, name }` entries), `language` (`en` or `ru`; a missing, invalid or `null` value falls back to the system locale at load), `zoomFactor` (0.5–2, step 0.1), `windowBounds`, `windowMaximized` and `updates` (automatic checks, last check, skipped version and pending update). Workspace entries are added only by an explicit action, never by opening a project; paths must be absolute, duplicates compare case-insensitively with normalized Windows separators, and blank names fall back to the folder name (the path for a drive root). Adding an existing entry keeps its position; a full workspace refuses another entry with `invalid-path`; moves clamp the index to the list. Unknown settings fields, including unknown workspace-entry fields, are kept on write. Writes go to a temp file in the same folder that is renamed over the original. A file over 1 MiB is left untouched and defaults are used.
- `serverPort` in `desktop.json` — a nonzero TCP port, reused when available to preserve the board's localStorage origin.
- `server.log`, `server.log.1` — shell events and the server's output, including one rotated log.
- `index\` — the disposable search index; the server rebuilds it from the files.
- `update-cache\` — a downloaded, signed update awaiting installation; it is verified again when restored.

### Updates and What's new

Release builds check for updates on startup and periodically while running; automatic checks are enabled by default and can be disabled in **Help**. A manual check is also available there. Installed builds download the update and verify its updater signature and version before offering **Restart and update**, **Skip this version** or **Later**. A dirty editor is checked before installation. The updater signature does not replace Windows code signing.

Portable builds do not download or install an update: they notify the user and offer to open the release download page. After a successful in-app update, the bundled **What's new** window shows changes since the previous version; **Help → What's new** opens it on demand. The window reads the bundled English or Russian changelog, falling back to English if the Russian file is absent.

### Bridges

Two page-side contracts reach the shell. [launcher/tauri-bridge.js](launcher/tauri-bridge.js) defines `window.deckmateDesktop` over Tauri IPC when the start screen runs in the shell; in a plain browser it does nothing and the start screen keeps its mock bridge. `onStatus` returns an unsubscribe function, and `getState()` replays a pending error status after the page can receive it. The board uses [client/desktop-bridge.ts](../client/desktop-bridge.ts); when a project opens, the shell registers an initialization script that defines `window.deckmateBoard` only in the top frame of the current server origin — replaced on every project switch and removed on the start screen.

| Page bridge | Tauri command or event |
|---|---|
| `deckmateDesktop.getState()` | `desktop_get_state` |
| `deckmateDesktop.chooseFolder()` | `desktop_choose_folder` |
| `deckmateDesktop.openProject(folder)` | `desktop_open_project` |
| `deckmateDesktop.createProject(options)` | `desktop_create_project` |
| `deckmateDesktop.removeRecent(folder)` | `desktop_remove_recent` |
| `deckmateDesktop.addToWorkspace(folder)` | `desktop_add_to_workspace` |
| `deckmateDesktop.removeFromWorkspace(folder)` | `desktop_remove_from_workspace` |
| `deckmateDesktop.moveInWorkspace(folder, index)` | `desktop_move_in_workspace` |
| `deckmateDesktop.setLanguage(lang)` | `desktop_set_language` |
| `deckmateDesktop.onStatus(callback)` | event `desktop://status` |
| `deckmateBoard.recentProjects()` | `board_recent_projects` |
| `deckmateBoard.workspaceProjects()` | `board_workspace_projects` |
| `deckmateBoard.addToWorkspace(source)` | `board_add_to_workspace` |
| `deckmateBoard.removeFromWorkspace(path)` | `board_remove_from_workspace` |
| `deckmateBoard.moveInWorkspace(path, index)` | `board_move_in_workspace` |
| `deckmateBoard.switchProject(path)` | `board_switch_project` |
| `deckmateBoard.showStartScreen()` | `board_show_start_screen` |
| `deckmateBoard.setDirty(dirty)` | `board_set_dirty` |

Actions return `{ ok: true }` or `{ ok: false, code, message }`, with the codes `invalid-path`, `missing`, `not-empty`, `create-failed`, `start-failed`, `timeout`, `load-failed`, `superseded`, `closed`, plus `forbidden` (a command called from the wrong page), `not-recent`, `not-in-workspace`, `cancelled` and `invalid-language`. `getState()` returns `workspace`, `recent`, `lastProject`, `version`, `deckmateVersion`, `locale` and `language`. Its workspace entries are `{ path, name, missing }`; `workspaceProjects()` returns `{ path, name, current, missing }` entries. `missing` is a cheap directory existence check, not a project scan, and neither flag is saved. Workspace mutations return `{ ok: true, workspace }` on the launcher or `{ ok: true, projects }` on the board, with the corresponding snapshot shape.

The launcher may add only the last dialog-selected folder or an entry of `recent`. On the board, `addToWorkspace` accepts `{ kind: 'dialog' }` (native folder picker; cancellation returns `cancelled`), `{ kind: 'current' }` (the open project), or `{ kind: 'recent', path }` (must be in `recent`, otherwise `not-recent`). Neither bridge trusts arbitrary caller-provided folders. Removing or moving an absent entry returns `not-in-workspace`. Every successful mutation saves settings and rebuilds the native menu.

Settings-changing commands also return `save-failed` when settings cannot be persisted, including an oversized settings file. The launcher displays these errors in its status line.

The board reports the combined dirty state of every editor that registers `beforeunload`. Before quit, switching/closing projects or installing updates, the shell asks **Leave / Stay** when dirty. Stay keeps the window and its server running. An approved transition suppresses the second browser unload prompt before stopping the server; browser-only use retains its existing guards.

### Capabilities and Rust-side checks

[capabilities/](src-tauri/capabilities/) splits what each page may call: `launcher` is local-only (the bundled app origin) with the nine desktop commands and the status event; `board` is remote `http://127.0.0.1:*` with exactly the eight board commands above. The local `whats-new` window can read its changelog through `whats_new_get`. No other plugin permissions reach a remote page. Command permissions are generated by `build.rs`.

Rust checks again on every command (`bridge.rs`): launcher commands answer only the main window showing the bundled launcher URL; board commands answer only the main window at the current server origin, and `board_switch_project` accepts only a folder already in `workspace` or `recent`, opening the stored path (the Windows path comparison ignores case and separator). Board authorization is checked again after the native folder picker returns. A new launch supersedes one in flight, so a slow open cannot land on a stale window.

### Navigation and new windows

The main window may navigate only to the bundled launcher (`http://tauri.localhost/index.html`) and the current server origin; iframes only to the current server origin. Any other `http(s)` target opens in the system browser and is canceled in the app; every other scheme is canceled outright. Page-initiated new-window requests do not create app windows: an `http(s)` target goes to the system browser, anything else is dropped. The shell itself may open the separate What's new window. Navigating back to the launcher URL while a project is open is intercepted and routed through the shell, which stops the server before the start screen appears.

### Network folders

UNC and device paths (`\\server\share`, `\\?\C:\`, `\\.\`), mapped network drives and paths that reach the network through a junction are accepted only when the folder came from the shell's folder dialog: the dialog result is remembered for that one folder, and typing such a path into the start screen is refused with `invalid-path`. Clicking a network folder in the recent list or workspace is allowed: workspace entries entered through the dialog, current project or recent list are trusted. The startup auto-open never opens a network `lastProject` by itself.

### Window

The main window is 1280×820 by default and at least 960×600. Saved bounds are restored when at least 120×60 of the window overlaps some monitor's work area; bounds are saved 300 ms after a move or resize and on close; the maximized state is kept. The window is created hidden and shown once the bounds are restored and the first page load has finished; a 5-second fallback shows it with an error, so a broken start screen never leaves an invisible process. A second launch unminimizes, shows and focuses the running window. The title is `Deckmate` on the start screen and `Deckmate — <folder name>` on the board.

### Zoom

WebView2 browser accelerator keys (F5, Ctrl+P, Alt+Left, Ctrl+Shift+I) are disabled. Application menu accelerators and text-editing shortcuts remain available. The browser context menu retains only Cut, Copy, Paste, Select all and spellcheck entries. Renderer crashes are logged and reload the current page; an unresponsive renderer asks **Reload / Wait**; a browser-process exit stops the server and restarts Deckmate.

0.5–2 with step 0.1: Ctrl+=, Ctrl+− and Ctrl+0 (numpad keys included) and the View menu; WebView2's built-in zoom hotkeys are off, the shell handles the keys itself. The factor is clamped, stored in `zoomFactor` and applied after every page load; a WebView2 zoom change (Ctrl+wheel) is captured and persisted too.

### Menu and texts

The native menu has File (open folder, recent projects, Workspace, add current project to workspace, reveal project folder, switch and close project, reload, DevTools (enabled in debug builds and disabled in release builds), quit), Edit, View (zoom, full screen) and Help (updates, What's new, open logs folder and About — which lists the Deckmate, desktop shell, Tauri and bundled Node versions). Switch project opens the start screen with **Ctrl+Shift+P**. Add current project to workspace is enabled only when a project is open and not already listed. The Workspace submenu follows the saved order, assigns **Ctrl+1…Ctrl+9** to its first nine entries, and disables missing folders. Recent and workspace entries carry the folder path inside their menu id, so a reordered list cannot misroute a queued click. Shell texts are English and Russian side by side under the same keys in `texts.rs` — the Rust counterpart of `defineText(en, ru)`; switching the language rebuilds the menu.

### Bundled Node

Node 26, the major of `engines` in the root `package.json`. [node-runtime.json](node-runtime.json) pins the exact version and the SHA-256 of the official `win-x64/node.exe` (26.13.0 as of 2026-11-09), plus the SHA-256 of the complete `LICENSE` from that Node tag; `build.rs` embeds the version for the About dialog. `prepare-sidecar.mjs` downloads the binary from nodejs.org with an npmmirror fallback and the license from the pinned GitHub tag, verifies both hashes and caches both files in `desktop/.cache/`. It then runs [desktop-notices.mjs](scripts/desktop-notices.mjs), which adds the licenses of the locked Windows Rust dependency graph and the Microsoft.Web.WebView2 SDK to `src-tauri/THIRD-PARTY-NOTICES.txt`.

The Node compile cache remains disabled. On 2026-11-09, five debug `Deckmate.exe --self-test` trials on the same initialized project measured median `startMs` of 670 without the cache, 716 with an empty cache, and 968 with a warm cache (Node 26.13.0). Only the compile cache was reset between paired trials; the search index stayed warm.

## Security notes and known limitations

- **Same-origin iframes can reach the board bridge.** Vision renders project content in same-origin iframes on the board, and such an iframe can invoke the eight board commands: WebView2 IPC does not identify the calling frame, so the top-frame check Electron made cannot be repeated on the Rust side. The bridge remains restricted to listing workspace/recent projects, explicit workspace mutations, dirty-state reporting, switching to a listed project and showing the start screen. Every command passes the current-origin check; additions are restricted to the native dialog, current project or recent list. Same-origin content can change workspace membership/order, dirty state or trigger navigation, but cannot add or open an arbitrary caller-provided path.
- **DevTools are off in release builds.** The tauri crate is built without the `devtools` feature. The menu item remains visible but is disabled in release builds; its handler is compiled only with debug assertions.
- **Debug-only hooks.** `DECKMATE_DESKTOP_NODE`, `DECKMATE_DESKTOP_SERVER`, `DECKMATE_DESKTOP_CDP_PORT` (the smoke's CDP port), `DECKMATE_DESKTOP_SETTINGS_DIR` (the smoke's throwaway settings folder), `DECKMATE_DESKTOP_DIRTY_POLICY=refuse` (cancels dirty navigation/quit without opening a native dialog), and `DECKMATE_DESKTOP_EXTERNAL_LOG` (records external links instead of opening the user's browser) are honored only by debug builds; release builds never read them.
- **The builds are not code-signed**, so Windows SmartScreen may warn on first run.

## Release and upgrading from Electron

[release.yml](../.github/workflows/release.yml) has three ordered jobs. `preflight` checks repository visibility and npm access before building, validates the tag against both package versions, Tauri/Cargo manifests and the `deckmate-desktop` lock entry, validates both dated changelogs and runs the normal checks. `desktop` builds on Windows with the pinned Rust toolchain and without restoring cross-workflow Cargo caches: `prepare-sidecar.mjs` stages and smoke-checks Node and deckmate and generates `THIRD-PARTY-NOTICES.txt`; the Tauri CLI builds and updater-signs the NSIS installer. The job self-tests unpacked and installed builds, installs/uninstalls the installer, verifies notices in the app and zip, and generates `latest.json` once with canonical base64 signatures, English/Russian notes and the tag commit's deterministic `pub_date`. The installer, `.sig`, zip and manifest travel together as workflow artifacts.

`release` verifies the downloaded installer's signature again against the configured public key and checks the unchanged manifest. It creates or resumes a **draft** using a numeric REST release ID, then publishes npm and GHCR. It uploads the npm tarball, installer and zip, verifies API names, uploaded state, sizes, SHA-256 digests when present and downloaded bytes, and checks the manifest URL against the actual installer name and `browser_download_url`. `latest.json` is uploaded last. Only then is the draft published with explicit `make_latest`, followed by byte-for-byte anonymous checks of the tag manifest and, for stable versions, `https://github.com/pierkulakov/deckmate/releases/latest/download/latest.json`. A retry reuses identical draft assets and replaces incomplete or different ones; already published releases are refused rather than modified. See the [release runbook](../docs/github-settings.md) for recovery and the mandatory offline signing-key/password backup.

Actions → Release → Run workflow with `dry_run=true` (default) runs preflight and the signed desktop build, exercises uploads/checks in a temporary `v<version>-dryrun.<run_id>` draft, then deletes it. It creates no tag and publishes no npm package, container or release. Manual dispatch with `dry_run=false` is rejected; real releases require a version-tag push.

The installer is named `Deckmate.Setup.<version>.exe` before upload, matching GitHub's canonical download name; the portable remains `Deckmate-<version>-win-x64.zip`. Both forms put `THIRD-PARTY-NOTICES.txt` beside `Deckmate.exe`; the zip also contains `node.exe` and the `deckmate/` folder. The portable build does not bootstrap prerequisites: the WebView2 Runtime must already be installed (Windows 11 includes it; Windows 10 may need [Microsoft's Evergreen Bootstrapper or Standalone Installer](https://developer.microsoft.com/microsoft-edge/webview2/)). The NSIS installer installs that Runtime when missing, which requires internet access.

The NSIS installer removes an install made by the old Electron installer (per-user and per-machine) before registering itself, and never touches `%APPDATA%\Deckmate`; see [src-tauri/windows/README.md](src-tauri/windows/README.md).

Sizes measured 2026-11-09: installer 32 MB (the Electron installer was 121 MB); installed 131 MB (Electron: 380 MB), of which `node.exe` is 95.5 MB.

Versions 0.5.0 and earlier shipped an Electron shell; recent projects, language, zoom and window position carry over through the shared settings folder.

## Manual checks before a release

`npm run desktop:smoke` covers the pages and the server: launcher, board, both bridges, the navigation guard, the server lifetime. What it cannot drive stays manual:

- Native menu items in both languages: open, recent, workspace ordering and missing-folder disabling, add current project, reveal project folder, switch and close project, zoom, full screen, open logs folder, About; Ctrl+Shift+P and Ctrl+1…9.
- The folder dialog — opening and creating a project through it.
- A second launch focuses the running window.
- Zoom keys and menu items, and the factor surviving a restart.
- Native Leave/Stay and Reload/Wait choices, browser-process restart, panic/startup error boxes and startup without WebView2 Runtime; CDP cannot answer these dialogs. Context-menu spelling entries and physical menu accelerators also require a manual check.
- The installer over an Electron 0.5.0 install: one Deckmate entry in Apps, one shortcut, settings kept ([src-tauri/windows/README.md](src-tauri/windows/README.md)).
