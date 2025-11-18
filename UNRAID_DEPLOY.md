# Unraid Docker Run Command for AI Chat App

## Quick Deploy (Copy and paste into Unraid terminal):

```bash
# Pull latest image
docker pull ghcr.io/baking-bits/wrd:latest

# Stop/remove old container if exists
docker stop ai-chat-app 2>/dev/null && docker rm ai-chat-app 2>/dev/null

# Run container
docker run -d \
  --name ai-chat-app \
  --restart unless-stopped \
  -p 3007:3000 \
  --env-file /mnt/user/BotFiles/Wrd/ai-chat-app/.env \
  -v /mnt/user/BotFiles/Wrd/ai-chat-app/.ssh:/root/.ssh:ro \
  ghcr.io/baking-bits/wrd:latest
```

## Important Notes:

### Volume Mounts
- **DO NOT** mount `-v /mnt/user/BotFiles/Wrd/ai-chat-app:/app` 
  - This would replace the app code with your local directory
  - The container has the compiled app code built-in
  
- **DO** mount only these specific files:
  - `.env` file via `--env-file` flag (loads environment variables)
  - `.ssh` directory for SSH key authentication (read-only)

### Prerequisites:
1. Ensure `.env` file exists at `/mnt/user/BotFiles/Wrd/ai-chat-app/.env`
2. Ensure SSH key exists at `/mnt/user/BotFiles/Wrd/ai-chat-app/.ssh/id_rsa`
3. Set correct permissions on SSH key: `chmod 600 /mnt/user/BotFiles/Wrd/ai-chat-app/.ssh/id_rsa`

### Verify Deployment:
```bash
# Check container status
docker ps -f name=ai-chat-app

# View logs
docker logs -f ai-chat-app

# Test health endpoint
curl http://localhost:3007/health
```

### Access:
- Web Interface: http://192.168.1.206:3007
- Health Check: http://192.168.1.206:3007/health

### Troubleshooting:
If you see "Cannot find module" errors:
- **DO NOT mount the entire app directory as a volume**
- Only use `--env-file` and mount `.ssh` directory
- The application code is already compiled into the Docker image
