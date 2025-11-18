# PowerShell Setup script for AI Chat App with Docker
# Run with: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

Write-Host "🚀 Setting up AI Chat App with Docker..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Check if Docker is installed
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker found: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not installed or not in PATH" -ForegroundColor Red
    Write-Host "   Please install Docker Desktop for Windows first." -ForegroundColor Yellow
    Write-Host "   Visit: https://docs.docker.com/desktop/windows/install/" -ForegroundColor Yellow
    exit 1
}

# Check if Docker Compose is installed
try {
    $composeVersion = docker-compose --version
    Write-Host "✅ Docker Compose found: $composeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker Compose is not installed or not in PATH" -ForegroundColor Red
    Write-Host "   Docker Compose should be included with Docker Desktop." -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Create .env file if it doesn't exist
if (-not (Test-Path ".env")) {
    Write-Host "📝 Creating .env file from template..." -ForegroundColor Cyan
    Copy-Item ".env.example" ".env"
    
    # Generate secure passwords and secrets
    Add-Type -AssemblyName System.Security
    
    function Generate-SecureString($length) {
        $chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        $random = New-Object System.Random
        $result = ""
        for ($i = 0; $i -lt $length; $i++) {
            $result += $chars[$random.Next($chars.Length)]
        }
        return $result
    }
    
    $dbPassword = Generate-SecureString 32
    $redisPassword = Generate-SecureString 32
    $jwtSecret = Generate-SecureString 64
    
    # Update .env file with generated secrets
    $envContent = Get-Content ".env" -Raw
    $envContent = $envContent -replace "your_secure_db_password_here", $dbPassword
    $envContent = $envContent -replace "your_secure_redis_password_here", $redisPassword
    $envContent = $envContent -replace "your_jwt_secret_key_minimum_32_characters_long", $jwtSecret
    Set-Content ".env" $envContent
    
    Write-Host "🔐 Generated secure passwords and secrets" -ForegroundColor Green
} else {
    Write-Host "✅ .env file already exists" -ForegroundColor Green
}

# Create necessary directories
Write-Host "📁 Creating directories..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "backend\src\uploads" | Out-Null
New-Item -ItemType Directory -Force -Path "database\backups" | Out-Null
New-Item -ItemType Directory -Force -Path "docker\nginx\conf.d" | Out-Null

# Install backend dependencies
Write-Host "📦 Installing backend dependencies..." -ForegroundColor Cyan
Set-Location backend
try {
    npm install
    Write-Host "✅ Backend dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Failed to install backend dependencies" -ForegroundColor Yellow
    Write-Host "   Make sure Node.js and npm are installed" -ForegroundColor Yellow
}
Set-Location ..

# Build Docker images
Write-Host "🔧 Building Docker images..." -ForegroundColor Cyan
docker-compose build

# Start database and Redis first
Write-Host "🗄️  Starting database and Redis..." -ForegroundColor Cyan
docker-compose up -d database redis

# Wait for database to be ready
Write-Host "⏳ Waiting for database to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# Start all services
Write-Host "🚀 Starting all services..." -ForegroundColor Cyan
docker-compose up -d

Write-Host ""
Write-Host "🎉 Setup complete! AI Chat App is now running." -ForegroundColor Green
Write-Host ""
Write-Host "📋 Service Status:" -ForegroundColor Cyan
Write-Host "   🌐 Web Application: http://localhost (via nginx)"
Write-Host "   🗄️  Database: localhost:5432"
Write-Host "   🔴 Redis: localhost:6379"
Write-Host "   💬 LocalAI: localhost:8082"
Write-Host "   🎨 Automatic1111: localhost:7860"
Write-Host "   🔧 ComfyUI: localhost:8188"
Write-Host ""
Write-Host "🔧 Management Commands:" -ForegroundColor Cyan
Write-Host "   📊 View logs: docker-compose logs -f"
Write-Host "   🛑 Stop services: docker-compose down"
Write-Host "   🔄 Restart: docker-compose restart"
Write-Host "   🗑️  Clean up: docker-compose down -v"
Write-Host ""
Write-Host "🔐 Admin Account:" -ForegroundColor Yellow
Write-Host "   📧 Email: admin@localhost"
Write-Host "   🔑 Password: admin123 (CHANGE THIS!)"
Write-Host ""
Write-Host "💡 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Open http://localhost in your browser"
Write-Host "   2. Log in with the admin account"
Write-Host "   3. Change the admin password in settings"
Write-Host "   4. Create your first personality"
Write-Host "   5. Start chatting with AI!"
Write-Host ""
Write-Host "📚 Documentation: docs\CONTAINERIZATION_PLAN.md" -ForegroundColor Cyan

# Check service status
Write-Host ""
Write-Host "🔍 Checking service status..." -ForegroundColor Cyan
$services = docker-compose ps --services
foreach ($service in $services) {
    $status = docker-compose ps $service --format "table {{.State}}" | Select-Object -Skip 1
    if ($status -eq "running" -or $status -match "Up") {
        Write-Host "   ✅ $service" -ForegroundColor Green
    } else {
        Write-Host "   ❌ $service ($status)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "🚀 All done! Your AI Chat App should now be accessible at http://localhost" -ForegroundColor Green