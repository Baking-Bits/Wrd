@echo off
title Private AI Chat Server
color 0A
echo.
echo   ███████████████████████████████████████
echo   █                                     █
echo   █     🤖 PRIVATE AI CHAT 🤖          █
echo   █      Smart Port Management          █
echo   █                                     █
echo   ███████████████████████████████████████
echo.
echo 🔧 Initializing server with automatic port cleanup...
echo ⚡ This will kill any conflicting processes automatically
echo.

python --version >nul 2>&1
if %errorlevel% == 0 (
    echo ✅ Python detected, starting server...
    echo.
    python run_chat.py
    echo.
    echo 👋 Server stopped. Press any key to exit...
    pause >nul
) else (
    echo ❌ Error: Python is required to run the server.
    echo Please install Python 3.x from https://python.org
    echo.
    pause
)