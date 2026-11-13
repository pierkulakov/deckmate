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
| Startup timings / visible splash | `node desktop/scripts/startup-smoke.ts --expect-splash` in the repository root | yes |
| MCP stdio smoke | `node desktop/scripts/mcp-smoke.mjs` in the repository root | yes |
| Updater end-to-end | `npm run desktop:updater-e2e` in the repository root | yes |
| Start-screen screenshots | `npm run capture:launcher` in the repository root | no |
| Release build | `node desktop/scripts/prepare-sidecar.mjs`, then `npm ci` and `npm run dist` in `desktop/` | yes |

Rust holds only what needs the OS: window, menu, dialogs, the server process, settings. Product logic stays in TypeScript. Pure Rust logic (settings normalization, path checks, the recent list, the ready line) has unit tests; `npm test` does not build Rust. A cold Rust build takes minutes; agents working in several worktrees can share one `CARGO_TARGET_DIR`, which Cargo locks.

`Deckmate.exe --self-test <folder>` starts the server on the given folder, checks that it answers HTTP and stops through stdin, prints one JSON line (`ok`, `url`, `startMs`, `stopMs`, `error`) and exits 0 or 1, without opening a window. A release build attaches to the parent console so the line is visible there; a debug build uses `node` from `PATH` and the repository's `dist/`, so it needs `npm run build` first.

### MCP through the desktop shell

`Deckmate.exe mcp [--data <folder>] [--member <id>] [--check]` exposes the project board to an agent over Model Context Protocol stdio using the bundled Node.js runtime, so a separate Node.js installation is unnecessary. Standard input and output carry the protocol directly; without `--data`, the project is selected through `DECKMATE_DATA` or by searching upward from the caller's working directory. Add `--check` to print the selected project and tool count and exit.

Connect an agent with the executable as the command (replace `<path>` with its actual location):

```sh
claude mcp add --scope local deckmate -- "<path>\Deckmate.exe" mcp
```

For the portable version, the user chooses where to extract the zip and therefore which path to put in this command. Before an in-app installer update, Deckmate counts active desktop MCP sessions and asks whether to continue if any are connected. Close those sessions or explicitly continue: the passive installer forcibly closes Deckmate processes and interrupts their MCP work; it does not wait for sessions to finish. New desktop MCP sessions are refused while the update is being confirmed or installed. A user-scoped named marker gates preparation; detection of the updater's `Deckmate-<version>-installer.exe` process keeps the gate closed after the shell exits, until installation finishes. Portable/manual replacement and MCP started directly through Node are not coordinated by this gate.

`npm run desktop:smoke` drives the real debug window over CDP through the page bridges — the same path a person takes, without a person looking at the window: the launcher bridge and `getState()`, the window staying hidden until the launcher's first load, opening a project, the board bridge and its refusals, the navigation guard, returning to the start screen, creating a project, the Job Object reaping the server when the shell dies, and the saved `desktop.json`. It builds nothing itself (it wants the cargo debug build and `npm run build`) and keeps all state in a temporary settings folder.

When the last project opens automatically (2026-11-12), the smoke requires the startup page to be the first visible frame and the loaded board the next one; the launcher never shows. The startup check above measures the same splash path, the readiness transition and bridge refusals.

The smoke also checks dirty-state refusals through the board bridge and native Quit menu, stable board origin/localStorage after restart, settings-save failures in commands and the launcher, renderer-crash recovery, CDP keyboard input (printing/reloading disabled; editing shortcuts available), notification denial, clipboard paste in the card editor and Vision, and native Ctrl+Shift+P from a CDP-focused board editor.

`npm run capture:launcher` renders start-screen frames into `.deckmate/launcher-shots/` with the same mock bridge.

### Updater end-to-end check

On Windows with WebView2, build with `cargo build --manifest-path desktop/src-tauri/Cargo.toml`, close other Deckmate instances, then run `npm run desktop:updater-e2e` from the root. It uses the existing `desktop/node_modules/@tauri-apps/cli` and Cargo's bundled launcher; no board build or installation is needed.

The check copies the debug shell to a temporary folder, generates disposable keys, signs inert bytes with `--app-version`, generates `latest.json` through `scripts/updater-manifest.mjs`, and serves it over loopback HTTP. PID-scoped Win32/UI Automation drives the real Help menu and dialogs; CDP checks responsiveness. An adjacent empty `uninstall.exe` selects the installed path; its absence exercises portable detection.

