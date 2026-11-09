# Windows installer hooks

`installer-hooks.nsh` extends the Tauri 2 NSIS installer of Deckmate Desktop so it can replace an install made by the old Electron installer (electron-builder 26.18.1, `desktop/package.json` `build`, last shipped as `Deckmate Setup 0.5.0.exe`). Without it an upgrade leaves two "Deckmate" entries in Apps and two identical shortcuts, because the two installers register under different registry keys. The hook is wired in through `bundle.windows.nsis.installerHooks` (see the JSON fragment below).

## What the hook does

`NSIS_HOOK_PREINSTALL` runs inside Tauri's Install section, before Tauri copies files, writes registry keys or creates shortcuts:

1. **Per-user Electron install** (the electron-builder default): if `HKCU\Software\<GUID>` `InstallLocation` or the uninstall key says one exists, close a running `Deckmate.exe` (ask first, like Tauri does for its own app; kill it when the installer is silent; abort with a message if it will not close), then run the old `Uninstall Deckmate.exe` silently (`/S /currentuser _?=<folder>`), wait for it, and delete the leftover uninstaller exe and the now-empty folder.
2. **Per-machine Electron install** (user picked "all users" back then): same, with `/S /allusers`. Elevated: the old uninstaller runs in place and synchronously. Not elevated: the user is told first, then the old uninstaller raises the UAC prompt itself; if the entry survives, a message says to remove it in Windows Settings.
3. **Fallback when the old uninstaller is missing or fails**: remove only the stale uninstall/install registry keys and the shortcuts that actually point into the old folder (checked via Tauri's `IsShortcutTarget`), then continue.
4. **User data is never touched**: the hook never passes `--delete-app-data`, so `%APPDATA%\Deckmate` (`desktop.json` with recent projects, language, zoom, window bounds, plus the index) survives the replacement; `RMDir` calls take only empty folders.
5. **Over-the-air updates skip all of this** (2026-11-09): when the in-app updater runs the installer with `/UPDATE` (`$UpdateMode = 1`), the hook does nothing. The first Tauri installation already removed Electron, and repeating the per-machine branch would show its notice and a UAC prompt on every update.

Installer messages exist as `LangString`s in English (1033) and Russian (1049) under the same keys. The active one is chosen by the NSIS installer UI language: the OS language among the compiled languages, the selector choice when `displayLanguageSelector` is true, or what MUI remembered in `HKCU\Software\<manufacturer>\Deckmate\Installer Language`. A language without a definition falls back to the first loaded language, so `languages` must list English first.

## Facts about the old Electron install

Sources: `desktop/node_modules/app-builder-lib` (read at `D:\GitHub\deckmate\desktop\node_modules\app-builder-lib`) — file:line as of 26.18.1.

- **Uninstall GUID**: electron-builder computes `UUID.v5(appId, "50e065bc-3134-11e6-9bab-38c9862bdaf3")` (`out/targets/nsis/NsisTarget.js:49,261`; v5 = SHA1, lowercase hex, `builder-util-runtime/out/uuid.js:37-39,123-170`). For `com.deckmate.desktop` that is **`19b52c93-6424-5c44-a3b2-47e082c1e19e`** — reproduced with node through the real module and with an independent RFC 4122 v5 implementation. The GUID has no backslashes, so `UNINSTALL_APP_KEY` equals it and no second uninstall key is written (`NsisTarget.js:262-267,280-282`).
- **Registry keys** (`templates/nsis/multiUser.nsh:8-9`): uninstall info in `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\19b52c93-...` (HKLM for an "all users" install) with `DisplayName`, `DisplayVersion`, `DisplayIcon`, `UninstallString` `"<dir>\Uninstall Deckmate.exe" /currentuser` (or `/allusers`), `QuietUninstallString` `"... /currentuser /S"`, `NoModify`, `NoRepair`, `EstimatedSize` (`templates/nsis/include/installer.nsh:119-167`); install state in `HKCU\Software\19b52c93-...` with `InstallLocation`, `KeepShortcuts`, `ShortcutName`, `MenuDirectory` (`include/installer.nsh:104-109`). Both keys are deleted by the old uninstaller (`templates/nsis/uninstaller.nsh:250-254`).
- **Default folder**: per-user `%LOCALAPPDATA%\Programs\Deckmate` (`multiUser.nsh:30,47`; `APP_FILENAME` is the product name for `oneClick: false`, `NsisTarget.js:270`, `out/targets/targetUtil.js:40-43`); per-machine `%ProgramFiles%\Deckmate`.
- **Shortcuts** (`templates/nsis/common.nsh:84-108`, `include/installer.nsh:189-247`): `$DESKTOP\Deckmate.lnk` and `$SMPROGRAMS\Deckmate.lnk` (no menu subdirectory is configured); names can differ through the stored `ShortcutName`/`MenuDirectory` values, which the hook reads.
- **Uninstaller switches**: `/S` silent (`uninstaller.nsh:12-16`), `/currentuser` / `/allusers` pick the install to remove (`assistedInstaller.nsh:122-133`), `--delete-app-data` removes `%APPDATA%\Deckmate` — without it app data is kept (`uninstaller.nsh:216-248`); other flags: `--updated`, `--force-run`, `--keep-shortcuts`, `--no-desktop-shortcut` (`out/targets/nsis/nsisScriptGenerator.js:688`). A silent uninstall kills a running `Deckmate.exe` itself (`include/allowOnlyOneInstallerInstance.nsh:105-164`) — the hook closes the app before invoking it, so the user is asked rather than surprised. Uninstallers run with `_?=<dir>` stay in place; they then cannot delete their own exe, which the hook cleans up.

Tauri side (v2.7.4 bundler template `crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi`, docs <https://v2.tauri.app/distribute/windows-installer/>): default `installMode` `currentUser` installs into `%LOCALAPPDATA%\Deckmate`, registers `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Deckmate`, creates `$SMPROGRAMS\Deckmate.lnk` and (finish-page checkbox, or always when passive/silent) `$DESKTOP\Deckmate.lnk`, and removes `%APPDATA%\com.deckmate.desktop` only when the user checks "delete app data" — never `%APPDATA%\Deckmate`. `NSIS_HOOK_PREINSTALL` is inserted at the top of the Install section, before `CheckIfAppIsRunning`, file copy, registry writes and shortcuts.

## tauri.release.conf.json fragment

Add this to `desktop/src-tauri/tauri.release.conf.json` (it is merged over `tauri.conf.json`; paths are relative to `src-tauri`):

```json
{
  "bundle": {
    "windows": {
      "nsis": {
        "installerHooks": "./windows/installer-hooks.nsh",
        "installMode": "currentUser",
        "languages": ["English", "Russian"],
        "displayLanguageSelector": false
      }
    }
  }
}
```

- `installerHooks`: the hook file, path relative to `src-tauri`.
- `installMode: "currentUser"`: same default as the Electron install (per-user, no elevation, `%LOCALAPPDATA%`); the hook handles a stray per-machine install through UAC. Use `"perMachine"` only if the distribution model changes.
- `languages`: English first — it is the fallback language for the hook's `LangString`s — then Russian, matching the app's two languages; both have Tauri's own installer translations (`languages/English.nsh`, `languages/Russian.nsh` in the bundler).
- `displayLanguageSelector: false`: the installer follows the OS language (and remembers a manual MUI choice in `HKCU`); the app language itself is picked on the start screen.

## Testing

Syntax check, no build needed:

```sh
"%LOCALAPPDATA%\tauri\NSIS\makensis.exe" desktop/src-tauri/windows/hooks-syntax-check.nsi
```

The check script stubs the `nsis_tauri_utils` plugin and `IsShortcutTarget` (both come from the bundler in a real build) and compiles the hook; success means it parses. Nothing runs.

By hand, on a scratch machine or VM:

1. Install the last Electron release (`Deckmate Setup 0.5.0.exe`), open a project so `%APPDATA%\Deckmate\desktop.json` gets a `recent` entry, and leave a shortcut on the desktop.
2. Run the Tauri installer. Expect: one "Deckmate" entry in Apps afterwards (publisher/version from the new install), one Start-menu shortcut, the desktop shortcut offered by the finish page (the old one removed), `%APPDATA%\Deckmate\desktop.json` intact with the recent project, and the old `%LOCALAPPDATA%\Programs\Deckmate` folder gone.
3. Variant: launch the old Deckmate before step 2 — the installer must ask to close it (Russian text on a Russian OS).
4. Variant (needs an admin VM): install the Electron release "for all users", then the Tauri installer — expect the UAC notice, and afterwards a single Apps entry.
5. Variant: delete `Uninstall Deckmate.exe` from the old folder before step 2 — the installer must still finish, with the stale entry and the old shortcuts gone.
