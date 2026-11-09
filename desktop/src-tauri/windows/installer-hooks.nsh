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
; state, plus the cache index) always survives: the old uninstaller deletes it
; only when passed --delete-app-data (uninstaller.nsh 216-248) and this hook
; never passes it.

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
LangString DeckmateOldManualRemove 1033 "The older Deckmate installation for all users could not be removed automatically. Remove it later in Windows Settings under Installed apps, then start Deckmate again."
LangString DeckmateOldManualRemove 1049 "Старую установку Deckmate для всех пользователей не удалось удалить автоматически. Удалите её позже в разделе «Установленные приложения» в параметрах Windows и снова запустите Deckmate."

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

    ${If} ${FileExists} "$R9\${DECKMATE_OLD_UNINSTALLER}"
      DetailPrint "$(DeckmateOldRemoving) $R9"
      ; /S /currentuser select the old assisted uninstaller's silent per-user
      ; mode (assistedInstaller.nsh initMultiUser:122-133, uninstaller.nsh
      ; 12-16). _? runs it in place so ExecWait really waits; the uninstaller
      ; then cannot delete its own exe, which the next two lines take care of.
      ; No --delete-app-data: %APPDATA%\Deckmate survives (uninstaller.nsh
      ; 216-248).
      ExecWait '"$R9\${DECKMATE_OLD_UNINSTALLER}" /S /currentuser _?=$R9' $R6
      Delete "$R9\${DECKMATE_OLD_UNINSTALLER}"
      RMDir "$R9"
    ${EndIf}

    ReadRegStr $0 HKCU "${DECKMATE_OLD_UNINSTALL_KEY}" "UninstallString"
    ReadRegStr $1 HKCU "${DECKMATE_OLD_INSTALL_KEY}" "InstallLocation"
    ${If} $0 != ""
    ${OrIf} $1 != ""
      ; The uninstaller is missing or failed — remove only the stale
      ; registration and the shortcuts into the old folder, then continue.
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
      Delete "$R9\${DECKMATE_OLD_UNINSTALLER}"
      RMDir "$R9"
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
!macro DECKMATE_OLD_REPLACE_PER_MACHINE
  ReadRegStr $R9 HKLM "${DECKMATE_OLD_INSTALL_KEY}" "InstallLocation"
  ${If} $R9 != ""
    UserInfo::GetAccountType
    Pop $0
    ${If} $0 == "Admin"
      !insertmacro DECKMATE_OLD_CLOSE_APP

      ${If} ${FileExists} "$R9\${DECKMATE_OLD_UNINSTALLER}"
        DetailPrint "$(DeckmateOldRemoving) $R9"
        ExecWait '"$R9\${DECKMATE_OLD_UNINSTALLER}" /S /allusers _?=$R9' $R6
        Delete "$R9\${DECKMATE_OLD_UNINSTALLER}"
        RMDir "$R9"
      ${EndIf}

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
      ExecWait '"$R9\${DECKMATE_OLD_UNINSTALLER}" /S /allusers _?=$R9' $R6
      ; without elevation these two usually fail; they are harmless then and
      ; finish the job for an admin who re-runs the installer later
      Delete "$R9\${DECKMATE_OLD_UNINSTALLER}"
      RMDir "$R9"
      ReadRegStr $0 HKLM "${DECKMATE_OLD_UNINSTALL_KEY}" "UninstallString"
      ${If} $0 != ""
      ${AndIfNot} ${Silent}
        MessageBox MB_OK|MB_ICONINFORMATION "$(DeckmateOldManualRemove)"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Tauri calls this from its Install section before copying files, writing
; registry keys and creating shortcuts, so when Tauri registers Deckmate the
; old registration is already gone. Uses $0-$2 and $R6-$R9; Tauri's section
; code sets its own registers again after the hook.
!macro NSIS_HOOK_PREINSTALL
  !insertmacro DECKMATE_OLD_REPLACE_PER_USER
  !insertmacro DECKMATE_OLD_REPLACE_PER_MACHINE
!macroend
