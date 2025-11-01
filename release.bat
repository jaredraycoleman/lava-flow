@echo off
REM Lava Flow Release Script for Windows
REM This is a wrapper that calls the bash script using Git Bash

setlocal enabledelayedexpansion

REM Check if Git Bash is installed
where bash >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Git Bash not found!
    echo Please install Git for Windows from: https://git-scm.com/download/win
    echo Or run the release.sh script directly in Git Bash
    pause
    exit /b 1
)

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Convert Windows path to Unix-style path for Git Bash
set "UNIX_PATH=%SCRIPT_DIR:\=/%"
set "UNIX_PATH=%UNIX_PATH:~0,-1%"

REM Run the bash script
bash -c "cd '%UNIX_PATH%' && ./release.sh"

pause
