# Deckmate Desktop

Tauri 2 shell for [Deckmate](../README.md), a local project board over Markdown. The shell starts the Deckmate server on a free local port and shows the board in a window; project files stay the source of truth. It replaces the Electron shell shipped through 0.5.0.

## Requirements

- To use the app: Windows 10 or 11 (x64). The interface renders through the system Microsoft Edge WebView2 runtime, which is part of Windows 11; on Windows 10 the installer sets it up when it is missing. The app ships its own Node.js 26 runtime for the local server, so users install nothing else and need no terminal.
- To build: Rust stable with the MSVC toolchain, Node.js 26 with npm, and the repository's own build (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Development loop

| Work on | Run | Needs Rust |
|---|---|---|
| Board UI | `npm run dev` in the repository root, browser at `http://127.0.0.1:4318/` | no |
| Start screen | open `desktop/launcher/index.html` in a browser (mock bridge) | no |
| Shell from a checkout | `npm run build` in the root, then `npm run dev` in `desktop/` | yes |
| Shell logic | `cargo test`, `cargo fmt --check`, `cargo clippy -- -D warnings` — each with `--manifest-path desktop/src-tauri/Cargo.toml` | yes |
| Shell self-test | `desktop/src-tauri/target/debug/Deckmate.exe --self-test <folder>` | yes |
| Shell smoke | `npm run desktop:smoke` in the repository root | yes |
| Start-screen screenshots | `npm run capture:launcher` in the repository root | no |
| Release build | `node desktop/scripts/prepare-sidecar.mjs`, then `npm ci` and `npm run dist` in `desktop/` | yes |

Rust holds only what needs the OS: window, menu, dialogs, the server process, settings. Product logic stays in TypeScript. Pure Rust logic (settings normalization, path checks, the recent list, the ready line) has unit tests; `npm test` does not build Rust. A cold Rust build takes minutes; agents working in several worktrees can share one `CARGO_TARGET_DIR`, which Cargo locks.

`Deckmate.exe --self-test <folder>` starts the server on the given folder, checks that it answers HTTP and stops through stdin, prints one JSON line (`ok`, `url`, `startMs`, `stopMs`, `error`) and exits 0 or 1, without opening a window. A release build attaches to the parent console so the line is visible there; a debug build uses `node` from `PATH` and the repository's `dist/`, so it needs `npm run build` first.

`npm run desktop:smoke` drives the real debug window over CDP through the page bridges — the same path a person takes, without a person looking at the window: the launcher bridge and `getState()`, the window staying hidden until the first load, opening a project, the board bridge and its refusals, the navigation guard, returning to the start screen, creating a project, the Job Object reaping the server when the shell dies, and the saved `desktop.json`. It builds nothing itself (it wants the cargo debug build and `npm run build`) and keeps all state in a temporary settings folder.

`npm run capture:launcher` renders start-screen frames into `.deckmate/launcher-shots/` with the same mock bridge.

## How it works

### Modules

| Module in `src-tauri/src/` | What it does |
|---|---|
| `lib.rs` | Entry point: the `--self-test` mode, plugins, command registration, app lifecycle. |
| `app.rs` | Shell state and project lifecycle: open, create, stop, superseding launches, status events, startup auto-open, quit. |
| `server.rs` | The server process: environment filtering, the free port, the ready line, stdin shutdown, timeouts, project creation through the CLI. |
| `paths.rs` | Program resolution (debug/release), the settings folder, Windows path classification (network, device), case-insensitive path comparison. |
| `bridge.rs` | The nine Tauri commands and their authorization. |
| `webview.rs` | WebView2 handlers: navigation, popups, permissions, zoom keys, the console log; the board-bridge script. |
| `window.rs` | The main window: creation, hidden-until-loaded, bounds save and restore, zoom, navigation. |
| `settings.rs` | `desktop.json`: normalization, atomic writes, the recent list, bounds and zoom validation, the system locale. |
| `menu.rs` | The native menu and its events. |
| `log.rs` | `server.log` with trimming and token masking. |
| `job.rs` | The Windows Job Object wrapper. |
| `texts.rs` | Shell texts, English and Russian side by side. |
| `self_test.rs` | The `--self-test` run. |

