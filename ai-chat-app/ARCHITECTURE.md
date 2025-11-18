# AI Chat App - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT DEVICES                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Phone   │  │  Tablet  │  │  Laptop  │  │ Desktop  │          │
│  │(Browser) │  │(Browser) │  │(Browser) │  │(Browser) │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
└───────┼─────────────┼─────────────┼─────────────┼─────────────────┘
        │             │             │             │
        └─────────────┴─────────────┴─────────────┘
                      │
                      │ HTTPS (via Reverse Proxy/Cloudflare)
                      │
        ┌─────────────▼─────────────┐
        │   REVERSE PROXY (Optional) │
        │  Nginx / Cloudflare Tunnel │
        │    SSL Termination         │
        └─────────────┬─────────────┘
                      │
                      │ HTTP/HTTPS
                      │
┌─────────────────────▼───────────────────────────────────────────────┐
│                       UNRAID SERVER                                 │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              Docker Container: ai-chat-app                   │  │
│  │              Port: 3000                                      │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │  Node.js Express Application                        │   │  │
│  │  │  - simple-server.js (main server)                   │   │  │
│  │  │  - JWT Authentication                               │   │  │
│  │  │  - Message Queue                                    │   │  │
│  │  │  - Auto Message Scheduler (30min-4hr idle)         │   │  │
│  │  │  - Push Notifications (Service Worker)             │   │  │
│  │  │  - PWA Support                                      │   │  │
│  │  └─────────────┬──────────────┬────────────┬──────────┘   │  │
│  └────────────────┼──────────────┼────────────┼──────────────┘  │
│                   │              │            │                  │
└───────────────────┼──────────────┼────────────┼──────────────────┘
                    │              │            │
                    │              │            │
    ┌───────────────▼───┐  ┌───────▼────────┐  ┌─▼──────────────┐
    │   MariaDB         │  │   LocalAI      │  │ Automatic1111  │
    │   192.168.1.206   │  │  192.168.1.206 │  │ 192.168.1.206  │
    │   Port: 3306      │  │  Port: 8082    │  │ Port: 7860     │
    │                   │  │                │  │                │
    │ ┌───────────────┐ │  │ ┌────────────┐ │  │ ┌────────────┐ │
    │ │   Database    │ │  │ │  Qwen3-4B  │ │  │ │ Pony XL    │ │
    │ │ - users       │ │  │ │ Abliterated│ │  │ │ SDXL Model │ │
    │ │ - chats       │ │  │ │    (GPU)   │ │  │ │   (GPU)    │ │
    │ │ - messages    │ │  │ │            │ │  │ │            │ │
    │ │ - personalities│ │  │ │  Text Gen  │ │  │ │  Image Gen │ │
    │ │ - sessions    │ │  │ └────────────┘ │  │ └────────────┘ │
    │ └───────────────┘ │  └────────────────┘  └────────────────┘
    └───────────────────┘
```

## Data Flow

### User Message Flow
```
[User Browser] 
    │
    ├─ POST /api/chat/message
    │   └─ JWT Auth Middleware
    │       └─ Message Queue
    │           └─ LocalAI Processing
    │               └─ Database Storage
    │                   └─ Response to Client
    │
    └─ [1 second polling] GET /api/chat/messages
        └─ Fetch new messages
```

### Image Generation Flow
```
[User Request]
    │
    ├─ POST /api/images/generate
    │   └─ Message Queue (with VRAM check)
    │       └─ Docker Manager (stop LocalAI if needed)
    │           └─ Automatic1111 Generation
    │               └─ Image saved to DB (base64)
    │                   └─ Restart LocalAI
    │                       └─ Response to Client
```

### Auto Message Flow
```
[AutoMessageScheduler - Every 5 minutes]
    │
    ├─ Check all chats for inactivity (30min - 4hr)
    │   └─ Recent message check (2+ msgs in 2hrs = skip)
    │       └─ 80% Text / 20% Image split
    │           ├─ Text: Random scenario prompt
    │           └─ Image: Physical traits selfie prompt
    │               └─ Queue message
    │                   └─ User receives notification
```

## Network Diagram

```
Internet
   │
   │ HTTPS (443)
   │
   ▼
[Reverse Proxy / Cloudflare Tunnel]
   │
   │ HTTP (3000)
   │
   ▼
[Unraid: ai-chat-app Container]
   │
   ├─────────────────┬────────────────┐
   │                 │                │
   │ TCP:3306        │ HTTP:8082      │ HTTP:7860
   │                 │                │
   ▼                 ▼                ▼
