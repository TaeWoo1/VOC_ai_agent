' Launch start-agent.ps1 HIDDEN — no console window flashes for the seller.
' Auto-start (the Startup-folder shortcut) points wscript.exe at this file.
Option Explicit
Dim shell, here, ps1
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
ps1 = here & "\start-agent.ps1"
' -WindowStyle Hidden + the "0, False" args to Run keep it fully background.
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
