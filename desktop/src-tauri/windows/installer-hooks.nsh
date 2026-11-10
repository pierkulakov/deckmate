; NSIS installer hooks for the Deckmate Tauri 2 installer — 2026-11-09.
;
; Why this file exists: until 0.5.0 Deckmate Desktop shipped as an Electron app
; built by electron-builder 26.18.1 (desktop/package.json "build"). Its NSIS
; installer registered the app under a GUID key and put "Deckmate" shortcuts in
; the user's shell folders; the Tauri installer registers "Deckmate" under its
; own key (Software\Microsoft\Windows\CurrentVersion\Uninstall\Deckmate). On a
; machine that upgrades from Electron both would show up: two entries in Apps,
; two identical shortcuts. This hook runs in NSIS_HOOK_PREINSTALL, before Tauri
; writes any file, registry key or shortcut, and removes only the old Electron
; registration (tauri-bundler installer.nsi inserts it at the top of the Install
; section). %APPDATA%\Deckmate (desktop.json with recent projects and window
; state, plus the cache index) always survives an install or an update: the old
; uninstaller deletes it only when passed --delete-app-data (uninstaller.nsh
; 216-248) and this hook never passes it. NSIS_HOOK_POSTUNINSTALL below is the
; one place the folder can go: an explicit "delete app data" uninstall.

!define DECKMATE_OLD_APP_ID "com.deckmate.desktop"
; electron-builder computes the NSIS GUID as UUIDv5(appId,
; 50e065bc-3134-11e6-9bab-38c9862bdaf3) — app-builder-lib out/targets/nsis/
; NsisTarget.js:49 and :261-267; the v5 hash is SHA1, lowercase hex
; (builder-util-runtime out/uuid.js:37-39,123-170). For com.deckmate.desktop:
; 19b52c93-6424-5c44-a3b2-47e082c1e19e — verified with node, see README.md.
!define DECKMATE_OLD_GUID "19b52c93-6424-5c44-a3b2-47e082c1e19e"
; Where the old installer wrote its state (multiUser.nsh:8-9): the Uninstall
; key and the install key. The backslash-free GUID means UNINSTALL_APP_KEY
; equals APP_GUID, so electron-builder wrote no second key (NsisTarget.js:280).
!define DECKMATE_OLD_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DECKMATE_OLD_GUID}"
!define DECKMATE_OLD_INSTALL_KEY "Software\${DECKMATE_OLD_GUID}"
; File names of the old install (common.nsh:16-17 with productName "Deckmate").
!define DECKMATE_OLD_APP_EXE "Deckmate.exe"
!define DECKMATE_OLD_UNINSTALLER "Uninstall Deckmate.exe"
!define DECKMATE_OLD_NAME "Deckmate"
; electron-builder's assisted per-user default is %LOCALAPPDATA%\Programs\Deckmate
; (multiUser.nsh:30,47 — APP_FILENAME is the product name for oneClick:false,
; NsisTarget.js:270). Used only when the registration survives without a path.
!define DECKMATE_OLD_DEFAULT_DIR "$LOCALAPPDATA\Programs\Deckmate"

; User-visible installer texts, English (1033) and Russian (1049) under the
; same keys. NSIS resolves $(name) for the language the installer UI runs in:
; the OS language among the languages built in, the selector choice when
; nsis.displayLanguageSelector is true, or the language MUI remembered in
; HKCU\Software\<manufacturer>\Deckmate. A language without a definition falls
; back to the first loaded language, so nsis.languages must list English first.
LangString DeckmateOldRemoving 1033 "Removing the previous Deckmate (Electron) installation:"
LangString DeckmateOldRemoving 1049 "Удаление предыдущей установки Deckmate (Electron):"
LangString DeckmateOldRunning 1033 "Deckmate is running. Click OK to close it and continue, or Cancel to stop the installation."
LangString DeckmateOldRunning 1049 "Deckmate запущен. Нажмите «OK», чтобы закрыть его и продолжить, или «Отмена», чтобы остановить установку."
LangString DeckmateOldKillFailed 1033 "Could not close the running Deckmate process. Close it manually and run the installer again."
LangString DeckmateOldKillFailed 1049 "Не удалось закрыть запущенный процесс Deckmate. Закройте его вручную и запустите установщик снова."
LangString DeckmateOldAdminNotice 1033 "An older Deckmate installation for all users was found. Windows will now ask for permission to remove it. Your projects and settings are not affected."
LangString DeckmateOldAdminNotice 1049 "Найдена старая установка Deckmate для всех пользователей. Windows запросит разрешение на её удаление. Ваши проекты и настройки не затрагиваются."
LangString DeckmateOldUninstallFailed 1033 "The previous Deckmate installation could not be removed completely. The new installation has stopped and the old uninstall entry has been kept. Close Deckmate, then run this installer again. If the problem persists, repair or remove the old installation from Windows Settings first."
LangString DeckmateOldUninstallFailed 1049 "Не удалось полностью удалить предыдущую установку Deckmate. Новая установка остановлена, а старая запись об удалении сохранена. Закройте Deckmate и снова запустите этот установщик. Если ошибка повторится, сначала восстановите или удалите старую установку через параметры Windows."
LangString DeckmateOldExitCode 1033 "Exit code:"
LangString DeckmateOldExitCode 1049 "Код выхода:"
LangString DeckmateOldUninstallerExited 1033 "The previous Deckmate uninstaller finished with an error."
LangString DeckmateOldUninstallerExited 1049 "Предыдущий деинсталлятор Deckmate завершился с ошибкой."

