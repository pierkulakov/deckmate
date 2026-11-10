# Windows installer hooks

`installer-hooks.nsh` extends the Tauri 2 NSIS installer of Deckmate Desktop in two ways: `NSIS_HOOK_PREINSTALL` replaces an install made by the old Electron installer (electron-builder 26.18.1, `desktop/package.json` `build`, last shipped as `Deckmate Setup 0.5.0.exe`), and `NSIS_HOOK_POSTUNINSTALL` honors the uninstaller's "delete app data" checkbox for the real data folder. Without the former an upgrade leaves two "Deckmate" entries in Apps and two identical shortcuts, because the two installers register under different registry keys. The hooks are wired in through `bundle.windows.nsis.installerHooks` (see the JSON fragment below).

## What the hooks do

`NSIS_HOOK_PREINSTALL` runs inside Tauri's Install section, before Tauri copies files, writes registry keys or creates shortcuts:

1. **Per-user Electron install** (the electron-builder default): if `HKCU\Software\<GUID>` `InstallLocation` or the uninstall key says one exists, close a running `Deckmate.exe` (ask first, like Tauri does for its own app; kill it when the installer is silent; abort with a message if it will not close), then run the old `Uninstall Deckmate.exe` silently (`/S /currentuser _?=<folder>`), wait for it and record its exit code.
2. **Per-machine Electron install** (user picked "all users" back then): detects either `InstallLocation` or `UninstallString`, then uses the same removal path with `/S /allusers`. If only `UninstallString` survives, the hook extracts the executable path (quoted paths and unquoted paths with spaces are supported), checks the exact `Uninstall Deckmate.exe` filename and a local absolute path, and normalizes its parent directory. The directory must be the old default `%ProgramFiles%\Deckmate` (32- or 64-bit), or contain both `Deckmate.exe` and `resources\app.asar` as evidence of a custom Electron installation. Unknown paths, wildcards and malformed quotes abort without executing anything or removing registration. Registry arguments are never executed: the hook constructs its own command with only the known switches. Elevated: the old uninstaller runs in place and synchronously. Not elevated: the user is told first, then the old uninstaller raises the UAC prompt itself. If its executable or registration survives, installation stops instead of creating a second Apps entry.
3. **A failed uninstall is never masked as a stale install**: when the old `Deckmate.exe` still exists, the hook keeps the old registry registration, shows a bilingual error and aborts before Tauri writes anything. The old uninstaller's exit code is printed in the install log. Only when no old executable remains is the registration considered stale: its uninstall/install keys and shortcuts into the old folder are removed and installation continues. This also covers a missing uninstaller with binaries still present — that case aborts rather than leaving unregistered binaries. **Validation precedes cleanup in every branch**: per-user and elevated per-machine runs call `DECKMATE_OLD_CHECK_UNINSTALL` before deleting the in-place uninstaller or its empty folder; the non-elevated branch additionally rejects a surviving uninstall registration before that cleanup. A failed run therefore leaves the old uninstaller, registration and shortcuts available for a retry or removal from Windows Settings instead of making every retry fail on the same surviving binary.
4. **User data is never touched by installation or update**: the hook never passes `--delete-app-data`, so `%APPDATA%\Deckmate` (`desktop.json` with recent projects, language, zoom, window bounds, plus the index) survives the replacement; `RMDir` calls take only empty folders. The only way the folder ever goes is an explicit "delete app data" uninstall — item 6.
5. **Over-the-air updates skip all of this** (2026-11-09): when the in-app updater runs the installer with `/UPDATE` (`$UpdateMode = 1`), the hook does nothing. The first Tauri installation already removed Electron, and repeating the per-machine branch would show its notice and a UAC prompt on every update.
6. **"Delete app data" reaches the real folder** (2026-11-09): Deckmate keeps its settings, `server.log` and the index in `%APPDATA%\Deckmate` — the Electron-era `userData` folder — while the uninstaller's built-in checkbox branch removes `%APPDATA%\com.deckmate.desktop` and `%LOCALAPPDATA%\com.deckmate.desktop` (installer.nsi 915-929), folders nothing ever writes. `NSIS_HOOK_POSTUNINSTALL`, which Tauri inserts at the end of its Uninstall section (installer.nsi 931-933), runs `RMDir /r "$APPDATA\Deckmate"` under the same guards the built-in branch uses (installer.nsi 915-916): only when the checkbox is checked — a silent or passive uninstall never checks it — and never during an `/UPDATE` run, because the installer can invoke the previous uninstaller with `/UPDATE` on replace paths (installer.nsi 374) and an update must keep the settings it upgrades. `SetShellVarContext current`, as in the built-in branch (installer.nsi 926), stays on the uninstalling user's roaming profile instead of the all-users ProgramData whatever `INSTALLMODE` the build uses. Nothing outside `%APPDATA%\Deckmate` is removed; project folders live where the user put them and are never touched.

