# Deckmate Desktop

Electron shell for [Deckmate](../README.md), a local project board over Markdown. The shell starts the Deckmate server on a free local port and shows the board in a window. Project files stay the source of truth.

## Requirements

- Windows 10 or 11.
- Node.js 26 or newer with npm for building (the repository's own requirement; the shipped app runs the server on the Node 24 bundled with Electron).
- For building only: access to the Electron and electron-builder mirrors (GitHub may be unreachable).

## Prepare

Pack the deckmate repository and install dependencies:

```sh
node scripts/prepare-deckmate.mjs
```

The script runs `npm pack` in the deckmate repository (which builds `dist/`), writes the tgz into this folder, points `dependencies.deckmate` at it and runs `npm install`. By default it packs the repository one level up (this folder lives inside it); set `DECKMATE_REPO` to pack another checkout. Repeat it after every change to deckmate.

For browser-based development of the main app, run `npm run dev` from the repository root instead: Vite serves the board at `http://127.0.0.1:4318/` with hot reload and proxies to the watched server. This does not run the Electron shell.

## Run

```sh
npm start
```

## Build

```sh
npm run dist        # unpacked app: release\win-unpacked\Deckmate.exe
npm run dist:nsis   # installer: release\Deckmate Setup <version>.exe
```

Use the mirrors when GitHub is slow or blocked:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

## Settings and logs

Both are in `%APPDATA%\Deckmate\`:

- `desktop.json` — app settings, including the recent projects.
- `server.log` — output of the Deckmate server.

## How it works

- `main.js` — creates the window, finds a free port on `127.0.0.1`, forks the deckmate server as a `utilityProcess` and loads the board from it.
- `preload.cjs` — exposes the `window.deckmateDesktop` bridge. Only the bundled launcher may call it.
- `launcher/` — the start screen: open or create a project, pick from recent ones.
- The board's project menu lists other recent projects for direct switching through the Desktop bridge; browser sessions do not have this bridge.
- `build/` — application icons. `asar` is off, so the server files stay readable.

## Limitations

- The builds are not code-signed, so Windows SmartScreen may warn on first run.