### Server process

- **Program.** A release build runs the bundled `node.exe` (next to `Deckmate.exe`) on `resources/deckmate/dist/server/main.js`; the CLI is `resources/deckmate/bin/deckmate.mjs`. A debug build runs `DECKMATE_DESKTOP_NODE` (default `node` from `PATH`) on `DECKMATE_DESKTOP_SERVER` (default `<repo>/dist/server/main.js`, resolved from `CARGO_MANIFEST_DIR`); the CLI is `<repo>/bin/deckmate.mjs`. No packing is needed to run the shell from a checkout.
- **Environment.** The inherited environment without any `DECKMATE_*`, `FREETION_*`, `NODE_*` or `OPENSSL_*` variable (case-insensitive — `NODE_OPTIONS` or `OPENSSL_CONF` from a parent shell must not load code into the bundled Node), plus `DECKMATE_DATA=<folder>`, `DECKMATE_PORT=<free port>`, `DECKMATE_HOST=127.0.0.1`, `DECKMATE_INDEX=<settings dir>\index` and `DECKMATE_SHUTDOWN_STDIN=1`. The working directory is the project folder; the process starts with `CREATE_NO_WINDOW`.
- **Port.** The shell binds `127.0.0.1:0`, reads the free port, releases it and passes it on.
- **Ready.** The first stdout match of `Deckmate: http://127.0.0.1:<port>` for exactly the port the shell chose — a further digit invalidates the match, so port 4318 never matches 43180 — within 20 s; the match survives chunk boundaries and a trailing path or query. An exit before that is `start-failed`, no match in time is `timeout`; both carry the last 12 stderr lines.
- **Shutdown.** The shell writes `{"type":"shutdown"}\n` to the server's stdin and waits up to 3 s, then kills it; a server that never became ready is killed outright. The server, started with `DECKMATE_SHUTDOWN_STDIN=1`, also shuts down at the end of stdin, so it never outlives the shell. The stdin handle is taken out of the tokio `Child` and held by the run loop: `Child::wait()` would close stdin while waiting, and the server would read that as the shell going away.
- **Job Object.** The server and the project-init CLI run inside a Windows Job Object with kill-on-close, so they die with the shell even on a hard kill.
- **Log.** `<settings dir>\server.log`: shell events (`start <folder> on port <p>`, `stop <folder>`, unexpected exit with code), every server output line prefixed `[stdout] ` or `[stderr] `, and renderer warnings and errors as `[renderer …]`. The log is trimmed to 5 MB at open and after every write; `token=` secrets are masked.
- **Creating a project.** `node <cli> init <folder>`, run from the nearest existing parent directory. Exit code 0 is success; otherwise the result is `create-failed` with the stderr tail. The folder then opens as a trusted path.

### Settings and logs

