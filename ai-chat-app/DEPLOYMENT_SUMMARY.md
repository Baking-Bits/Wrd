# Unraid Docker Deployment - Complete Summary

## 📋 What We Created

### Docker Files
1. **Dockerfile** - Production-ready Node.js Alpine container
2. **docker-compose.yml** - Simplified deployment with compose
3. **.dockerignore** - Excludes unnecessary files from image
4. **unraid-template.xml** - Native Unraid Docker template
5. **.env.example** - Environment variable reference

### Deployment Scripts
1. **deploy.ps1** - Windows PowerShell build and transfer script
2. **deploy.sh** - Linux/Unraid deployment script

### Documentation
1. **DOCKER_SETUP.md** - Comprehensive Docker setup guide
2. **QUICKSTART.md** - Quick deployment instructions

## 🚀 Deployment Steps

### Method 1: Build on Windows, Transfer to Unraid (Recommended)

```powershell
# On Windows
cd b:\Wrd\ai-chat-app
docker build -t ai-chat-app:latest .
docker save -o ai-chat-app.tar ai-chat-app:latest

# Transfer ai-chat-app.tar to Unraid via:
# - WinSCP/FileZilla to /mnt/user/appdata/
# - Unraid web interface file manager
# - Direct copy if shared folder

# On Unraid (SSH)
docker load -i /mnt/user/appdata/ai-chat-app.tar

# Deploy (replace YOUR_PASSWORD and YOUR_SECRET)
docker run -d \
  --name ai-chat-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DB_HOST=192.168.1.206 \
  -e DB_PORT=3306 \
  -e DB_USER=ChatterRaveUser \
  -e DB_PASSWORD="YOUR_PASSWORD" \
  -e DB_NAME=ChatterRave \
  -e JWT_SECRET="YOUR_SECRET" \
  -e LOCALAI_URL=http://192.168.1.206:8082 \
  -e AUTOMATIC1111_URL=http://192.168.1.206:7860 \
  ai-chat-app:latest
```

### Method 2: Copy Project, Build on Unraid

```bash
# 1. Copy entire project folder to Unraid
# Transfer to: /mnt/user/appdata/ai-chat-app/

# 2. SSH into Unraid
cd /mnt/user/appdata/ai-chat-app

# 3. Build image
docker build -t ai-chat-app:latest .

# 4. Deploy (same docker run command as above)
```

### Method 3: Use Docker Compose

```bash
# 1. Edit docker-compose.yml with your passwords
# 2. Deploy
cd /mnt/user/appdata/ai-chat-app
docker-compose up -d

# 3. View logs
docker-compose logs -f
```

### Method 4: Unraid Docker Template

```bash
# 1. Copy template
cp unraid-template.xml /boot/config/plugins/dockerMan/templates-user/

# 2. In Unraid Web UI:
#    - Docker tab → Add Container
#    - Template: AI-Chat-App
#    - Fill in passwords
#    - Apply
```

## 🔐 Required Configuration

### Must Change These Values!

1. **Database Password** (`DB_PASSWORD`)
   - Your MariaDB ChatterRaveUser password

2. **JWT Secret** (`JWT_SECRET`)
   - Generate with: `openssl rand -base64 48`
   - Or Windows: `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))`

### Network Configuration

Your current setup:
- MariaDB: `192.168.1.206:3306`
- LocalAI: `192.168.1.206:8082`
- Automatic1111: `192.168.1.206:7860`

If AI services are on **same Unraid server**, use:
- `--network=host` flag
- Change URLs to `http://localhost:8082` and `http://localhost:7860`

## ✅ Verification

```bash
# 1. Check container is running
docker ps | grep ai-chat-app

# 2. View logs
docker logs ai-chat-app

# 3. Health check
curl http://YOUR_UNRAID_IP:3000/health

# 4. Access web interface
# Browser: http://YOUR_UNRAID_IP:3000
```

Expected log output:
```
🗄️ Connecting to MariaDB...
✅ Connected to MariaDB database: ChatterRave
✅ Database tables ready
🚀 Server running on http://0.0.0.0:3000
```

## 📊 Container Specifications

