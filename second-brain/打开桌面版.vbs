' ============================================
' 第二脑 桌面版 无窗口启动器
' Author: huobing
' 功能: 以隐藏窗口运行 start-desktop.bat，不弹出 cmd；
'       Electron 由 bat 用 start 独立启动，关闭本窗口不影响程序
' ============================================
Option Explicit
Dim fso, ws, base
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
Set ws = CreateObject("WScript.Shell")
' 窗口样式 0 = 隐藏窗口；第 3 参数 False = 不等 bat 结束立即返回
ws.Run """" & base & "\start-desktop.bat""", 0, False