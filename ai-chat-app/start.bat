@echo off
echo ========================================
echo   Starting AI Chat Application
echo ========================================
echo.

cd /d "%~dp0backend"

echo [1/2] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [2/2] Starting server...
echo.
echo Server will start at: http://192.168.1.208:3000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

node simple-server.js

pause