Output has an `ok` line for **a** 9.9.9 + verified dry run, **b** current version, **c** damaged signature, **d** foreign key, **e** persisted Skip respected by the startup scheduler and manual checks, **f** Russian `notes_ru`, **g** portable notification/download-page link without downloading a package, plus **signed-version** mismatch rejection. The **oversized-header** and **oversized-stream** cases serve an excessive Content-Length and an endless chunked response without Content-Length respectively: both must disconnect, show the ordinary check-failed dialog, leave no cached package/pending installation, and allow another check. The stream case transfers slightly over the production 512 MiB limit per check without allocating the entire fixture on the server. **oversized-manifest-size** verifies that an excessive artifact `size` prevents the package request altogether. Failures print logs/requests and exit nonzero.

Debug-only `DECKMATE_DESKTOP_UPDATER_ENDPOINT` enables/redirects checks; `DECKMATE_DESKTOP_UPDATER_PUBKEY` overrides the key. `DECKMATE_DESKTOP_UPDATER_DRY_RUN=1` exercises save/stop/pending handling, logs `updater dry run verified <version> <bytes>` instead of launching an installer, then clears pending state and restores the project. Release never reads these overrides. Settings, WebView2 profile and external-link log are isolated; `finally` terminates child trees by PID and deletes keys/fixtures. The real `%APPDATA%\Deckmate` is not used.

## How it works

### Modules

| Module in `src-tauri/src/` | What it does |
|---|---|
| `lib.rs` | Entry point: the `mcp` and `--self-test` modes, plugins, command registration, app lifecycle. |
| `mcp.rs` | The MCP stdio process: argument forwarding, inherited pipes and caller environment. |
| `mcp_sessions.rs` | User-scoped MCP session markers and the update-installation gate. |
| `app.rs` | Shell state and project lifecycle: open, create, stop, superseding launches, status events, startup auto-open, quit. |
| `server.rs` | The server process: environment filtering, the free port, the ready line, stdin shutdown, timeouts, project creation through the CLI. |
| `paths.rs` | Program resolution (debug/release), the settings folder, Windows path classification (network, device), case-insensitive path comparison. |
| `bridge.rs` | The launcher and board Tauri commands and their authorization. |
| `workspace.rs` | Workspace source trust, page snapshots and shared save/menu refresh. |
| `webview.rs` | WebView2 handlers: navigation, popups, permissions, zoom keys, the console log; the board-bridge script. |
| `window.rs` | The main window: creation, first local frame, bounds save and restore, zoom, navigation. |
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
- **Port.** The shell probes the saved `serverPort` first, keeping the board origin and its localStorage across project switches and restarts. If the port is occupied (or no port is saved), it binds `127.0.0.1:0`, reads the free port, releases it and saves the new port. If another process takes that port before startup, project startup retries up to three times with fresh ports only when stderr contains the exact Node error line `Error: listen EADDRINUSE: address already in use 127.0.0.1:<port>` for the chosen port (surrounding whitespace is allowed), saving each through the same settings path; only the final failure is shown. An unrelated early exit remains `start-failed` without changing the port, even if it is occupied by then; diagnostic mentions and adjacent port numbers do not count. Other probe errors are reported. Self-test always uses a free port. A fallback changes the origin; data stored under the occupied origin remains there.
- **Ready.** The first stdout match of `Deckmate: http://127.0.0.1:<port>` for exactly the port the shell chose — a further digit invalidates the match, so port 4318 never matches 43180 — within 20 s; the match survives chunk boundaries and a trailing path or query. An exit before that is `start-failed`, no match in time is `timeout`; both carry the last 12 stderr lines.
- **Shutdown.** The shell writes `{"type":"shutdown"}\n` to the server's stdin and waits up to 3 s, then kills it; a server that never became ready is killed outright. The server, started with `DECKMATE_SHUTDOWN_STDIN=1`, also shuts down at the end of stdin, so it never outlives the shell. The stdin handle is taken out of the tokio `Child` and held by the run loop: `Child::wait()` would close stdin while waiting, and the server would read that as the shell going away.
- **Job Object.** MCP, the server and the project-init CLI share a launch helper: create suspended, assign to a Windows Job Object with kill-on-close, then resume the initial thread. No child code runs before Job assignment. Closing the Job kills the child tree, including on a hard shell kill after assignment.
- **Log.** `<settings dir>\server.log`: shell events (`start <folder> on port <p>`, `stop <folder>`, unexpected exit with code), every server output line prefixed `[stdout] ` or `[stderr] `, and renderer warnings and errors as `[renderer …]`. Above 5 MB it rotates to `server.log.1`, keeping one previous file; `token=` secrets are masked. Panics include a backtrace and show a native error before exit; startup errors use the same path, with a Microsoft download link when WebView2 Runtime is missing.
- **Creating a project.** `node <cli> init <folder>`, run from the CLI's own short directory. Exit code 0 is success; otherwise the result is `create-failed` with the stderr tail. Initialization is limited to 60 s (a timeout is also `create-failed` with a localized explanation). Quit or a superseding launch cancels initialization with `closed` or `superseded`; the CLI is killed and reaped, and its Job is closed, before releasing the lifecycle lock. Failure, timeout and cancellation include a localized warning that the target folder may have been created partially and has not been deleted, with its full path. The warning dialog offers **Open folder in Explorer** (the nearest existing parent if the target does not exist); it is shown only after releasing the lifecycle lock and is suppressed during shutdown, so quit never waits for acknowledgement. Failed initialization does not add the folder to `recent` or `lastProject`, and revokes its folder-dialog trust; partial user contents are never removed. A successful folder then opens as a trusted path.

