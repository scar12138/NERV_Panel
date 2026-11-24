' NERV Panel —— 无窗口启动器（供计划任务/快捷方式调用 start.bat）
' 作用：隐藏 cmd 黑窗，让面板服务在后台运行；崩溃自动重启逻辑仍由 start.bat 负责。
Option Explicit

Dim shell, fso, here, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here

cmd = "cmd.exe /c """ & here & "\start.bat"""
' 0 = 隐藏窗口，False = 不等待返回
shell.Run cmd, 0, False
