@echo off
title OpenHamClock Rig Bridge

:: Read version from package.json
set "RB_VERSION=?"
for /f "usebackq delims=" %%V in (`node -e "try{process.stdout.write(require('./package.json').version)}catch(e){process.stdout.write('?')}" 2^>nul`) do set "RB_VERSION=%%V"

:: Read port and TLS setting from config
set "RB_PORT=5555"
set "RB_PROTO=http"
set "RB_CFG=%APPDATA%\openhamclock\rig-bridge-config.json"
if not exist "%RB_CFG%" set "RB_CFG=%USERPROFILE%\openhamclock-rig-bridge\rig-bridge-config.json"
if exist "%RB_CFG%" (
    for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try{(Get-Content '%RB_CFG%'|ConvertFrom-Json).port}catch{5555}"`) do set "RB_PORT=%%P"
    for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "try{if((Get-Content '%RB_CFG%'|ConvertFrom-Json).tls.enabled){'https'}else{'http'}}catch{'http'}"`) do set "RB_PROTO=%%T"
)

echo.
echo   OpenHamClock Rig Bridge v%RB_VERSION%
echo   Setup UI: %RB_PROTO%://localhost:%RB_PORT%
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
    start %RB_PROTO%://localhost:%RB_PORT%
    node rig-bridge.js
) else (
    echo   ERROR: Node.js not found.
    echo   Download from https://nodejs.org or use the standalone .exe version.
    echo.
    pause
)
