# AI Chat App - Unraid Deployment Script (PowerShell)
# Run this from your Windows machine to build and transfer to Unraid

$ErrorActionPreference = "Stop"

Write-Host "🚀 AI Chat App - Docker Deployment Script" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Configuration
$APP_NAME = "ai-chat-app"
$IMAGE_NAME = "ai-chat-app:latest"
$TAR_FILE = "ai-chat-app.tar"

# Check if running in project directory
if (!(Test-Path "Dockerfile")) {
    Write-Host "❌ Error: Dockerfile not found. Run this script from the project root." -ForegroundColor Red
    exit 1
}

# Step 1: Build Docker image
Write-Host "`n📦 Building Docker image..." -ForegroundColor Yellow
docker build -t $IMAGE_NAME .

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Docker image built successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Docker build failed" -ForegroundColor Red
    exit 1
}

# Step 2: Save image to tar file
Write-Host "`n💾 Saving Docker image to $TAR_FILE..." -ForegroundColor Yellow
docker save -o $TAR_FILE $IMAGE_NAME

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Docker image saved to $TAR_FILE" -ForegroundColor Green
    $fileSize = (Get-Item $TAR_FILE).Length / 1MB
    Write-Host "📊 File size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Cyan
} else {
    Write-Host "❌ Failed to save Docker image" -ForegroundColor Red
    exit 1
}

# Step 3: Transfer instructions
Write-Host "`n📤 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Transfer $TAR_FILE to your Unraid server" -ForegroundColor White
Write-Host "   - Option A: Use WinSCP or FileZilla" -ForegroundColor White
Write-Host "   - Option B: Use Unraid's web interface (Settings > Docker > Add Container)" -ForegroundColor White
Write-Host "   - Option C: Copy to /mnt/user/appdata/ai-chat-app/" -ForegroundColor White
Write-Host "`n2. SSH into Unraid and run:" -ForegroundColor White
Write-Host "   docker load -i /path/to/$TAR_FILE" -ForegroundColor Cyan
Write-Host "`n3. Use docker-compose.yml or the Unraid template to deploy" -ForegroundColor White

# Optional: Prompt to transfer via SCP (requires plink/pscp)
$transfer = Read-Host "`nDo you want to transfer to Unraid now via SCP? (y/n)"
if ($transfer -eq "y") {
    $unraidIP = Read-Host "Enter Unraid IP address"
    $unraidUser = Read-Host "Enter Unraid username (default: root)"
    if ([string]::IsNullOrWhiteSpace($unraidUser)) { $unraidUser = "root" }
    
    Write-Host "`n📤 Transferring $TAR_FILE to Unraid..." -ForegroundColor Yellow
    scp $TAR_FILE "${unraidUser}@${unraidIP}:/mnt/user/appdata/"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Transfer successful!" -ForegroundColor Green
        Write-Host "`nSSH into Unraid and run:" -ForegroundColor Yellow
        Write-Host "  docker load -i /mnt/user/appdata/$TAR_FILE" -ForegroundColor Cyan
        Write-Host "  docker run -d --name ai-chat-app -p 3000:3000 \" -ForegroundColor Cyan
        Write-Host "    -e DB_PASSWORD=your_password \" -ForegroundColor Cyan
        Write-Host "    -e JWT_SECRET=your_secret \" -ForegroundColor Cyan
        Write-Host "    ai-chat-app:latest" -ForegroundColor Cyan
    } else {
        Write-Host "❌ Transfer failed. Please transfer manually." -ForegroundColor Red
    }
}

Write-Host "`n✅ Build complete!" -ForegroundColor Green
