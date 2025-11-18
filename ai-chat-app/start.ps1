# AI Chat App - Quick Start Script (PowerShell)
# This script helps you get the application running quickly on Windows

param(
    [Parameter(Position=0)]
    [ValidateSet("dev", "prod", "stop", "logs", "reset")]
    [string]$Action
)

Write-Host "🚀 AI Chat App - Quick Start" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green

# Check if Docker is available
try {
    docker --version | Out-Null
} catch {
    Write-Host "❌ Docker is not installed. Please install Docker Desktop first." -ForegroundColor Red
    exit 1
}

try {
    docker-compose --version | Out-Null
} catch {
    Write-Host "❌ Docker Compose is not installed. Please install Docker Desktop with Compose." -ForegroundColor Red
    exit 1
}

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "📝 Creating .env file from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "⚠️  Please edit .env file with your configuration before continuing." -ForegroundColor Yellow
    Write-Host "   Minimum required: JWT_SECRET, OPENAI_API_KEY" -ForegroundColor Yellow
    Read-Host "Press Enter after editing .env file"
}

# Function to start development environment
function Start-Dev {
    Write-Host "🔧 Starting development environment..." -ForegroundColor Blue
    
    # Install Node.js dependencies
    if (-not (Test-Path "node_modules")) {
        Write-Host "📦 Installing Node.js dependencies..." -ForegroundColor Yellow
        npm install
    }
    
    # Start Docker services
    Write-Host "🐳 Starting PostgreSQL and Redis..." -ForegroundColor Blue
    docker-compose up -d postgres redis
    
    # Wait for services to be ready
    Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    # Run database migrations
    Write-Host "🗄️  Setting up database..." -ForegroundColor Blue
    try {
        npm run migrate 2>$null
    } catch {
        Write-Host "Note: Migrations may need to be implemented" -ForegroundColor Yellow
    }
    
    # Start the application
    Write-Host "🌟 Starting the application..." -ForegroundColor Green
    Write-Host "   Frontend (localStorage mode): Open frontend/index.html in browser" -ForegroundColor Cyan
    Write-Host "   Backend API: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "   To start backend: npm run dev" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "✅ Development environment ready!" -ForegroundColor Green
}

# Function to start production environment
function Start-Prod {
    Write-Host "🚀 Starting production environment..." -ForegroundColor Blue
    
    # Check if production .env exists
    if (-not (Test-Path ".env.production")) {
        Write-Host "📝 Creating production .env file from template..." -ForegroundColor Yellow
        Copy-Item ".env.production" ".env"
    }
    
    # Build and start production stack
    Write-Host "🏗️  Building and starting production stack..." -ForegroundColor Blue
    docker-compose -f docker-compose.prod.yml up --build -d
    
    # Wait for services
    Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
    Start-Sleep -Seconds 20
    
    # Check health
    Write-Host "🔍 Checking service health..." -ForegroundColor Blue
    docker-compose -f docker-compose.prod.yml ps
    
    Write-Host "✅ Production environment started!" -ForegroundColor Green
    Write-Host "   Application available at: http://localhost" -ForegroundColor Cyan
    Write-Host "   View logs with: docker-compose -f docker-compose.prod.yml logs -f" -ForegroundColor Cyan
}

# Function to stop all services
function Stop-Services {
    Write-Host "🛑 Stopping all services..." -ForegroundColor Yellow
    try { docker-compose down 2>$null } catch {}
    try { docker-compose -f docker-compose.prod.yml down 2>$null } catch {}
    Write-Host "✅ All services stopped." -ForegroundColor Green
}

# Function to show logs
function Show-Logs {
    Write-Host "📋 Showing application logs..." -ForegroundColor Blue
    $devRunning = docker-compose ps | Select-String "ai-chat-app"
    $prodRunning = docker-compose -f docker-compose.prod.yml ps | Select-String "ai-chat"
    
    if ($devRunning) {
        docker-compose logs -f
    } elseif ($prodRunning) {
        docker-compose -f docker-compose.prod.yml logs -f
    } else {
        Write-Host "No running containers found." -ForegroundColor Yellow
    }
}

# Function to reset development environment
function Reset-Dev {
    Write-Host "🔄 Resetting development environment..." -ForegroundColor Yellow
    Stop-Services
    try { docker volume rm ai-chat-app_postgres_data 2>$null } catch {}
    try { docker volume rm ai-chat-app_redis_data 2>$null } catch {}
    Write-Host "✅ Development environment reset." -ForegroundColor Green
}

# Main menu
function Show-Menu {
    Write-Host ""
    Write-Host "Please choose an option:" -ForegroundColor Cyan
    Write-Host "1) Start development environment" -ForegroundColor White
    Write-Host "2) Start production environment" -ForegroundColor White
    Write-Host "3) Stop all services" -ForegroundColor White
    Write-Host "4) Show logs" -ForegroundColor White
    Write-Host "5) Reset development environment" -ForegroundColor White
    Write-Host "6) Exit" -ForegroundColor White
    Write-Host ""
}

# Handle command line parameters
switch ($Action) {
    "dev" {
        Start-Dev
        exit 0
    }
    "prod" {
        Start-Prod
        exit 0
    }
    "stop" {
        Stop-Services
        exit 0
    }
    "logs" {
        Show-Logs
        exit 0
    }
    "reset" {
        Reset-Dev
        exit 0
    }
}

# Interactive menu if no parameters provided
do {
    Show-Menu
    $choice = Read-Host "Enter your choice (1-6)"
    
    switch ($choice) {
        "1" {
            Start-Dev
            break
        }
        "2" {
            Start-Prod
            break
        }
        "3" {
            Stop-Services
            break
        }
        "4" {
            Show-Logs
            break
        }
        "5" {
            Reset-Dev
        }
        "6" {
            Write-Host "👋 Goodbye!" -ForegroundColor Green
            break
        }
        default {
            Write-Host "❌ Invalid option. Please choose 1-6." -ForegroundColor Red
        }
    }
} while ($choice -ne "6")