### Settings and logs

Everything lives in `%APPDATA%\Deckmate\` — the same folder Electron used as `userData`, not Tauri's `app_config_dir()` (which would be `%APPDATA%\com.deckmate.desktop`), so an upgrade keeps recent projects, language, zoom, window bounds and the index:

- `desktop.json` — settings: `lastProject`, `recent` (at most 10 entries `{ path, name, lastOpened }`), `workspace` (an ordered list of at most 30 `{ path, name }` entries), `language` (`en` or `ru`; a missing, invalid or `null` value falls back to the system locale at load), `zoomFactor` (0.5–2, step 0.1), `windowBounds`, `windowMaximized` and `updates` (automatic checks, last check, skipped version and pending update). Workspace entries are added only by an explicit action, never by opening a project; paths must be absolute, duplicates compare case-insensitively with normalized Windows separators, and blank names fall back to the folder name (the path for a drive root). Adding an existing entry keeps its position; a full workspace refuses another entry with `invalid-path`; moves clamp the index to the list. Unknown settings fields, including unknown workspace-entry fields, are kept on write. Writes go to a temp file in the same folder that is renamed over the original. A file over 1 MiB is left untouched and defaults are used.
- `serverPort` in `desktop.json` — a nonzero TCP port, reused when available to preserve the board's localStorage origin.
- `server.log`, `server.log.1` — shell events and the server's output, including one rotated log.
- `index\` — the disposable search index; the server rebuilds it from the files.
- `update-cache\` — a downloaded, signed update awaiting installation; it is verified again when restored.

### Updates and What's new

Release builds check for updates on startup and periodically while running; automatic checks are enabled by default and can be disabled in **Help**. If saving this preference fails, the menu keeps the saved value and shows the same localized settings-save error dialog as clearing recent projects. A manual check is also available there. Installed builds download the update and verify its updater signature and version before offering **Restart and update**, **Skip this version** or **Later**. A dirty editor is checked before installation. The updater signature does not replace Windows code signing.

Package downloads have a 512 MiB safety limit (the installer is about 33 MB). An optional manifest `size`, at the top level or on an artifact with the selected download URL, is checked before requesting the package. Actual bytes are counted even without Content-Length or with a false smaller size. The plugin exposes Content-Length only in its first chunk callback: an excessive header is rejected there rather than buffering the response. Since `on_chunk` cannot return an error, a one-shot signal makes a biased `tokio::select!` drop the download future at its next yield, releasing the HTTP stream and in-memory buffer; there can be in-flight chunks beyond the limit before that yield. A same-poll completion is rejected too. The reason is logged and manual checks show the usual localized check-failed dialog. Signature/version verification, cache, installer preparation/launch and temporary-directory cleanup remain on the existing plugin path. Limitation: plugin 2.14.1 reads the manifest with `response.json()` and exposes no response-size hook, so the manifest itself has no byte cap (the existing 30-second request timeout still applies).

Portable builds do not download or install an update: they notify the user and offer to open the release download page. After a successful in-app update, the bundled **What's new** window shows changes since the previous version; **Help → What's new** opens it on demand. The window reads the bundled English or Russian changelog, falling back to English if the Russian file is absent. Failure to create or reopen the window is logged and shown in a nonfatal native error dialog in the shell's current language.

The pinned `tauri-plugin-updater` 2.14.1 creates Windows temporary directories named `Deckmate-<semver>-updater-<6 ASCII alphanumeric characters>` (the suffix comes from `tempfile` 3.27.0), containing `Deckmate-<semver>-installer.exe` for our raw NSIS package. The plugin does not expose these paths to the shell, and `desktop.json` pending updates record only versions. Before clearing pending/cache state, startup cleanup considers only directories for that pending version: empty ones, or a single exactly named installer whose bytes match this installation's cached package. Cleanup never recurses or follows symlinks/junctions/reparse points; unrecognized, unattributed or unexpected contents are retained and logged, even with automatic checks disabled. This deliberately leaves uncertain old leftovers rather than risking user files.

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

The main window may navigate only to the bundled launcher (`http://tauri.localhost/index.html`), its static `startup.html` splash and the current server origin; iframes only to the current server origin. Any other `http(s)` target opens in the system browser and is canceled in the app; every other scheme is canceled outright. Page-initiated new-window requests do not create app windows: an `http(s)` target, including the current server's document and reference links, goes to the system browser; bundled app URLs and all other schemes are dropped. The shell itself may open the separate What's new window. Navigating back to either local page while a project is open is intercepted and routed through the shell, which stops the server before the start screen appears. The splash does not satisfy launcher authorization and receives no board bridge or additional capabilities.