Installer messages exist as `LangString`s in English (1033) and Russian (1049) under the same keys. The active one is chosen by the NSIS installer UI language: the OS language among the compiled languages, the selector choice when `displayLanguageSelector` is true, or what MUI remembered in `HKCU\Software\<manufacturer>\Deckmate\Installer Language`. A language without a definition falls back to the first loaded language, so `languages` must list English first.

## Facts about the old Electron install

Sources: `desktop/node_modules/app-builder-lib` (read at `D:\GitHub\deckmate\desktop\node_modules\app-builder-lib`) — file:line as of 26.18.1.

- **Uninstall GUID**: electron-builder computes `UUID.v5(appId, "50e065bc-3134-11e6-9bab-38c9862bdaf3")` (`out/targets/nsis/NsisTarget.js:49,261`; v5 = SHA1, lowercase hex, `builder-util-runtime/out/uuid.js:37-39,123-170`). For `com.deckmate.desktop` that is **`19b52c93-6424-5c44-a3b2-47e082c1e19e`** — reproduced with node through the real module and with an independent RFC 4122 v5 implementation. The GUID has no backslashes, so `UNINSTALL_APP_KEY` equals it and no second uninstall key is written (`NsisTarget.js:262-267,280-282`).
- **Registry keys** (`templates/nsis/multiUser.nsh:8-9`): uninstall info in `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\19b52c93-...` (HKLM for an "all users" install) with `DisplayName`, `DisplayVersion`, `DisplayIcon`, `UninstallString` `"<dir>\Uninstall Deckmate.exe" /currentuser` (or `/allusers`), `QuietUninstallString` `"... /currentuser /S"`, `NoModify`, `NoRepair`, `EstimatedSize` (`templates/nsis/include/installer.nsh:119-167`); install state in `HKCU\Software\19b52c93-...` with `InstallLocation`, `KeepShortcuts`, `ShortcutName`, `MenuDirectory` (`include/installer.nsh:104-109`). Both keys are deleted by the old uninstaller (`templates/nsis/uninstaller.nsh:250-254`).
- **Default folder**: per-user `%LOCALAPPDATA%\Programs\Deckmate` (`multiUser.nsh:30,47`; `APP_FILENAME` is the product name for `oneClick: false`, `NsisTarget.js:270`, `out/targets/targetUtil.js:40-43`); per-machine `%ProgramFiles%\Deckmate`.
- **Shortcuts** (`templates/nsis/common.nsh:84-108`, `include/installer.nsh:189-247`): `$DESKTOP\Deckmate.lnk` and `$SMPROGRAMS\Deckmate.lnk` (no menu subdirectory is configured); names can differ through the stored `ShortcutName`/`MenuDirectory` values, which the hook reads.
- **Uninstaller switches**: `/S` silent (`uninstaller.nsh:12-16`), `/currentuser` / `/allusers` pick the install to remove (`assistedInstaller.nsh:122-133`), `--delete-app-data` removes `%APPDATA%\Deckmate` — without it app data is kept (`uninstaller.nsh:216-248`); other flags: `--updated`, `--force-run`, `--keep-shortcuts`, `--no-desktop-shortcut` (`out/targets/nsis/nsisScriptGenerator.js:688`). A silent uninstall kills a running `Deckmate.exe` itself (`include/allowOnlyOneInstallerInstance.nsh:105-164`) — the hook closes the app before invoking it, so the user is asked rather than surprised. Uninstallers run with `_?=<dir>` stay in place; they then cannot delete their own exe, which the hook cleans up.

