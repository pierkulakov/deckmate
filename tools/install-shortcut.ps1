$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path $projectRoot 'Deckmate.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'launch.vbs') + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Deckmate - local file workspace'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output $shortcutPath
