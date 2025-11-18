# Production Deployment Guide for respond2.me
# AI Chat App via Tailscale + SWAG + Docker

## Architecture Overview
```
Internet (respond2.me)
    ↓ HTTPS (443)
VPS (Tailscale exit node)
    ↓ Tailscale tunnel
Homelab Unraid (192.168.1.206)
    ↓ 
SWAG (reverse proxy)
    ↓ HTTPS → HTTP
Docker: ai-chat-app (port 3000)
```

## Prerequisites
✅ Tailscale configured between VPS and homelab
✅ SWAG container running on Unraid
✅ Domain respond2.me pointed to VPS IP
✅ SSL certificate for respond2.me (via SWAG/Let's Encrypt)

---

## Step 1: Configure SWAG Reverse Proxy

### 1.1 Copy SWAG Config
Copy `swag-respond2me.conf` to your SWAG config directory:
```bash
# On Unraid, SWAG config is typically at:
/mnt/user/appdata/swag/nginx/proxy-confs/respond2me.subdomain.conf
```

### 1.2 Restart SWAG
```bash
docker restart swag
```

### 1.3 Verify SWAG Logs
```bash
docker logs swag | grep respond2.me
```

---

## Step 2: Update Environment Variables

### 2.1 Generate JWT Secret
```bash
openssl rand -base64 48
```

### 2.2 Update .env File
Edit `b:\Wrd\ai-chat-app\.env`:
```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

# Update JWT_SECRET with the generated value
JWT_SECRET=<paste-generated-secret-here>

# Keep other settings as-is (DB, AI services, etc.)
```

---

## Step 3: Update Backend .env
Ensure backend also has the correct config:
```bash
# Copy settings to backend .env
cp b:\Wrd\ai-chat-app\.env b:\Wrd\ai-chat-app\backend\.env
```

---

## Step 4: Build and Push Docker Image

### 4.1 Wait for GitHub Actions
Your latest commit should trigger a build:
- Check: https://github.com/Baking-Bits/Wrd/actions
- Image: `ghcr.io/baking-bits/wrd:latest`

### 4.2 Or Build Locally (if needed)
```bash
cd b:\Wrd
docker build -t ghcr.io/baking-bits/wrd:latest .
docker push ghcr.io/baking-bits/wrd:latest
```

---

## Step 5: Deploy Container on Unraid

### 5.1 Stop Old Container
```bash
docker stop ai-chat-app 2>/dev/null
docker rm ai-chat-app 2>/dev/null
```

### 5.2 Pull Latest Image
```bash
docker pull ghcr.io/baking-bits/wrd:latest
```

### 5.3 Run Container
```bash
docker run -d \
  --name ai-chat-app \
  --restart unless-stopped \
  -p 3007:3000 \
  --env-file /mnt/user/BotFiles/Wrd/ai-chat-app/.env \
  -v /mnt/user/BotFiles/Wrd/ai-chat-app/.ssh:/root/.ssh:ro \
  --network swag_default \
  ghcr.io/baking-bits/wrd:latest
```

**Important:** `--network swag_default` puts the container on the same Docker network as SWAG so they can communicate.

---

## Step 6: Update CORS Configuration

Your backend needs to allow requests from respond2.me:

### 6.1 Update simple-server.js CORS
Edit `b:\Wrd\ai-chat-app\backend\simple-server.js`:

Find the CORS section and add your domain:
```javascript
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:8080',
    'http://192.168.1.208:3000',
    'http://192.168.1.208:8080',
    'https://respond2.me',           // Add this
    'http://respond2.me'             // Add this
  ],
  credentials: true
}));
```

### 6.2 Commit and Push
```bash
git add ai-chat-app/backend/simple-server.js
git commit -m "Add respond2.me to CORS origins"
git push origin main
```

Wait for GitHub Actions to rebuild, then redeploy.

---

## Step 7: Configure Tailscale (if not done)

### 7.1 On VPS (Exit Node)
```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Enable as exit node
sudo tailscale up --advertise-exit-node --accept-routes

# Approve in Tailscale admin console
```

### 7.2 On Homelab Unraid
```bash
# Install Tailscale (via Community Apps or CLI)
tailscale up --accept-routes
```

### 7.3 Route Traffic
Configure VPS nginx/caddy to forward respond2.me traffic to Tailscale IP of homelab.

---

## Step 8: Test Deployment

### 8.1 Local Test (from homelab)
```bash
curl http://localhost:3007/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-17T...",
  "version": "1.0.0"
}
```

### 8.2 SWAG Test (from homelab)
```bash
curl -k https://respond2.me/health
```

### 8.3 Public Test (from anywhere)
```bash
curl https://respond2.me/health
```

### 8.4 Browser Test
Open: https://respond2.me

You should see the login page.

---

## Step 9: Security Checklist

✅ JWT_SECRET is strong and unique (48 characters)
✅ HTTPS enabled via SWAG (Let's Encrypt)
✅ Database password is strong
✅ SSH key authentication (not password)
✅ CORS configured for respond2.me only
✅ .env files NOT in git (.gitignore)
✅ Rate limiting enabled (900 seconds, 100 requests)
✅ Docker container running as non-root user
✅ Tailscale encrypted tunnel between VPS and homelab

---

## Troubleshooting

### Container Won't Start
```bash
docker logs ai-chat-app
```

Look for:
- Database connection errors
- Missing environment variables
- Port binding issues

### SWAG Can't Reach Container
```bash
# Check if container is on SWAG network
docker network inspect swag_default

# If not, reconnect:
docker network connect swag_default ai-chat-app
docker restart ai-chat-app
```

### CORS Errors in Browser
Update CORS origins in `simple-server.js` and redeploy.

### Database Connection Issues
```bash
# Test from container
docker exec -it ai-chat-app sh
nc -zv 192.168.1.206 3306
```

---

## Monitoring

### Check Container Health
```bash
docker ps -f name=ai-chat-app
docker stats ai-chat-app
```

### View Logs
```bash
docker logs -f ai-chat-app
```

### Check Auto-Messages
Look for in logs:
```
⏰ Checking X active chats for auto-messages...
💬 Sending auto-message for chat X (idle: Ymin)
```

---

## Network Diagram

```
                                    Internet
                                       ↓
                              [respond2.me:443]
                                       ↓
                          VPS (with reverse proxy)
                                       ↓
                          Tailscale Encrypted Tunnel
                                       ↓
                     Homelab (192.168.1.206)
                                       ↓
              ┌───────────────────────────────────┐
              │  SWAG (reverse proxy)             │
              │  - SSL termination                │
              │  - HTTPS → HTTP                   │
              │  Port 443 → 3000                  │
              └───────────────────────────────────┘
                                ↓
              ┌───────────────────────────────────┐
              │  Docker: ai-chat-app              │
              │  - Node.js backend                │
              │  - Port 3000 (internal)           │
              │  - Port 3007 (host mapped)        │
              └───────────────────────────────────┘
                         ↓            ↓
         ┌───────────────┘            └──────────────┐
         ↓                                           ↓
[MariaDB:3306]                            [LocalAI/A1111:8082/7860]
192.168.1.206                             192.168.1.206
```

---

## Quick Reference Commands

```bash
# Deploy/Update
docker pull ghcr.io/baking-bits/wrd:latest
docker stop ai-chat-app && docker rm ai-chat-app
docker run -d --name ai-chat-app --restart unless-stopped -p 3007:3000 \
  --env-file /mnt/user/BotFiles/Wrd/ai-chat-app/.env \
  -v /mnt/user/BotFiles/Wrd/ai-chat-app/.ssh:/root/.ssh:ro \
  --network swag_default ghcr.io/baking-bits/wrd:latest

# Restart SWAG
docker restart swag

# View logs
docker logs -f ai-chat-app

# Check health
curl http://localhost:3007/health
curl https://respond2.me/health
```
