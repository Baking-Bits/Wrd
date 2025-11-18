# Simple startup script for AI Chat App
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Starting AI Chat Application" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to backend directory
Set-Location "$PSScriptRoot\backend"

# Check Node.js
Write-Host "[1/2] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js $nodeVersion detected" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Node.js not found" -ForegroundColor Red
    Write-Host "Install from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Start server
Write-Host "[2/2] Starting server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Server will start at: http://192.168.1.208:3000" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

node simple-server.js