Everything lives in `%APPDATA%\Deckmate\` — the same folder Electron used as `userData`, not Tauri's `app_config_dir()` (which would be `%APPDATA%\com.deckmate.desktop`), so an upgrade keeps recent projects, language, zoom, window bounds and the index:

- `desktop.json` — settings: `lastProject`, `recent` (at most 10 entries `{ path, name, lastOpened }`), `language` (`en` or `ru`; a missing, invalid or `null` value falls back to the system locale at load), `zoomFactor` (0.5–2, step 0.1), `windowBounds`, `windowMaximized`. The fields and their normalization match the Electron file; unknown fields are kept on write. Writes go to a temp file in the same folder that is renamed over the original. A file over 1 MiB is left untouched and defaults are used.
- `server.log` — shell events and the server's output.
- `index\` — the disposable search index; the server rebuilds it from the files.

### Bridges

Two page-side contracts reach the shell. [launcher/tauri-bridge.js](launcher/tauri-bridge.js) defines `window.deckmateDesktop` over Tauri IPC when the start screen runs in the shell; in a plain browser it does nothing and the start screen keeps its mock bridge. `onStatus` returns an unsubscribe function, and `getState()` replays a pending error status after the page can receive it. The board uses [client/desktop-bridge.ts](../client/desktop-bridge.ts); when a project opens, the shell registers an initialization script that defines `window.deckmateBoard` only in the top frame of the current server origin — replaced on every project switch and removed on the start screen.

| Page bridge | Tauri command or event |
|---|---|
| `deckmateDesktop.getState()` | `desktop_get_state` |
| `deckmateDesktop.chooseFolder()` | `desktop_choose_folder` |
| `deckmateDesktop.openProject(folder)` | `desktop_open_project` |
| `deckmateDesktop.createProject(options)` | `desktop_create_project` |
| `deckmateDesktop.removeRecent(folder)` | `desktop_remove_recent` |
| `deckmateDesktop.setLanguage(lang)` | `desktop_set_language` |
| `deckmateDesktop.onStatus(callback)` | event `desktop://status` |
| `deckmateBoard.recentProjects()` | `board_recent_projects` |
| `deckmateBoard.switchProject(path)` | `board_switch_project` |
| `deckmateBoard.showStartScreen()` | `board_show_start_screen` |

Every command returns `{ ok: true }` or `{ ok: false, code, message }`, with the codes `invalid-path`, `missing`, `not-empty`, `create-failed`, `start-failed`, `timeout`, `load-failed`, `superseded`, `closed`, plus `forbidden` (a command called from the wrong page), `not-recent` and `invalid-language`. `getState()` returns `recent`, `lastProject`, `version`, `deckmateVersion`, `locale` and `language`.

### Capabilities and Rust-side checks

[capabilities/](src-tauri/capabilities/) splits what each page may call: `launcher` is local-only (the bundled app origin) with the six desktop commands and the status event; `board` is remote `http://127.0.0.1:*` with only the three board commands. No other plugin permissions reach a remote page.

Rust checks again on every command (`bridge.rs`): launcher commands answer only the main window showing the bundled launcher URL; board commands answer only the main window at the current server origin, and `board_switch_project` accepts only a folder already in `recent` (the Windows path comparison ignores case and separator). A new launch supersedes one in flight, so a slow open cannot land on a stale window.

### Navigation and new windows

The main window may navigate only to the bundled launcher (`http://tauri.localhost/index.html`) and the current server origin; iframes only to the current server origin. Any other `http(s)` target opens in the system browser and is canceled in the app; every other scheme is canceled outright. New-window requests never open a second window: an `http(s)` target goes to the system browser, anything else is dropped. Navigating back to the launcher URL while a project is open is intercepted and routed through the shell, which stops the server before the start screen appears.

### Network folders

