@echo off
chcp 65001 >nul
REM ============================================
REM  NoteApp 桌面版启动脚本 (Electron)
REM  Author: huobing
REM  功能: 首次运行自动安装依赖，然后独立启动桌面程序
REM        用 start 把 Electron 脱离本控制台启动，关闭 cmd 不影响程序
REM ============================================
setlocal
cd /d "%~dp0"

REM 检测 node_modules 是否存在，不存在则安装依赖
if not exist node_modules (
  echo [NoteApp] 首次运行，正在安装依赖（Electron 较大，请耐心等待）...
  call npm install
  if errorlevel 1 (
    echo [NoteApp] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [NoteApp] 正在启动桌面程序...

REM 校验 Electron 主程序是否存在
set "APP_DIR=%~dp0"
if not exist "%APP_DIR%node_modules\electron\dist\electron.exe" (
  echo [NoteApp] 未找到 Electron 程序，请先执行 npm install。
  pause
  exit /b 1
)

REM 独立启动 Electron（GUI 进程，不依附控制台；本 cmd 随即退出）
start "" /d "%APP_DIR%" "%APP_DIR%node_modules\electron\dist\electron.exe" .
endlocal