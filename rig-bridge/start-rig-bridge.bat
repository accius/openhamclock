@echo off
title OpenHamClock Rig Bridge
echo.
echo   Starting OpenHamClock Rig Bridge...
echo   Setup UI will open at http://localhost:5555
echo.
echo   Press Ctrl+C to stop.
echo.

:: Check if node is available
where node >nul 2>nul
if %errorlevel%==0 (
    cd /d "%~dp0"
    if not exist node_modules (
        echo   Installing dependencies...
        call npm install
        echo.
    )
    start http://localhost:5555
    node rig-bridge.js
) else (
    echo   ERROR: Node.js not found.
    echo   Download from https://nodejs.org or use the standalone .exe version.
    echo.
    pause
)