Tauri side (tauri-bundler 2.10.4, the bundler inside `@tauri-apps/cli` 2.12.4; template `crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi`, docs <https://v2.tauri.app/distribute/windows-installer/>): default `installMode` `currentUser` installs into `%LOCALAPPDATA%\Deckmate`, registers `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Deckmate`, creates `$SMPROGRAMS\Deckmate.lnk` and (finish-page checkbox, or always when passive/silent) `$DESKTOP\Deckmate.lnk`, and removes `%APPDATA%\com.deckmate.desktop` plus `%LOCALAPPDATA%\com.deckmate.desktop` only when the user checks "delete app data" — never `%APPDATA%\Deckmate`; the post-uninstall hook closes that gap (item 6 above). `NSIS_HOOK_PREINSTALL` is inserted at the top of the Install section (installer.nsi 686-687), before `CheckIfAppIsRunning`, file copy, registry writes and shortcuts; `NSIS_HOOK_POSTUNINSTALL` at the end of the Uninstall section (installer.nsi 931-933).

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

Detection/removal cases (2026-11-10):

| Registration / files | Expected result |
|---|---|
| HKCU: either legacy key remains | Existing per-user removal and stale-registration cleanup |
| HKLM: `InstallLocation` remains | Existing per-machine removal path |
| HKLM: only `UninstallString`, valid legacy path | Recover directory and run the same per-machine checks/removal |
| HKLM: only `UninstallString`, default directory, binaries already gone | Elevated cleanup of stale keys and matching shortcuts |
| HKLM: custom directory with spaces, quoted or unquoted executable | Accept only the exact uninstaller name plus `Deckmate.exe` and `resources\app.asar` |
| HKLM: foreign filename/directory, relative/UNC path, wildcard, broken quote or insufficient custom-install evidence | Abort; preserve keys and files; repair/remove the old installation manually |
| Old app survives uninstall, or unelevated HKLM registration survives | Abort; leave registration and uninstaller available for retry |
| `/UPDATE` | Skip migration; preserve user data |

Syntax check, no build needed:

```sh
"%LOCALAPPDATA%\tauri\NSIS\makensis.exe" -INPUTCHARSET UTF8 desktop/src-tauri/windows/hooks-syntax-check.nsi
```

The check script stubs the `nsis_tauri_utils` plugin and `IsShortcutTarget` (both come from the bundler in a real build), declares the `UpdateMode` and `DeleteAppDataCheckboxState` variables the bundler's installer.nsi provides, and compiles both hooks — the install one in a plain section, the uninstall one in an `un.` section; success means they parse. Nothing runs.

By hand, on a scratch machine or VM:

1. Install the last Electron release (`Deckmate Setup 0.5.0.exe`), open a project so `%APPDATA%\Deckmate\desktop.json` gets a `recent` entry, and leave a shortcut on the desktop.
2. Run the Tauri installer. Expect: one "Deckmate" entry in Apps afterwards (publisher/version from the new install), one Start-menu shortcut, the desktop shortcut offered by the finish page (the old one removed), `%APPDATA%\Deckmate\desktop.json` intact with the recent project, and the old `%LOCALAPPDATA%\Programs\Deckmate` folder gone.
3. Variant: launch the old Deckmate before step 2 — the installer must ask to close it (Russian text on a Russian OS).
4. Variant (needs an admin VM): install the Electron release "for all users", then the Tauri installer — expect the UAC notice, and afterwards a single Apps entry.
5. Variant: delete both the old `Deckmate.exe` and `Uninstall Deckmate.exe` before step 2 — the installer must finish, with the stale entry and the old shortcuts gone.
6. Variant: make the old uninstaller fail while leaving `Deckmate.exe` behind (or delete only the uninstaller) — installation must abort with the current language's clear error, retain the old Apps entry and leave the old binary untouched; a retry must remain possible.
7. Variant: uninstall Deckmate with the "delete app data" checkbox checked — `%APPDATA%\Deckmate` is removed; unchecked, or a silent `/S` uninstall — it survives, and an in-app update keeps it too.
8. On the admin VM, export the old HKLM keys for rollback, delete only `InstallLocation`, and leave `UninstallString`. Repeat with a normal install and with both old executables deleted in the default directory. Run the new installer elevated: expect one Apps entry, matching old shortcuts removed and `desktop.json` unchanged. Without elevation, declining UAC or leaving an undeletable registration must stop installation, not create a second entry.
9. Repeat the `UninstallString`-only case in a custom directory containing spaces and the Electron markers, with both quoted and unquoted executable paths and trailing `/allusers` arguments. Expect removal through the same validated directory. Replace the command with a harmless foreign executable, a wrong basename, a directory without markers, a relative/UNC path, a wildcard or a missing closing quote: installation must abort, the foreign executable must never run, and registration/files/settings must remain intact. A fully stripped custom directory without identifying markers deliberately needs manual repair/removal rather than guessed cleanup.
