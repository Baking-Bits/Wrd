# Quick Start Guide - Unraid Deployment

## Prerequisites Checklist

✅ Unraid server with Docker support  
✅ MariaDB running (192.168.1.206:3306)  
✅ LocalAI running (192.168.1.206:8082)  
✅ Automatic1111 running (192.168.1.206:7860)  
✅ Database `ChatterRave` created with user `ChatterRaveUser`

## Deployment Options

### Option 1: Quick Deploy with PowerShell (Recommended)

```powershell
# 1. Build and save Docker image
cd b:\Wrd\ai-chat-app
.\deploy.ps1

# 2. Transfer ai-chat-app.tar to Unraid
# Use WinSCP, FileZilla, or Unraid web interface

# 3. SSH into Unraid and load image
docker load -i /mnt/user/appdata/ai-chat-app.tar

# 4. Run container (update passwords!)
docker run -d \
  --name ai-chat-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DB_PASSWORD="YOUR_DB_PASSWORD" \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e NODE_ENV=production \
  -e DB_HOST=192.168.1.206 \
  -e DB_PORT=3306 \
  -e DB_USER=ChatterRaveUser \
  -e DB_NAME=ChatterRave \
  -e LOCALAI_URL=http://192.168.1.206:8082 \
  -e AUTOMATIC1111_URL=http://192.168.1.206:7860 \
  ai-chat-app:latest
```

### Option 2: Build on Unraid Directly

```bash
# 1. SSH into Unraid
ssh root@YOUR_UNRAID_IP

# 2. Create app directory
mkdir -p /mnt/user/appdata/ai-chat-app
cd /mnt/user/appdata/ai-chat-app

# 3. Copy project files to this directory (via WinSCP or similar)

# 4. Build image
docker build -t ai-chat-app:latest .

# 5. Run container
docker run -d \
  --name ai-chat-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DB_PASSWORD="YOUR_DB_PASSWORD" \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e NODE_ENV=production \
  -e DB_HOST=192.168.1.206 \
  -e DB_PORT=3306 \
  -e DB_USER=ChatterRaveUser \
  -e DB_NAME=ChatterRave \
  -e LOCALAI_URL=http://192.168.1.206:8082 \
  -e AUTOMATIC1111_URL=http://192.168.1.206:7860 \
  ai-chat-app:latest
```

### Option 3: Using Docker Compose

```bash
# 1. Edit docker-compose.yml and update passwords
nano docker-compose.yml

# 2. Start with compose
docker-compose up -d

# 3. View logs
docker-compose logs -f
```

### Option 4: Unraid Docker Template

1. Copy `unraid-template.xml` to `/boot/config/plugins/dockerMan/templates-user/`
2. Go to Unraid Web UI → Docker tab
3. Click "Add Container" → Select "AI-Chat-App"
4. Fill in passwords and click "Apply"

## Generate JWT Secret

```bash
# On Unraid or Linux
openssl rand -base64 48

# On Windows PowerShell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Verify Deployment

1. **Check container status:**
   ```bash
   docker ps | grep ai-chat-app
   ```

2. **View logs:**
   ```bash
   docker logs ai-chat-app
   ```

3. **Health check:**
   ```bash
   curl http://YOUR_UNRAID_IP:3000/health
   ```

4. **Access web interface:**
   - Navigate to: `http://YOUR_UNRAID_IP:3000`

## Troubleshooting

### Container won't start

```bash
# Check detailed logs
docker logs ai-chat-app --tail 100

# Inspect container
docker inspect ai-chat-app
```

### Database connection fails

```bash
# Test MariaDB connection from Unraid
mysql -h 192.168.1.206 -u ChatterRaveUser -p ChatterRave

# Check if port is accessible
telnet 192.168.1.206 3306
```

### AI services unreachable

```bash
# Test LocalAI
curl http://192.168.1.206:8082/v1/models

# Test Automatic1111
curl http://192.168.1.206:7860/sdapi/v1/sd-models

# If both are on same host, use host networking:
docker run --network=host ...
```

### Clear and restart

```bash
# Stop and remove container
docker stop ai-chat-app && docker rm ai-chat-app

# Remove image (optional)
docker rmi ai-chat-app:latest

# Rebuild and restart
docker build -t ai-chat-app:latest .
docker run -d ... (use command from above)
```

## Network Configuration

### If AI services are on the same Unraid server:

Use host network mode:
```bash
docker run -d \
  --name ai-chat-app \
  --restart unless-stopped \
  --network=host \
  -e LOCALAI_URL=http://localhost:8082 \
  -e AUTOMATIC1111_URL=http://localhost:7860 \
  ... other options ...
  ai-chat-app:latest
```

### For external access (reverse proxy):

Use Nginx Proxy Manager or similar:
```nginx
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

## Updates

```bash
# Stop container
docker stop ai-chat-app

# Remove container
docker rm ai-chat-app

# Rebuild image (if building on Unraid)
docker build -t ai-chat-app:latest .

# Or load new image (if built on Windows)
docker load -i /path/to/ai-chat-app.tar

# Start new container with same command
docker run -d --name ai-chat-app ... (same command as initial deploy)
```

## Backup

- **Database**: Already backed up via MariaDB backups
- **Container config**: Save your `docker run` command or `docker-compose.yml`
- **No persistent volumes needed** - app is stateless

## Support

Check logs for errors:
```bash
docker logs ai-chat-app --tail 200 -f
```

Common log messages:
- `✅ Connected to MariaDB database: ChatterRave` - Database OK
- `🚀 Server running on http://0.0.0.0:3000` - Server started
- `❌ Database connection failed` - Check DB credentials
