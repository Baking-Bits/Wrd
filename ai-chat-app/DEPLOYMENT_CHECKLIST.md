# Unraid Deployment Checklist

## Pre-Deployment Checklist

### ✅ Prerequisites
- [ ] Unraid server accessible via SSH
- [ ] Docker installed and running on Unraid
- [ ] MariaDB server running at 192.168.1.206:3306
- [ ] LocalAI running at 192.168.1.206:8082
- [ ] Automatic1111 running at 192.168.1.206:7860
- [ ] Database `ChatterRave` exists
- [ ] Database user `ChatterRaveUser` created with permissions
- [ ] Port 3000 available on Unraid (or choose different port)

### ✅ Information Gathering
- [ ] MariaDB password for `ChatterRaveUser`: ________________
- [ ] JWT Secret generated: ________________
  ```bash
  # Generate with:
  openssl rand -base64 48
  ```
- [ ] Unraid server IP: ________________
- [ ] SSH credentials for Unraid: ________________

### ✅ Files Ready
- [ ] Project files in `b:\Wrd\ai-chat-app`
- [ ] Dockerfile reviewed
- [ ] docker-compose.yml reviewed
- [ ] .env.example reviewed
- [ ] Deployment method chosen (circle one):
  - Build on Windows + Transfer
  - Build on Unraid
  - Docker Compose
  - Unraid Template

## Deployment Steps

### Method 1: Build on Windows + Transfer

#### On Windows Machine
- [ ] Docker Desktop running
- [ ] Navigate to project: `cd b:\Wrd\ai-chat-app`
- [ ] Build image: `docker build -t ai-chat-app:latest .`
- [ ] Save image: `docker save -o ai-chat-app.tar ai-chat-app:latest`
- [ ] Transfer `ai-chat-app.tar` to Unraid (WinSCP/FileZilla)
  - Destination: `/mnt/user/appdata/ai-chat-app.tar`

#### On Unraid Server
- [ ] SSH into Unraid: `ssh root@YOUR_UNRAID_IP`
- [ ] Load image: `docker load -i /mnt/user/appdata/ai-chat-app.tar`
- [ ] Verify image: `docker images | grep ai-chat-app`
- [ ] Deploy container (fill in passwords!):
  ```bash
  docker run -d \
    --name ai-chat-app \
    --restart unless-stopped \
    -p 3000:3000 \
    -e NODE_ENV=production \
    -e DB_HOST=192.168.1.206 \
    -e DB_PORT=3306 \
    -e DB_USER=ChatterRaveUser \
    -e DB_PASSWORD="YOUR_DB_PASSWORD" \
    -e DB_NAME=ChatterRave \
    -e JWT_SECRET="YOUR_JWT_SECRET" \
    -e LOCALAI_URL=http://192.168.1.206:8082 \
    -e AUTOMATIC1111_URL=http://192.168.1.206:7860 \
    ai-chat-app:latest
  ```

### Method 2: Build on Unraid

- [ ] Transfer entire project folder to Unraid
  - Destination: `/mnt/user/appdata/ai-chat-app/`
- [ ] SSH into Unraid
- [ ] Navigate: `cd /mnt/user/appdata/ai-chat-app`
- [ ] Build: `docker build -t ai-chat-app:latest .`
- [ ] Deploy with docker run command (see Method 1)

### Method 3: Docker Compose

- [ ] Transfer project folder to Unraid
- [ ] Edit `docker-compose.yml` with your passwords
- [ ] Navigate: `cd /mnt/user/appdata/ai-chat-app`
- [ ] Deploy: `docker-compose up -d`
- [ ] Check logs: `docker-compose logs -f`

### Method 4: Unraid Template

- [ ] Copy `unraid-template.xml` to `/boot/config/plugins/dockerMan/templates-user/`
- [ ] Open Unraid Web UI
- [ ] Go to Docker tab
- [ ] Click "Add Container"
- [ ] Select "AI-Chat-App" template
- [ ] Fill in all required fields (especially passwords)
- [ ] Click "Apply"

## Post-Deployment Verification

### ✅ Container Health
- [ ] Container is running: `docker ps | grep ai-chat-app`
- [ ] Container status shows "Up"
- [ ] No restart loops (check uptime)

### ✅ Logs Check
- [ ] View logs: `docker logs ai-chat-app --tail 50`
- [ ] Look for these messages:
  - [ ] `✅ Connected to MariaDB database: ChatterRave`
  - [ ] `✅ Database tables ready`
  - [ ] `🚀 Server running on http://0.0.0.0:3000`