- **Base Image**: node:20-alpine
- **Image Size**: ~250-300 MB
- **Memory Usage**: ~100-200 MB idle
- **CPU Usage**: Minimal when idle
- **Network**: Bridge (default) or Host (recommended if AI services on same server)
- **Restart Policy**: unless-stopped
- **Health Check**: Every 30s on `/health` endpoint

## 🔄 Updates & Maintenance

### Update Container

```bash
# 1. Stop and remove old container
docker stop ai-chat-app
docker rm ai-chat-app

# 2. Build/load new image
docker build -t ai-chat-app:latest .
# OR
docker load -i ai-chat-app.tar

# 3. Redeploy (same docker run command)
```

### View Logs

```bash
# Live logs
docker logs -f ai-chat-app

# Last 100 lines
docker logs ai-chat-app --tail 100

# Logs since 10 minutes ago
docker logs ai-chat-app --since 10m
```

### Backup Strategy

- **Database**: Already backed up via MariaDB
- **Config**: Save your `docker run` command or `docker-compose.yml`
- **Container**: Stateless - no data stored in container
- **Code**: Keep source code backed up

## 🐛 Troubleshooting

### Container won't start
```bash
docker logs ai-chat-app --tail 50
docker inspect ai-chat-app
```

### Database connection fails
```bash
# Test from Unraid
mysql -h 192.168.1.206 -u ChatterRaveUser -p ChatterRave

# Check network
ping 192.168.1.206
```

### AI services unreachable
```bash
# Test LocalAI
curl http://192.168.1.206:8082/v1/models

# Test Automatic1111
curl http://192.168.1.206:7860/sdapi/v1/sd-models
```

### Port already in use
```bash
# Change port in docker run command
-p 3001:3000  # Use port 3001 instead

# Or stop conflicting service
docker ps  # Find container using port 3000
docker stop <container_name>
```

## 🌐 External Access

### Via Reverse Proxy (Recommended)

Use Nginx Proxy Manager, Traefik, or Caddy:

```nginx
# Nginx example
location / {
    proxy_pass http://192.168.1.x:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Via Cloudflare Tunnel (Most Secure)

1. Install Cloudflare Tunnel on Unraid
2. Point tunnel to `http://localhost:3000`
3. No ports exposed to internet!

## 📁 File Structure

```
ai-chat-app/
├── Dockerfile              # Production container definition
├── docker-compose.yml      # Compose deployment
├── .dockerignore          # Build exclusions
├── unraid-template.xml    # Unraid template
├── .env.example           # Environment variables reference
├── deploy.ps1             # Windows deployment script
├── deploy.sh              # Linux deployment script
├── DOCKER_SETUP.md        # Detailed setup guide
├── QUICKSTART.md          # Quick start instructions
└── backend/
    ├── simple-server.js   # Main application
    ├── database.js        # Database logic
    ├── config.js          # Configuration (uses env vars)
    ├── package.json       # Dependencies
    └── public/            # Frontend files
```

## 🎯 Next Steps

1. **Choose deployment method** (Method 1 recommended)
2. **Generate JWT secret** with openssl
3. **Gather passwords** (database, SSH if using Docker manager)
4. **Build and deploy** following chosen method
5. **Verify deployment** with health check
6. **Test application** by accessing web interface
7. **Optional**: Set up reverse proxy for external access

## ⚠️ Security Notes

- ✅ HTTPS encryption in transit (if using reverse proxy with SSL)
- ❌ Messages NOT end-to-end encrypted (plain text in database)
- ✅ Passwords hashed with bcrypt (12 rounds)
- ✅ JWT authentication with 30-day sessions
- ⚠️ Keep JWT_SECRET secure and random
- ⚠️ Don't expose port 3000 directly to internet
- ✅ Use reverse proxy with SSL for external access

## 🔗 Resources

- Docker Documentation: https://docs.docker.com/
- Unraid Docker: https://wiki.unraid.net/Docker
- Nginx Proxy Manager: https://nginxproxymanager.com/
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/

---

**Ready to deploy!** Start with the Quickstart guide and choose your preferred deployment method.
