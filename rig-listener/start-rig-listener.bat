@echo off
title OpenHamClock Rig Listener
echo.
echo  ======================================
echo   OpenHamClock Rig Listener
echo  ======================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  Download it from: https://nodejs.org
    echo  (Get the LTS version)
    echo.
    echo  After installing Node.js, run this file again.
    echo.
    pause
    exit /b 1
)

:: Show Node version
for /f "tokens=*" %%i in ('node -v') do echo  Node.js %%i detected

:: Change to script directory
cd /d "%~dp0"

:: Install dependencies if needed
if not exist "node_modules\serialport" (
    echo.
    echo  Installing dependencies (first time only)...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] npm install failed. Check the errors above.
        echo.
        pause
        exit /b 1
    )
    echo.
)

:: Run the listener
echo.
node rig-listener.js %*

:: Keep window open if it exits
echo.
pause
