; Standalone syntax check for installer-hooks.nsh — 2026-11-09.
;
; Compile with the NSIS that Tauri downloads, without building the app:
;   "%LOCALAPPDATA%\tauri\NSIS\makensis.exe" hooks-syntax-check.nsi
;
; The bundler's installer.nsi normally surrounds the hook with defines and
; macros; this script provides the same environment: INSTALLMODE, the
; IsShortcutTarget macro from the bundler's utils.nsh, and stubs for the
; nsis_tauri_utils plugin calls (that plugin is only added to a real bundle
; build through !addplugindir). Compiling proves the hook parses; nothing is
; executed, installed or uninstalled.
OutFile "$%TEMP%\deckmate-hooks-syntax-check.exe"

!define INSTALLMODE "currentUser"

!include "MUI2.nsh"
!include "FileFunc.nsh"

; the bundler's installer.nsi declares these: UpdateMode is set to 1 for /UPDATE
; runs, DeleteAppDataCheckboxState by the uninstaller's "delete app data"
; checkbox page (installer.nsi 451-486, 521-523, 815-818 in tauri-bundler 2.10.4)
Var UpdateMode
Var DeleteAppDataCheckboxState

; stubs for pieces the bundler's installer.nsi provides around the hook
!macro IsShortcutTarget shortcut target
  Push 0
!macroend

!macro DECKMATE_OLD_FIND_PROCESS RESULT
  StrCpy ${RESULT} 1
!macroend

!macro DECKMATE_OLD_KILL_PROCESS RESULT
  StrCpy ${RESULT} 2
!macroend

!include "installer-hooks.nsh"

Section
  !insertmacro NSIS_HOOK_PREINSTALL
SectionEnd

; the bundler's installer.nsi inserts the post-uninstall hook at the end of its
; Uninstall section; compiling it here proves the uninstall-only code parses too
Section un.Hooks
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Russian"