UNC and device paths (`\\server\share`, `\\?\C:\`, `\\.\`), mapped network drives and paths that reach the network through a junction are accepted only when the folder came from the shell's folder dialog: the dialog result is remembered for that one folder, and typing such a path into the start screen is refused with `invalid-path`. Clicking a network folder in the recent list is allowed; the startup auto-open never opens a network `lastProject` by itself.

### Window

One main window, 1280×820 by default and at least 960×600. Saved bounds are restored when at least 120×60 of the window overlaps some monitor's work area; bounds are saved 300 ms after a move or resize and on close; the maximized state is kept. The window is created hidden and shown once the bounds are restored and the first page load has finished; a 5-second fallback shows it with an error, so a broken start screen never leaves an invisible process. A second launch unminimizes, shows and focuses the running window. The title is `Deckmate` on the start screen and `Deckmate — <folder name>` on the board.

### Zoom

0.5–2 with step 0.1: Ctrl+=, Ctrl+− and Ctrl+0 (numpad keys included) and the View menu; WebView2's built-in zoom hotkeys are off, the shell handles the keys itself. The factor is clamped, stored in `zoomFactor` and applied after every page load; a WebView2 zoom change (Ctrl+wheel) is captured and persisted too.

### Menu and texts

The native menu has File (open folder, recent projects, reveal project folder, switch and close project, reload, DevTools in debug builds only, quit), Edit, View (zoom, full screen) and Help (open logs folder, About — which lists the Deckmate, desktop shell, Tauri and bundled Node versions). Recent entries carry the folder path inside their menu id, so a reordered list cannot misroute a queued click. Shell texts are English and Russian side by side under the same keys in `texts.rs` — the Rust counterpart of `defineText(en, ru)`; switching the language rebuilds the menu.

### Bundled Node

Node 26, the major of `engines` in the root `package.json`. [node-runtime.json](node-runtime.json) pins the exact version and the SHA-256 of the official `win-x64/node.exe` (26.13.0 as of 2026-11-09); `build.rs` embeds the version for the About dialog, and `prepare-sidecar.mjs` downloads it from nodejs.org with an npmmirror fallback, checks the hash and caches the file in `desktop/.cache/`.

## Security notes and known limitations

- **Same-origin iframes can reach the board bridge.** Vision renders project content in same-origin iframes on the board, and such an iframe can invoke the three board commands: WebView2 IPC does not identify the calling frame, so the top-frame check Electron made cannot be repeated on the Rust side. Accepted on 2026-11-09: the bridge is deliberately narrow — list recent projects, switch to one of them, show the start screen — and every command still passes the origin and recent-list checks, so the worst case is a project switch.
- **DevTools are off in release builds.** The tauri crate is built without the `devtools` feature, and the menu item exists only in debug builds.
- **Debug-only hooks.** `DECKMATE_DESKTOP_NODE`, `DECKMATE_DESKTOP_SERVER`, `DECKMATE_DESKTOP_CDP_PORT` (the smoke's CDP port), `DECKMATE_DESKTOP_SETTINGS_DIR` (the smoke's throwaway settings folder) and `DECKMATE_DESKTOP_EXTERNAL_LOG` (the smoke records external links in this file instead of opening the user's browser) are honored only by debug builds; release builds never read them.
- **The builds are not code-signed**, so Windows SmartScreen may warn on first run.

## Release and upgrading from Electron

The `desktop` job of [release.yml](../.github/workflows/release.yml) builds the installer on a Windows runner: `prepare-sidecar.mjs` stages the Node runtime and the deckmate package (npm pack, extract, `npm ci --omit=dev`) and smoke-checks the staged build; `npm run dist` builds the unpacked app and the NSIS installer; the job self-tests the unpacked build, then installs and uninstalls the installer itself. The assets are packed into `desktop/release/` under the names the Electron releases already used — installer `Deckmate Setup <version>.exe`, portable `Deckmate-<version>-win-x64.zip` with `Deckmate.exe`, `node.exe` and the `deckmate/` folder — and uploaded to the GitHub Release.

The NSIS installer removes an install made by the old Electron installer (per-user and per-machine) before registering itself, and never touches `%APPDATA%\Deckmate`; see [src-tauri/windows/README.md](src-tauri/windows/README.md).

Sizes measured 2026-11-09: installer 32 MB (the Electron installer was 121 MB); installed 131 MB (Electron: 380 MB), of which `node.exe` is 95.5 MB.

Versions 0.5.0 and earlier shipped an Electron shell; recent projects, language, zoom and window position carry over through the shared settings folder.

## Manual checks before a release

`npm run desktop:smoke` covers the pages and the server: launcher, board, both bridges, the navigation guard, the server lifetime. What it cannot drive stays manual:

- Native menu items in both languages: open, recent, reveal project folder, switch and close project, zoom, full screen, open logs folder, About.
- The folder dialog — opening and creating a project through it.
- A second launch focuses the running window.
- Zoom keys and menu items, and the factor surviving a restart.
- The installer over an Electron 0.5.0 install: one Deckmate entry in Apps, one shortcut, settings kept ([src-tauri/windows/README.md](src-tauri/windows/README.md)).
