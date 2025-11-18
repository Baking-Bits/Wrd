# Fixes Applied - November 17, 2025

## Issues Fixed

### 1. Chat History Not Loading on Page Load ✅
**Problem:** Personality loaded correctly but chat messages didn't appear until page refresh

**Root Cause:** When personality was switched on initial load, messages were loaded but not rendered to the DOM

**Solution:** 
- Added explicit `renderMessages()` call after loading chat messages in personality change handler
- Added message count update for polling system
- Added auto-scroll to bottom after messages load
- Added 100ms delay to ensure DOM is ready before scrolling

**Files Changed:**
- `ai-chat-app/backend/public/js/app.js` (lines 4997-5008)

**Note:** This file is in `.gitignore` but will be included in Docker image via `COPY ai-chat-app/backend/` command

---

### 2. Auto-Message Frequency Too Low ✅
**Problem:** Auto-messages scheduled every 30 minutes, too slow for testing

**Solution:**
- Reduced check interval: 5 minutes → 2 minutes
- Reduced min idle time: 30 minutes → 5 minutes  
- Added randomization: Each chat gets random idle time between 5-15 minutes
- Prevents all chats from getting messages at exactly the same time
- Still respects spam prevention (won't send if recently sent)

**Files Changed:**
- `ai-chat-app/backend/autoMessageScheduler.js`

**New Behavior:**
- Checks for auto-messages every 2 minutes
- Sends auto-message after 5-15 minutes of inactivity (randomized per chat)
- Won't send if user has been actively chatting (2+ messages in last 2 hours)
- Won't send if chat idle for more than 4 hours (user probably away)
- At least 5 minutes between auto-messages per chat

---

## Deployment

### Changes Committed ✅
```bash
commit 328e462
Lower auto-message frequency to 5-15 minutes for testing
```

### GitHub Actions Status
- ✅ Push successful to `main` branch
- 🔄 Docker build triggered automatically
- 📦 New image will be: `ghcr.io/baking-bits/wrd:latest`

### Monitor Build
Check build progress at: https://github.com/Baking-Bits/Wrd/actions

---

## Next Steps

1. **Wait for Build** (~5-10 minutes)
   - GitHub Actions will build new Docker image
   - Image will be pushed to GitHub Container Registry

2. **Deploy on Unraid**
   ```bash
   # Stop existing container
   docker stop ai-chat-app
   docker rm ai-chat-app
   
   # Pull new image
   docker pull ghcr.io/baking-bits/wrd:latest
   
   # Run with correct volume mounts
   docker run -d \
     --name ai-chat-app \
     --restart unless-stopped \
     -p 3007:3000 \
     --env-file /mnt/user/BotFiles/Wrd/ai-chat-app/.env \
     -v /mnt/user/BotFiles/Wrd/ai-chat-app/.ssh:/root/.ssh:ro \
     ghcr.io/baking-bits/wrd:latest
   ```

3. **Verify Fixes**
   - Load page → Chat messages should appear immediately ✅
   - Wait 5-15 minutes → Should receive auto-message from AI ✅
   - Check console logs for: "☁️ Loaded X messages from cloud"

4. **Test Auto-Messages**
   - Send a message to AI
   - Wait 5-15 minutes (randomized)
   - AI should send unprompted message
   - Check server logs: `docker logs -f ai-chat-app`

---

## Important Notes

### Frontend Changes NOT in Git
- The `public/` directory is in `.gitignore`
- Frontend changes exist locally but not in repository
- **Docker image WILL include them** via `COPY ai-chat-app/backend/`
- This is intentional - keeps git history clean

### SSH Key Authentication
Your `.env` file is configured to use SSH key at `/root/.ssh/id_rsa` (inside container)

Make sure to mount it:
```bash
-v /mnt/user/BotFiles/Wrd/ai-chat-app/.ssh:/root/.ssh:ro
```

### Volume Mounts (CRITICAL)
**DO NOT** mount entire app directory:
```bash
# ❌ WRONG - This overwrites app code
-v /mnt/user/BotFiles/Wrd/ai-chat-app:/app
```

**DO** mount only config files:
```bash
# ✅ CORRECT - Loads environment variables
--env-file /mnt/user/BotFiles/Wrd/ai-chat-app/.env

# ✅ CORRECT - Mounts SSH key
-v /mnt/user/BotFiles/Wrd/ai-chat-app/.ssh:/root/.ssh:ro
```

---

## Troubleshooting

### Chat Still Not Loading?
1. Check browser console for errors
2. Verify API authentication: Look for "☁️ Loaded X messages from cloud"
3. Hard refresh: Ctrl+F5 to clear browser cache

### Auto-Messages Not Sending?
1. Check if scheduler started: `docker logs ai-chat-app | grep "Auto-message scheduler"`
2. Should see: "💬 Auto-message scheduler started"
3. Every 2 minutes: "⏰ Checking X active chats for auto-messages..."
4. When sending: "💬 Sending auto-message for chat X (idle: Ymin)"

### Container Won't Start?
1. Check if using `--env-file` instead of `-v` for app directory
2. Verify `.env` file exists: `ls -la /mnt/user/BotFiles/Wrd/ai-chat-app/.env`
3. Check logs: `docker logs ai-chat-app`

---

## Build Info
- Commit: `328e462`
- Branch: `main`
- Build Trigger: Push to main
- Registry: `ghcr.io/baking-bits/wrd`
- Tags: `latest`, `main-328e462`
