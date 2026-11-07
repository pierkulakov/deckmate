Option Explicit
Dim shell, filesystem, script
Set shell = CreateObject("WScript.Shell")
Set filesystem = CreateObject("Scripting.FileSystemObject")
script = filesystem.BuildPath(filesystem.GetParentFolderName(WScript.ScriptFullName), "launch.ps1")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & script & """", 0, False
