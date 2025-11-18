# Docker Setup for Unraid

## Prerequisites
- Unraid server with Docker enabled
- MariaDB already running (192.168.1.206:3306)
- LocalAI running (192.168.1.206:8082)
- Automatic1111 running (192.168.1.206:7860)

## Build the Docker Image

### Option 1: Build on Your Windows Machine
```powershell
# Navigate to project root
cd b:\Wrd\ai-chat-app

# Build the image
docker build -t ai-chat-app:latest .

# Save the image to a tar file
docker save -o ai-chat-app.tar ai-chat-app:latest

# Transfer ai-chat-app.tar to your Unraid server
# Use WinSCP, FileZilla, or Unraid's web interface
```

### Option 2: Build Directly on Unraid
```bash
# SSH into Unraid
# Copy project files to /mnt/user/appdata/ai-chat-app/
# Then build:
cd /mnt/user/appdata/ai-chat-app
docker build -t ai-chat-app:latest .
```

## Deploy on Unraid

### Method 1: Using Docker Compose (Recommended)
1. Install "Compose Manager" plugin from Community Applications
2. Create a new stack in Compose Manager
3. Paste the contents of `docker-compose.yml`
4. **Update environment variables** (passwords, JWT secret)
5. Click "Compose Up"

### Method 2: Using Unraid Docker Template
1. Copy `unraid-template.xml` to `/boot/config/plugins/dockerMan/templates-user/`
2. Go to Unraid Docker tab
3. Click "Add Container"
4. Select "AI-Chat-App" from the template dropdown
5. Fill in required fields:
   - **Database Password**: Your ChatterRaveUser password
   - **JWT Secret**: Generate a secure random string (e.g., 64 characters)
6. Click "Apply"

### Method 3: Manual Docker Run
```bash
docker run -d \
  --name ai-chat-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -e DB_HOST=192.168.1.206 \
  -e DB_PORT=3306 \
  -e DB_USER=ChatterRaveUser \
  -e DB_PASSWORD=your_password_here \
  -e DB_NAME=ChatterRave \
  -e JWT_SECRET=your_secure_jwt_secret_here \
  -e LOCALAI_URL=http://192.168.1.206:8082 \
  -e AUTOMATIC1111_URL=http://192.168.1.206:7860 \
  ai-chat-app:latest
```

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Node.js environment | `production` |
| `PORT` | Internal container port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `DB_HOST` | MariaDB server IP | `192.168.1.206` |
| `DB_PORT` | MariaDB port | `3306` |
| `DB_USER` | Database user | `ChatterRaveUser` |
| `DB_PASSWORD` | Database password | `your_password` |
| `DB_NAME` | Database name | `ChatterRave` |
| `JWT_SECRET` | JWT signing key | `random_64_char_string` |
| `LOCALAI_URL` | LocalAI endpoint | `http://192.168.1.206:8082` |
| `AUTOMATIC1111_URL` | A1111 endpoint | `http://192.168.1.206:7860` |

## Generate JWT Secret
```powershell
# On Windows (PowerShell)
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))

# Or use this online (save the output):
# node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## Verify Deployment
1. Access the app: `http://YOUR_UNRAID_IP:3000`
2. Check logs: `docker logs ai-chat-app`
3. Health check: `http://YOUR_UNRAID_IP:3000/health`

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs ai-chat-app

# Verify environment variables
docker inspect ai-chat-app | grep -A 20 Env
```

### Database connection fails
- Verify MariaDB is accessible from Unraid: `ping 192.168.1.206`
- Test MariaDB connection: `mysql -h 192.168.1.206 -u ChatterRaveUser -p ChatterRave`
- Check if MariaDB allows connections from Unraid IP

### AI services unreachable
- Verify LocalAI: `curl http://192.168.1.206:8082/v1/models`
- Verify A1111: `curl http://192.168.1.206:7860/sdapi/v1/sd-models`
- Ensure services are on same network or host network mode

## Network Considerations

If AI services are on the same Unraid server:
- Use host network mode: `--network=host` in docker run
- Or use Unraid's custom bridge network (`br0`)
- Update URLs to `http://localhost:8082` and `http://localhost:7860`

## Reverse Proxy (Nginx Proxy Manager)
```nginx
# Proxy configuration for external access
location / {
    proxy_pass http://192.168.1.x:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Updates
```bash
# Stop container
docker stop ai-chat-app

# Remove old container
docker rm ai-chat-app

# Pull/build new image
docker build -t ai-chat-app:latest .

# Start new container (use same docker run command)
```

## Backup
- Database: Already backed up via MariaDB
- Container config: Save docker-compose.yml or docker run command
- No persistent volumes needed (stateless app)
