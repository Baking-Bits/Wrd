# Setup SSH Keys for Docker Management
# This script generates SSH keys if they don't exist

$sshDir = Join-Path $PSScriptRoot ".ssh"
$privateKey = Join-Path $sshDir "unraid_key"
$publicKey = Join-Path $sshDir "unraid_key.pub"

Write-Host "🔐 Checking SSH keys for Docker management..." -ForegroundColor Cyan

# Create .ssh directory if it doesn't exist
if (-not (Test-Path $sshDir)) {
    Write-Host "📁 Creating .ssh directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $sshDir | Out-Null
}

# Check if keys already exist
if (Test-Path $privateKey) {
    Write-Host "✅ SSH keys already exist:" -ForegroundColor Green
    Write-Host "   Private: $privateKey" -ForegroundColor Gray
    Write-Host "   Public: $publicKey" -ForegroundColor Gray
    
    # Show public key for easy copying
    if (Test-Path $publicKey) {
        Write-Host "`n📋 Public key content (copy to Unraid):" -ForegroundColor Cyan
        Write-Host "=" * 80 -ForegroundColor Gray
        Get-Content $publicKey
        Write-Host "=" * 80 -ForegroundColor Gray
    }
    
    Write-Host "`n💡 To add this key to Unraid:" -ForegroundColor Yellow
    Write-Host "   1. Copy the public key above" -ForegroundColor Gray
    Write-Host "   2. SSH into Unraid: ssh root@192.168.1.206" -ForegroundColor Gray
    Write-Host "   3. Run: echo 'PASTE_PUBLIC_KEY_HERE' >> ~/.ssh/authorized_keys" -ForegroundColor Gray
    Write-Host "   4. Set permissions: chmod 600 ~/.ssh/authorized_keys" -ForegroundColor Gray
    
    exit 0
}

# Generate new SSH key pair
Write-Host "🔑 Generating new SSH key pair..." -ForegroundColor Yellow

# Check if ssh-keygen is available
$sshKeygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue

if (-not $sshKeygen) {
    Write-Host "❌ ERROR: ssh-keygen not found!" -ForegroundColor Red
    Write-Host "   Please install OpenSSH or Git for Windows which includes ssh-keygen" -ForegroundColor Yellow
    Write-Host "   Download: https://git-scm.com/downloads" -ForegroundColor Gray
    exit 1
}

# Generate the key
& ssh-keygen -t rsa -b 4096 -f $privateKey -N '""' -C "ai-chat-app-docker-management"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ SSH keys generated successfully!" -ForegroundColor Green
    Write-Host "   Private: $privateKey" -ForegroundColor Gray
    Write-Host "   Public: $publicKey" -ForegroundColor Gray
    
    # Set proper permissions (Windows)
    icacls $privateKey /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
    
    # Show public key
    Write-Host "`n📋 Public key content (copy to Unraid):" -ForegroundColor Cyan
    Write-Host "=" * 80 -ForegroundColor Gray
    Get-Content $publicKey
    Write-Host "=" * 80 -ForegroundColor Gray
    
    Write-Host "`n📝 Next steps:" -ForegroundColor Yellow
    Write-Host "   1. Copy the public key above" -ForegroundColor Gray
    Write-Host "   2. SSH into Unraid: ssh root@192.168.1.206" -ForegroundColor Gray
    Write-Host "   3. Run: echo 'PASTE_PUBLIC_KEY_HERE' >> ~/.ssh/authorized_keys" -ForegroundColor Gray
    Write-Host "   4. Set permissions: chmod 600 ~/.ssh/authorized_keys" -ForegroundColor Gray
    Write-Host "   5. Test connection: ssh -i $privateKey root@192.168.1.206" -ForegroundColor Gray
    
    Write-Host "`n✅ Setup complete!" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to generate SSH keys" -ForegroundColor Red
    exit 1
}