[MariaDB]      [LocalAI]      [Automatic1111]
(Database)     (Chat AI)       (Image AI)
```

## Component Details

### Frontend (PWA)
- **Technology**: Vanilla JavaScript, HTML5, CSS3
- **Features**:
  - Progressive Web App (installable)
  - Service Worker (push notifications)
  - 1-second polling for new messages
  - Image modal viewer
  - Personality selector with avatars
  - Responsive design (mobile-first)
- **Cache Busting**: Version parameter (v20251117164708)

### Backend (Node.js + Express)
- **Server**: simple-server.js
- **Port**: 3000 (internal container)
- **Authentication**: JWT (30-day sessions)
- **Database**: MariaDB with mysql2 driver
- **Message Queue**: Custom job processor
- **Features**:
  - Message queueing
  - VRAM management (stop LocalAI during image gen)
  - Auto-message scheduler
  - Push notification manager
  - Docker container control (SSH)

### Database (MariaDB)
- **Host**: 192.168.1.206:3306
- **Database**: ChatterRave
- **Tables**:
  - `users` (id, username, email, password_hash)
  - `chats` (id, user_id, title, personality_id)
  - `messages` (id, chat_id, role, content, metadata JSON)
  - `personalities` (id, user_id, name, system_prompt, physical traits)
  - `user_sessions` (id, user_id, token_hash, expires_at)
  - `user_settings` (id, user_id, setting_key, setting_value JSON)

### AI Services

#### LocalAI (Text Generation)
- **URL**: http://192.168.1.206:8082
- **Model**: josiefied-qwen3-4b-abliterated-gpu
- **Size**: ~4B parameters
- **VRAM**: ~8GB
- **Speed**: ~20 tokens/sec
- **Features**: Unfiltered chat, context-aware

#### Automatic1111 (Image Generation)
- **URL**: http://192.168.1.206:7860
- **Model**: uberRealisticPornMergePonyxl_ponyxlHybridV1.safetensors
- **Type**: Pony XL (SDXL-based)
- **Resolution**: 576x1024 (portrait)
- **VRAM**: ~12GB
- **Time**: ~15-30 seconds per image
- **Sampler**: DPM++ 2M, 20 steps, CFG 7

## Security Architecture

```
┌────────────────────────────────────────────────────────┐
│                  Security Layers                        │
├────────────────────────────────────────────────────────┤
│ Layer 1: Transport Security                            │
│   ├─ HTTPS (TLS 1.2+) via Reverse Proxy               │
│   └─ Encrypted in transit                              │
├────────────────────────────────────────────────────────┤
│ Layer 2: Authentication                                │
│   ├─ JWT tokens (30-day expiry)                        │
│   ├─ bcrypt password hashing (12 rounds)               │
│   └─ Session management in database                    │
├────────────────────────────────────────────────────────┤
│ Layer 3: Authorization                                 │
│   ├─ User owns their chats/personalities               │
│   └─ Database foreign key constraints                  │
├────────────────────────────────────────────────────────┤
│ Layer 4: Data Storage                                  │
│   ├─ Messages: Plain text in database ⚠️               │
│   ├─ Passwords: bcrypt hashed ✅                        │
│   └─ Images: base64 in metadata JSON                   │
└────────────────────────────────────────────────────────┘

⚠️  NOT END-TO-END ENCRYPTED
    Server can read all messages
    Use Cloudflare Tunnel or VPN for remote access
```

## Deployment Topology

### Local Network Only
```
[Devices] ──► [Unraid:3000] ──► [MariaDB]
                                 [LocalAI]
                                 [Automatic1111]
```

### With Reverse Proxy
```
[Devices] ──► [Nginx:443] ──► [Unraid:3000] ──► [Services]
          HTTPS           HTTP
```

### With Cloudflare Tunnel (Recommended for Remote Access)
```
[Internet] ──► [Cloudflare] ──► [Tunnel] ──► [Unraid:3000]
          HTTPS            Encrypted       HTTP
          
No ports exposed to internet!
```

## Resource Requirements

### Minimum (Chat Only)
- CPU: 2 cores
- RAM: 512MB
- Disk: 1GB (images grow database)
- Network: 100Mbps

### Recommended
- CPU: 4+ cores
- RAM: 1GB
- Disk: 10GB+ (for image storage)
- Network: 1Gbps

### AI Services (External)
- LocalAI: 8GB VRAM, 16GB RAM
- Automatic1111: 12GB VRAM, 24GB RAM
- Total GPU VRAM: 12GB (shared/sequential)

## Scaling Considerations

### Current Limits
- Single Node.js instance
- No load balancing
- No caching layer
- Sequential AI processing

### Future Enhancements
- Redis for session storage
- Message queue (RabbitMQ/Redis)
- Horizontal scaling (multiple containers)
- CDN for static assets
- Database read replicas

---

**This architecture prioritizes simplicity and ease of deployment while maintaining security for local/VPN access.**