; The Tauri build provides the nsis_tauri_utils plugin through !addplugindir,
; which the bundler's installer.nsi registers after !including this file. The
; plugin is only *called* from macro bodies expanded in the Install section,
; where the directory is already registered. The !ifmacrondef seams exist so
; the standalone syntax check (hooks-syntax-check.nsi) can stub the plugin.
!ifmacrondef DECKMATE_OLD_FIND_PROCESS
!macro DECKMATE_OLD_FIND_PROCESS RESULT
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "${DECKMATE_OLD_APP_EXE}"
  !else
    nsis_tauri_utils::FindProcess "${DECKMATE_OLD_APP_EXE}"
  !endif
  Pop ${RESULT}
!macroend
!endif

!ifmacrondef DECKMATE_OLD_KILL_PROCESS
!macro DECKMATE_OLD_KILL_PROCESS RESULT
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "${DECKMATE_OLD_APP_EXE}"
  !else
    nsis_tauri_utils::KillProcess "${DECKMATE_OLD_APP_EXE}"
  !endif
  Pop ${RESULT}
!macroend
!endif

; Closes a running old Deckmate.exe the way the Tauri installer closes its own
; app (CheckIfAppIsRunning in the bundler's utils.nsh): ask first, kill
; directly when silent, abort when the process will not die. Old and new app
; share the file name, so the check runs only while an old install exists.
; Kill codes: 0 killed, 2 already gone — anything else is a failure.
!macro DECKMATE_OLD_CLOSE_APP
  !insertmacro DECKMATE_OLD_FIND_PROCESS $0
  ${If} $0 = 0
    ${IfNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(DeckmateOldRunning)" IDOK +2
        Abort "$(DeckmateOldRunning)"
    ${EndIf}
    !insertmacro DECKMATE_OLD_KILL_PROCESS $0
    Sleep 500
    ${If} $0 <> 0
    ${AndIf} $0 <> 2
      Abort "$(DeckmateOldKillFailed)"
    ${EndIf}
  ${EndIf}
!macroend

; A stale registration has no executable left and is safe to clean up. A real
; installation whose executable survives the old uninstaller is not: keep its
; registry entry and stop before Tauri writes anything, so the user can retry.
; Callers delete the in-place uninstaller and its empty folder only after this
; check, leaving both a retry and removal from Windows Settings possible.
; $R6 is the old uninstaller's exit code (zero also when it was already absent).
!macro DECKMATE_OLD_ABORT_UNINSTALL
  DetailPrint "$(DeckmateOldUninstallFailed) $(DeckmateOldExitCode) $R6"
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONSTOP "$(DeckmateOldUninstallFailed)"
  ${EndIf}
  Abort "$(DeckmateOldUninstallFailed)"
!macroend

!macro DECKMATE_OLD_CHECK_UNINSTALL
  ${If} $R6 <> 0
    DetailPrint "$(DeckmateOldUninstallerExited) $(DeckmateOldExitCode) $R6"
  ${EndIf}
  ${If} ${FileExists} "$R9\${DECKMATE_OLD_APP_EXE}"
    !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
  ${EndIf}
!macroend

; Deletes the shortcuts the old installer created — $DESKTOP\<name>.lnk and
; $SMPROGRAMS\[dir\]<name>.lnk (common.nsh setLinkVars:84-108; name and dir are
; the ShortcutName/MenuDirectory values of the old install key, default
; "Deckmate" and none) — but only when the shortcut really points into the old
; install folder, so a same-named shortcut of something else survives. Expects
; $R8 = shortcut name and $R7 = menu subdirectory ("" when none) from the
; caller; runs in the shell context of the install being removed.
!macro DECKMATE_OLD_REMOVE_SHORTCUTS OLD_TARGET
  ${If} $R7 == ""
    StrCpy $R6 "$SMPROGRAMS\$R8.lnk"
  ${Else}
    StrCpy $R6 "$SMPROGRAMS\$R7\$R8.lnk"
  ${EndIf}

  !insertmacro IsShortcutTarget "$DESKTOP\$R8.lnk" "${OLD_TARGET}"
  Pop $0
  ${If} $0 = 1
    Delete "$DESKTOP\$R8.lnk"
  ${EndIf}

  !insertmacro IsShortcutTarget "$R6" "${OLD_TARGET}"
  Pop $0
  ${If} $0 = 1
    Delete "$R6"
    ${If} $R7 != ""
      RMDir "$SMPROGRAMS\$R7"
    ${EndIf}
  ${EndIf}
!macroend

; Replaces a per-user Electron install — the electron-builder default. Detection
; accepts either of the two keys the old installer wrote, so a half-removed
; install is cleaned up too.
!macro DECKMATE_OLD_REPLACE_PER_USER
  ReadRegStr $R9 HKCU "${DECKMATE_OLD_INSTALL_KEY}" "InstallLocation"
  ReadRegStr $0 HKCU "${DECKMATE_OLD_UNINSTALL_KEY}" "UninstallString"
  ${If} $R9 != ""
  ${OrIf} $0 != ""
    ${If} $R9 == ""
      StrCpy $R9 "${DECKMATE_OLD_DEFAULT_DIR}"
    ${EndIf}

    !insertmacro DECKMATE_OLD_CLOSE_APP

    StrCpy $R6 0
    ${If} ${FileExists} "$R9\${DECKMATE_OLD_UNINSTALLER}"
      DetailPrint "$(DeckmateOldRemoving) $R9"
      ; /S /currentuser select the old assisted uninstaller's silent per-user
      ; mode (assistedInstaller.nsh initMultiUser:122-133, uninstaller.nsh
      ; 12-16). _? runs it in place so ExecWait really waits; the uninstaller
      ; then cannot delete its own exe, which is cleaned up after the check.
      ; No --delete-app-data: %APPDATA%\Deckmate survives (uninstaller.nsh
      ; 216-248).
      ExecWait '"$R9\${DECKMATE_OLD_UNINSTALLER}" /S /currentuser _?=$R9' $R6
    ${EndIf}
    !insertmacro DECKMATE_OLD_CHECK_UNINSTALL
    Delete "$R9\${DECKMATE_OLD_UNINSTALLER}"
    RMDir "$R9"

    ReadRegStr $0 HKCU "${DECKMATE_OLD_UNINSTALL_KEY}" "UninstallString"
    ReadRegStr $1 HKCU "${DECKMATE_OLD_INSTALL_KEY}" "InstallLocation"
    ${If} $0 != ""
    ${OrIf} $1 != ""
      ; No old executable remains, so this is only a stale registration.
      ; Remove it and shortcuts into the old folder, then continue.
      ; Never user data: nothing under %APPDATA% is touched, and RMDir only
      ; takes an already-empty folder.
      StrCpy $R8 "${DECKMATE_OLD_NAME}"
      ReadRegStr $R2 HKCU "${DECKMATE_OLD_INSTALL_KEY}" "ShortcutName"
      ${If} $R2 != ""
        StrCpy $R8 $R2
      ${EndIf}
      StrCpy $R7 ""
      ReadRegStr $R2 HKCU "${DECKMATE_OLD_INSTALL_KEY}" "MenuDirectory"
      ${If} $R2 != ""
        StrCpy $R7 $R2
      ${EndIf}
      DeleteRegKey HKCU "${DECKMATE_OLD_UNINSTALL_KEY}"
      DeleteRegKey HKCU "${DECKMATE_OLD_INSTALL_KEY}"
      !insertmacro DECKMATE_OLD_REMOVE_SHORTCUTS "$R9\${DECKMATE_OLD_APP_EXE}"
    ${EndIf}
  ${EndIf}
!macroend

; Replaces a per-machine Electron install, which exists when the user picked
; "all users" in the old assisted installer; removing it needs elevation. In
; the admin branch the old uninstaller with /S /allusers runs in place and
; synchronously. Without elevation it elevates itself through UAC
; (multiUser.nsh setInstallModePerAllUsers:62-71), so the user is told before
; Windows pops the consent dialog, and a declined or failed removal ends in a
; clear message instead of a silent second entry.
; 2026-11-10: a surviving uninstall key may be the only location left. Never execute
; its command line: extract one executable and require the legacy name and layout.
!macro DECKMATE_OLD_MACHINE_DIRECTORY_FROM_UNINSTALL
  StrCpy $R2 ""
  StrCpy $1 0
  StrCpy $2 $0 1
  ${If} $2 == '$\"'
    StrCpy $1 1
  ${EndIf}
  ${Do}
    StrCpy $R9 $0 1 $1
    ${If} $R9 == ""
      ${If} $2 == '$\"'
        !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
      ${EndIf}
      ${ExitDo}
    ${EndIf}
    ${If} $2 == '$\"'
    ${AndIf} $R9 == '$\"'
      ${ExitDo}
    ${EndIf}
    ${If} $R9 == "*"
    ${OrIf} $R9 == "?"
    ${OrIf} $R9 == '$\"'
      !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
    ${EndIf}
    StrCpy $R2 "$R2$R9"
    IntOp $1 $1 + 1
    ${If} $2 != '$\"'
      StrCpy $R9 $R2 4 -4
      ${If} $R9 == ".exe"
        StrCpy $R9 $0 1 $1
        ${If} $R9 == ""
        ${OrIf} $R9 == " "
          ${ExitDo}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${Loop}
  ${GetFileName} "$R2" $R9
  ${If} $R9 != "${DECKMATE_OLD_UNINSTALLER}"
    !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
  ${EndIf}
  ; 2026-11-10: relative/network paths must not resolve against the installer's cwd
  ; or run an elevated executable from an untrusted network share.
  StrCpy $R9 $R2 2 1
  ${If} $R9 != ":\"
    !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
  ${EndIf}
  ${GetParent} "$R2" $R9
  ClearErrors
  GetFullPathName $R9 "$R9"
  ${If} ${Errors}
    !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
  ${EndIf}
  ${If} $R9 != "$PROGRAMFILES64\Deckmate"
  ${AndIf} $R9 != "$PROGRAMFILES32\Deckmate"
    ${IfNot} ${FileExists} "$R9\${DECKMATE_OLD_APP_EXE}"
      !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
    ${EndIf}
    ${IfNot} ${FileExists} "$R9\resources\app.asar"
      !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
    ${EndIf}
  ${EndIf}
!macroend

!macro DECKMATE_OLD_REPLACE_PER_MACHINE
  ReadRegStr $R9 HKLM "${DECKMATE_OLD_INSTALL_KEY}" "InstallLocation"
  ReadRegStr $0 HKLM "${DECKMATE_OLD_UNINSTALL_KEY}" "UninstallString"
  ${If} $R9 != ""
  ${OrIf} $0 != ""
    ${If} $R9 == ""
      StrCpy $R6 0
      !insertmacro DECKMATE_OLD_MACHINE_DIRECTORY_FROM_UNINSTALL
    ${EndIf}
    UserInfo::GetAccountType
    Pop $0
    ${If} $0 == "Admin"
      !insertmacro DECKMATE_OLD_CLOSE_APP

      StrCpy $R6 0
      ${If} ${FileExists} "$R9\${DECKMATE_OLD_UNINSTALLER}"
        DetailPrint "$(DeckmateOldRemoving) $R9"
        ExecWait '"$R9\${DECKMATE_OLD_UNINSTALLER}" /S /allusers _?=$R9' $R6
      ${EndIf}
      !insertmacro DECKMATE_OLD_CHECK_UNINSTALL
      Delete "$R9\${DECKMATE_OLD_UNINSTALLER}"
      RMDir "$R9"

      ReadRegStr $0 HKLM "${DECKMATE_OLD_UNINSTALL_KEY}" "UninstallString"
      ReadRegStr $1 HKLM "${DECKMATE_OLD_INSTALL_KEY}" "InstallLocation"
      ${If} $0 != ""
      ${OrIf} $1 != ""
        StrCpy $R8 "${DECKMATE_OLD_NAME}"
        ReadRegStr $R2 HKLM "${DECKMATE_OLD_INSTALL_KEY}" "ShortcutName"
        ${If} $R2 != ""
          StrCpy $R8 $R2
        ${EndIf}
        StrCpy $R7 ""
        ReadRegStr $R2 HKLM "${DECKMATE_OLD_INSTALL_KEY}" "MenuDirectory"
        ${If} $R2 != ""
          StrCpy $R7 $R2
        ${EndIf}
        DeleteRegKey HKLM "${DECKMATE_OLD_UNINSTALL_KEY}"
        DeleteRegKey HKLM "${DECKMATE_OLD_INSTALL_KEY}"
        ; The old per-machine shortcuts live in the all-users shell folders;
        ; switch there and restore the context of this install mode so Tauri
        ; keeps creating its own shortcuts where it intended to.
        SetShellVarContext all
        !insertmacro DECKMATE_OLD_REMOVE_SHORTCUTS "$R9\${DECKMATE_OLD_APP_EXE}"
        !if "${INSTALLMODE}" == "perMachine"
          SetShellVarContext all
        !else if "${INSTALLMODE}" == "both"
          ${If} $MultiUser.InstallMode == "AllUsers"
            SetShellVarContext all
          ${Else}
            SetShellVarContext current
          ${EndIf}
        !else
          SetShellVarContext current
        !endif
      ${EndIf}
    ${Else}
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONINFORMATION "$(DeckmateOldAdminNotice)"
      ${EndIf}
      StrCpy $R6 0
      ExecWait '"$R9\${DECKMATE_OLD_UNINSTALLER}" /S /allusers _?=$R9' $R6
      !insertmacro DECKMATE_OLD_CHECK_UNINSTALL
      ; A declined elevation or a failed elevated uninstall leaves the old
      ; registration. Never hide that by installing a second Deckmate entry.
      ReadRegStr $0 HKLM "${DECKMATE_OLD_UNINSTALL_KEY}" "UninstallString"
      ${If} $0 != ""
        !insertmacro DECKMATE_OLD_ABORT_UNINSTALL
      ${EndIf}
      Delete "$R9\${DECKMATE_OLD_UNINSTALLER}"
      RMDir "$R9"
    ${EndIf}
  ${EndIf}
!macroend

; Tauri calls this from its Install section before copying files, writing
; registry keys and creating shortcuts, so when Tauri registers Deckmate the
; old registration is already gone. Uses $0-$2 and $R6-$R9; Tauri's section
; code sets its own registers again after the hook.
!macro NSIS_HOOK_PREINSTALL
  ; 2026-11-09: an over-the-air update (/UPDATE, set by the bundler's installer.nsi before this section runs)
  ; only replaces an existing Tauri install, whose first installation already removed Electron. Running the
  ; per-machine branch again would show its notice and a UAC prompt on every update where an all-users
  ; Electron install was left behind after a declined prompt.
  ${If} $UpdateMode <> 1
    !insertmacro DECKMATE_OLD_REPLACE_PER_USER
    !insertmacro DECKMATE_OLD_REPLACE_PER_MACHINE
  ${EndIf}
!macroend

; Tauri calls this at the end of its Uninstall section, after its own removal
; work (installer.nsi 931-933, tauri-bundler 2.10.4 — the bundler inside
; @tauri-apps/cli 2.12.4). The bundler's built-in "delete app data" branch
; removes %APPDATA%\<identifier> and %LOCALAPPDATA%\<identifier>
; (installer.nsi 915-929), which for this app are
; %APPDATA%\com.deckmate.desktop and %LOCALAPPDATA%\com.deckmate.desktop. The
; LOCALAPPDATA one holds the WebView2 profile (EBWebView, the board's
; localStorage), but the settings, server.log and the index live in
; %APPDATA%\Deckmate, the Electron-era userData folder kept so an upgrade
; carries them over. The checkbox alone would therefore leave the real data
; folder behind, so this hook clears it under the same guards the built-in
; branch uses (installer.nsi 915-916): the checkbox must be checked (a silent or passive
; uninstall never checks it, exactly like the built-in branch), and the run
; must not be an update — the installer invokes the previous uninstaller with
; /UPDATE on some replace paths (installer.nsi 374), and an update must keep
; the settings it upgrades. SetShellVarContext current mirrors the built-in
; branch (installer.nsi 926): the roaming profile of the uninstalling user,
; never the all-users ProgramData, whatever INSTALLMODE this build uses.
; Nothing outside %APPDATA%\Deckmate is removed; project folders live where
; the user put them and are never touched.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$APPDATA\Deckmate"
  ${EndIf}
!macroend