- [ ] No error messages visible

### ✅ Health Endpoint
- [ ] Test from Unraid: `curl http://localhost:3000/health`
- [ ] Expected response:
  ```json
  {
    "status": "healthy",
    "timestamp": "...",
    "version": "1.0.0",
    "mode": "hybrid"
  }
  ```

### ✅ Database Connectivity
- [ ] Logs show successful MariaDB connection
- [ ] No database connection errors
- [ ] Test query from Unraid:
  ```bash
  mysql -h 192.168.1.206 -u ChatterRaveUser -p ChatterRave
  ```

### ✅ Web Interface
- [ ] Open browser: `http://YOUR_UNRAID_IP:3000`
- [ ] Page loads successfully
- [ ] No JavaScript errors in browser console (F12)
- [ ] Can see login/register interface

### ✅ Authentication
- [ ] Register new account works
- [ ] Login with new account works
- [ ] JWT token received (check browser dev tools → Application → Storage)
- [ ] Session persists after page refresh

### ✅ AI Services
- [ ] LocalAI accessible from container
- [ ] Automatic1111 accessible from container
- [ ] Test message generation works
- [ ] Test image generation works

## Optional Enhancements

### ✅ Reverse Proxy Setup
- [ ] Nginx Proxy Manager installed
- [ ] SSL certificate obtained (Let's Encrypt)
- [ ] Proxy host configured
- [ ] HTTPS access works

### ✅ Cloudflare Tunnel (Most Secure)
- [ ] Cloudflare Tunnel installed on Unraid
- [ ] Tunnel configured for localhost:3000
- [ ] Public URL accessible
- [ ] No ports exposed to internet

### ✅ Monitoring
- [ ] Set up container auto-restart
- [ ] Configure Unraid notifications
- [ ] Set up uptime monitoring (optional)

## Troubleshooting Checklist

### If Container Won't Start
- [ ] Check logs: `docker logs ai-chat-app --tail 100`
- [ ] Verify port 3000 available: `netstat -tulpn | grep 3000`
- [ ] Check environment variables: `docker inspect ai-chat-app | grep -A 20 Env`
- [ ] Verify image exists: `docker images | grep ai-chat-app`

### If Database Connection Fails
- [ ] Ping MariaDB host: `ping 192.168.1.206`
- [ ] Test MariaDB connection manually
- [ ] Verify credentials are correct
- [ ] Check MariaDB allows remote connections
- [ ] Verify firewall rules

### If AI Services Unreachable
- [ ] Test LocalAI: `curl http://192.168.1.206:8082/v1/models`
- [ ] Test A1111: `curl http://192.168.1.206:7860/sdapi/v1/sd-models`
- [ ] Check if services are running
- [ ] Try host network mode: `--network=host`

### If Web Interface Won't Load
- [ ] Check container logs for errors
- [ ] Verify port mapping: `docker port ai-chat-app`
- [ ] Test from Unraid: `curl http://localhost:3000`
- [ ] Check browser console for errors
- [ ] Clear browser cache

## Maintenance Checklist

### Daily
- [ ] Monitor container status
- [ ] Check for errors in logs

### Weekly
- [ ] Review disk space usage
- [ ] Check database size
- [ ] Review container logs for warnings

### Monthly
- [ ] Update Docker image
- [ ] Review security settings
- [ ] Backup configuration

## Rollback Plan

### If Deployment Fails
1. [ ] Stop container: `docker stop ai-chat-app`
2. [ ] Remove container: `docker rm ai-chat-app`
3. [ ] Check logs: `docker logs ai-chat-app`
4. [ ] Fix issue
5. [ ] Redeploy

### Complete Removal
```bash
# Stop and remove container
docker stop ai-chat-app
docker rm ai-chat-app

# Remove image
docker rmi ai-chat-app:latest

# Remove project files
rm -rf /mnt/user/appdata/ai-chat-app
```

## Success Criteria

### Deployment Successful When:
- ✅ Container running without restarts
- ✅ Web interface accessible
- ✅ User can register and login
- ✅ AI chat functionality works
- ✅ Image generation works
- ✅ No errors in logs
- ✅ Health check passes
- ✅ All features functional

---

## Notes

Document any issues or customizations here:

_____________________________________________
_____________________________________________
_____________________________________________
_____________________________________________

## Deployment Date

**Deployed by:** ________________  
**Date/Time:** ________________  
**Unraid IP:** ________________  
**Container Port:** ________________  
**Status:** ⬜ Success  ⬜ Issues (documented above)