### WebView2 permissions

As of 2026-11-10, the main window's `PermissionRequested` handler denies every kind, without prompting or notification exceptions. These are all kinds in the pinned WebView2 bindings; unknown future kinds are denied too. The client has no system Notification API or service worker usage.

| Kind / operation | Handler decision |
|---|---|
| `MICROPHONE` | Deny |
| `CAMERA` | Deny |
| `GEOLOCATION` | Deny |
| `NOTIFICATIONS` | Deny |
| `OTHER_SENSORS` | Deny |
| `CLIPBOARD_READ` (programmatic read) | Deny |
| `MULTIPLE_AUTOMATIC_DOWNLOADS` | Deny |
| `FILE_READ_WRITE` | Deny |
| `AUTOPLAY` | Deny |
| `LOCAL_FONTS` | Deny |
| `MIDI_SYSTEM_EXCLUSIVE_MESSAGES` | Deny |
| `WINDOW_MANAGEMENT` | Deny |
| `UNKNOWN_PERMISSION` and future kinds | Deny |
| Clipboard write and user-initiated Paste / Ctrl+V | Not a read-permission grant; normal editing remains available |
| Individual downloads | Not a `PermissionRequested` kind; this handler does not intercept `DownloadStarting` |
| Page fullscreen | Not a `PermissionRequested` kind; this handler does not intercept fullscreen changes |
| Native View → Full screen / F11 | Shell command, unaffected by page permissions |

### Network folders

