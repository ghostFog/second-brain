@echo off
rem ============================================
rem NoteApp 本地启动脚本
rem 作者: 火 冰
rem 用法: 双击运行，或命令行执行 start-server.bat
rem ============================================
setlocal
cd /d "%~dp0"

rem 优先使用本机 python，其次 python3，其次 conda 完整路径
set PY=python
where python >nul 2>nul || set PY="D:\Tools\miniconda3\python.exe"

echo 启动 NoteApp 本地服务器: http://127.0.0.1:8000
echo 按 Ctrl+C 停止...
%PY% -m http.server 8000
endlocal