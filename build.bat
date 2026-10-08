@echo off
chcp 65001 >nul
REM 打包脚本：Electron 应用 Windows NSIS 安装包
REM 作者: huobing
REM ========== 使用说明 ==========
REM 必须【管理员身份】运行（winCodeSign 解压 darwin 符号链接需 SeCreateSymbolicLinkPrivilege）
REM 产物位置: second-brain\dist\ 下的 .exe 安装包
REM =============================

setlocal

cd /d "%~dp0second-brain"

echo ============================================================
echo   第二脑 · Electron NSIS 打包
echo   工作目录: %cd%
echo ============================================================

REM --- 前置检查 ---
if not exist package.json (
    echo [错误] second-brain 目录下未找到 package.json
    pause & exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未安装 Node.js
    pause & exit /b 1
)

if not exist node_modules (
    echo [信息] 首次打包，正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] npm install 失败
        pause & exit /b 1
    )
)

REM --- 设置国内镜像加速（用户 profile 经验）---
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

REM --- 清理旧产物 ---
if exist dist (
    echo [信息] 清理旧产物 dist\
    rmdir /s /q dist
)

REM --- 执行打包 ---
echo [信息] 开始打包...
echo   Electron 镜像: %ELECTRON_MIRROR%
echo   Builder镜像:   %ELECTRON_BUILDER_BINARIES_MIRROR%
echo ------------------------------------------------------------
call npm run dist
set EXITCODE=%errorlevel%

REM --- 结果 ---
echo ------------------------------------------------------------
if %EXITCODE% equ 0 (
    echo [成功] 打包完成！
    echo 产物列表:
    for %%f in (dist\*.exe) do echo   %%~nxf  ^(%%~zf bytes^)
) else (
    echo [失败] 打包退出码: %EXITCODE%
    echo 常见原因:
    echo   1. 非管理员运行（winCodeSign 解压符号链接失败）→ 用管理员身份重跑
    echo   2. 网络问题（Electron 二进制下载慢/超时）       → 确认已设 npmmirror 镜像
    echo   3. node_modules 不完整                          → 先 npm install
)

pause
exit /b %EXITCODE%
endlocal