UNC and device paths (`\\server\share`, `\\?\C:\`, `\\.\`), mapped network drives and paths that reach the network through a junction are accepted only when the folder came from the shell's folder dialog: the dialog result is remembered for that one folder, and typing such a path into the start screen is refused with `invalid-path`. Clicking a network folder in the recent list or workspace is allowed: workspace entries entered through the dialog, current project or recent list are trusted. The startup auto-open never opens a network `lastProject` by itself.

### Window

The main window is 1280×820 by default and at least 960×600. Saved bounds are restored when at least 120×60 of the window's top edge overlaps some monitor's work area, keeping its title bar reachable; bounds are saved 300 ms after a move or resize and on close; the maximized state is kept. The window is created hidden and shown once the bounds are restored and the first local page has loaded. With a saved project, that page is `launcher/startup.html`: a small static skeleton with no external assets or scripts, matching the native dark background to prevent a white flash. It has no launcher or board authority. Node starts in parallel with WebView2 creation; project/network validation runs off the UI thread, and the board navigates only after the existing stdout ready signal. There is no HTTP readiness polling or two-second auto-open visibility delay. Missing/network projects and server failures return to the full launcher. A 5-second fallback shows a local-page load error, so a broken start screen never leaves an invisible process. A second launch unminimizes, shows and focuses the running window. The title is `Deckmate` on the start screen and `Deckmate — <folder name>` on the board.

The main window leaves file drops to WebView2's HTML drag-and-drop handlers, so the board's attachment panel receives files as it does in a browser; no native file-drop capability is needed.

### Zoom

WebView2 browser accelerator keys (F5, Ctrl+P, Alt+Left, Ctrl+Shift+I) are disabled. When WebView2 has focus, application menu accelerators are dispatched by the shell through the same native menu handler; text-editing shortcuts remain available. The browser context menu retains only Cut, Copy, Paste, Select all and spellcheck entries. Renderer crashes are logged and reload the current page; an unresponsive renderer asks **Reload / Wait**; a browser-process exit stops the server and restarts Deckmate.

0.5–2 with step 0.1: Ctrl+=, Ctrl+− and Ctrl+0 (numpad keys included) and the View menu; WebView2's built-in zoom hotkeys are off, the shell handles the keys itself. The factor is clamped, stored in `zoomFactor` and applied after every page load; a WebView2 zoom change (Ctrl+wheel) is captured and persisted too.

### Menu and texts

The native menu has File (open folder, recent projects, Workspace, add current project to workspace, reveal project folder, switch and close project, reload, DevTools (enabled in debug builds and disabled in release builds), quit), Edit, View (zoom, full screen) and Help (updates, What's new, open logs folder and About — which lists the Deckmate, desktop shell, Tauri and bundled Node versions). Switch project opens the start screen with **Ctrl+Shift+P**. Add current project to workspace is enabled only when a project is open and not already listed. The Workspace submenu follows the saved order, assigns **Ctrl+1…Ctrl+9** to its first nine entries, and disables missing folders. Recent and workspace entries carry the folder path inside their menu id, so a reordered list cannot misroute a queued click. Shell texts are English and Russian side by side under the same keys in `texts.rs` — the Rust counterpart of `defineText(en, ru)`; switching the language rebuilds the menu.

### Bundled Node

Node 26, the major of `engines` in the root `package.json`. [node-runtime.json](node-runtime.json) pins the exact version and the SHA-256 of the official `win-x64/node.exe` (26.13.0 as of 2026-11-09), plus the SHA-256 of the complete `LICENSE` from that Node tag; `build.rs` embeds the version for the About dialog. `prepare-sidecar.mjs` downloads the binary from nodejs.org with an npmmirror fallback and the license from the pinned GitHub tag, verifies both hashes and caches both files in `desktop/.cache/`. It then runs [desktop-notices.mjs](scripts/desktop-notices.mjs), which adds the licenses of the locked Windows Rust dependency graph and the Microsoft.Web.WebView2 SDK to `src-tauri/THIRD-PARTY-NOTICES.txt`.

The Node compile cache remains disabled. On 2026-11-09, five debug `Deckmate.exe --self-test` trials on the same initialized project measured median `startMs` of 670 without the cache, 716 with an empty cache, and 968 with a warm cache (Node 26.13.0). Only the compile cache was reset between paired trials; the search index stayed warm. Parallel window/server startup avoids putting WebView2 creation and guard installation in front of the server's ready event.

### Measuring startup without an installer

`server.log` records `[startup]` milestones in debug and release: `settings-loaded`, `node-spawned` (with PID), `window-created`, `window-visible`, `server-ready`, and `board-data-painted`, each with UTC and monotonic elapsed milliseconds from shell entry. The board milestone uses the shell's origin-scoped initialization script: it waits for a visible data snapshot and loaded catalog, then two animation frames; an empty `.app-shell` or navigation completion does not count. It does not change server or client code.

After building the board and shell, run from the repository root:

```sh
node desktop/scripts/startup-smoke.ts --label after-debug --runs 3 --expect-splash --check-fallbacks
node --test desktop/scripts/startup.test.mjs
```

The script reuses the repository's CDP driver, isolates settings and WebView2 profiles under `desktop/.cache/startup-debug/`, and disables update checks. Each run starts immediately before spawning `Deckmate.exe`; one warm-up is excluded, then three samples produce medians. `windowMs` records the first native show of a loaded document after restoring bounds; `dataMs` records visible board data after two animation frames. These are application milestones, not optical measurements of a physical display. The index and profile stay warm; the server stops through its existing board bridge between samples, then native Close and an explicit wait for that shell's WebView2 browser process to exit release the profile before the next launch. UTC logs and sample JSON stay in the fixture folder. `--expect-splash` separately gates server readiness on a file event, verifies a visible dark splash, denied launcher/board commands and the unchanged CSP, saves its screenshot, then releases readiness and checks the board. `--check-fallbacks` additionally checks a fresh launcher, a missing project, a refused network auto-open and a server that exits early; `--checks-only` runs these assertions without collecting timings. `--fixture`, `--runs` and `--exe` select another isolated fixture, sample count or binary. `--baseline-exe <instrumented-before.exe>` warms both binaries and alternates their order between pairs, writing an additional `<label>-before.json`. Keep the same milestone instrumentation in both binaries.

Measured 2026-11-12 on Windows x64 / Node 26.13.0: debug baseline `559cea89` with the same milestone instrumentation, one warm-up per binary, then three alternating launches each on the same demo, warm index and profile (`paired-clean-debug-before.json` / `paired-clean-debug.json`):

| Milestone, median milliseconds from process launch | Before | After |
|---|---:|---:|
| First loaded window shown | 1094 | 446 |
| Visible board data painted | 1866 | 1881 |
| Node spawned | 434 | 149 |
| Server ready | 941 | 747 |

The first window appeared 648 ms earlier (59%). The board-data median differed by 15 ms; these samples show the gain in first-window latency rather than a faster rendered board. Earlier batches that waited only for the shell process showed large WebView2 startup variation; waiting for its browser process to exit made repeated launches comparable. Neither binary enabled the Node compile cache.


## Security notes and known limitations

- **No embedded board HTML.** Server and client filter Vision scenes: `iframe`/unknown element types are hidden with warnings on read and rejected on save; AI generation data, executable links, non-raster scene files and unsupported app state are removed. Only project nodes and canonical HTTPS YouTube embeds are allowed; scene/image sizes are bounded, and reads never rewrite project files.
- **Same-origin iframes can reach the board bridge.** Vision renders project content in same-origin iframes on the board, and such an iframe can invoke the eight board commands: WebView2 IPC does not identify the calling frame, so the top-frame check Electron made cannot be repeated on the Rust side. The bridge remains restricted to listing workspace/recent projects, explicit workspace mutations, dirty-state reporting, switching to a listed project and showing the start screen. Every command passes the current-origin check; additions are restricted to the native dialog, current project or recent list. Same-origin content can change workspace membership/order, dirty state or trigger navigation, but cannot add or open an arbitrary caller-provided path.
- **DevTools are off in release builds.** The tauri crate is built without the `devtools` feature. The menu item remains visible but is disabled in release builds; its handler is compiled only with debug assertions.
- **Debug-only hooks.** `DECKMATE_DESKTOP_NODE`, `DECKMATE_DESKTOP_SERVER`, `DECKMATE_DESKTOP_CDP_PORT` (the smoke's CDP port), `DECKMATE_DESKTOP_SETTINGS_DIR` (the smoke's throwaway settings folder, with a shared `webview/` profile for the main and What's new windows), `DECKMATE_DESKTOP_DIRTY_POLICY=refuse` (cancels dirty navigation/quit without opening a native dialog), and `DECKMATE_DESKTOP_EXTERNAL_LOG` (records external links instead of opening the user's browser) are honored only by debug builds; release builds never read them.
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
- The folder dialog — opening and creating a project through it; failure/timeout/cancellation warnings in both languages, **Open folder in Explorer**, preserved partial contents and unchanged recent/last-project entries. Quit during init must reap the CLI without opening a warning, and quit with a warning already open must not wait for its acknowledgement.
- Automatic-update preference save failure: the localized settings error appears and the menu keeps its previous value. Run the isolated updater e2e size cases to verify response cancellation and a responsive shell; no installer is launched by these checks.
- A second launch focuses the running window.
- Zoom keys and menu items, and the factor surviving a restart.
- Native Leave/Stay and Reload/Wait choices, browser-process restart, panic/startup error boxes and startup without WebView2 Runtime; CDP cannot answer these dialogs. Context-menu spelling entries and physical menu accelerators also require a manual check.
- The installer over an Electron 0.5.0 install: one Deckmate entry in Apps, one shortcut, settings kept ([src-tauri/windows/README.md](src-tauri/windows/README.md)).
