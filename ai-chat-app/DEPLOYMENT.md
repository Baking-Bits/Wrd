# AI Chat App - Production Deployment Guide

## Overview
This guide covers deploying the AI Chat App to your Unraid server using automated CI/CD pipelines.

## Prerequisites
- Unraid server with Docker support
- Private Git repository (GitHub/GitLab/etc.)
- Docker Hub account (or private registry)

## Setup Instructions

### 1. Create Private Git Repository

1. Create a new private repository on GitHub (or your preferred Git provider)
2. Clone this project to the new repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: AI Chat App with production setup"
   git branch -M main
   git remote add origin https://github.com/yourusername/your-repo-name.git
   git push -u origin main
   ```

### 2. Configure Repository Secrets

In your GitHub repository, go to Settings → Secrets and Variables → Actions and add:

#### Required Secrets:
- `DOCKER_USERNAME`: Your Docker Hub username
- `DOCKER_PASSWORD`: Your Docker Hub password/token
- `OPENAI_API_KEY`: Your OpenAI API key

#### Optional Secrets (for advanced features):
- `GITHUB_TOKEN`: Automatically available, used for releases
- `SLACK_WEBHOOK`: For deployment notifications
- `REGISTRY_URL`: If using private Docker registry

### 3. Environment Configuration

Copy the production environment template:
```bash
cp .env.production .env
```

Edit `.env` with your production values:
```env
# Application
NODE_ENV=production
APP_NAME=AI Chat App
APP_URL=https://your-domain.com
PORT=3000

# Database
DATABASE_URL=postgresql://aichat:your_secure_password@postgres:5432/aichat_prod
DB_HOST=postgres
DB_PORT=5432
DB_NAME=aichat_prod
DB_USER=aichat
DB_PASSWORD=your_secure_password

# Redis
REDIS_URL=redis://redis:6379
REDIS_HOST=redis
REDIS_PORT=6379

# Authentication
JWT_SECRET=your_very_long_and_secure_jwt_secret_key_here
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# Security
CORS_ORIGIN=https://your-domain.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# AI Configuration
OPENAI_API_KEY=your_openai_api_key_here
DEFAULT_MODEL=gpt-4
MAX_TOKENS=2000
TEMPERATURE=0.7

# File Upload
MAX_FILE_SIZE=10485760
ALLOWED_FILE_TYPES=txt,pdf,doc,docx

# Monitoring
LOG_LEVEL=info
ENABLE_METRICS=true
```

### 4. Automatic Deployment Pipeline

The GitHub Actions workflow (`.github/workflows/docker-build.yml`) will automatically:

1. **On Push to Main Branch:**
   - Run security scans
   - Build and test the application
   - Create Docker image
   - Push to Docker Hub
   - Create GitHub release

2. **On New Release Tag:**
   - Build production-optimized image
   - Push with version tags
   - Generate deployment artifacts

### 5. Deploy to Unraid

#### Method 1: Using Docker Compose (Recommended)

1. SSH into your Unraid server
2. Create application directory:
   ```bash
   mkdir -p /mnt/user/appdata/ai-chat-app
   cd /mnt/user/appdata/ai-chat-app
   ```

3. Download the production compose file:
   ```bash
   wget https://raw.githubusercontent.com/yourusername/your-repo-name/main/docker-compose.prod.yml
   ```

4. Create your environment file:
   ```bash
   nano .env
   # Paste your production environment variables
   ```

5. Deploy the application:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

#### Method 2: Using Unraid Docker Templates

1. In Unraid Web UI, go to Docker → Add Container
2. Use the following configuration:

**Basic Settings:**
- Name: `ai-chat-app`
- Repository: `yourdockerhubusername/ai-chat-app:latest`
- Network Type: `Custom: br0` (or your preferred network)

**Port Mappings:**
- Container Port: `80` → Host Port: `8080` (or your preferred port)

**Volume Mappings:**
- Container Path: `/app/uploads` → Host Path: `/mnt/user/appdata/ai-chat-app/uploads`
- Container Path: `/app/logs` → Host Path: `/mnt/user/appdata/ai-chat-app/logs`

**Environment Variables:**
Add all the variables from your `.env` file

**Docker Network:**
Create a custom network for the services or use existing networks for PostgreSQL and Redis if you have them running.

### 6. Database Setup

#### Option A: Use Existing PostgreSQL Container
If you already have PostgreSQL running on Unraid:
1. Create the database: `aichat_prod`
2. Create the user with appropriate permissions
3. Update `DATABASE_URL` in your environment

#### Option B: Deploy Full Stack with Docker Compose
The `docker-compose.prod.yml` includes PostgreSQL and Redis services that will be automatically configured.

### 7. SSL/TLS Configuration

#### For Production with Domain:
1. Uncomment SSL sections in `docker/nginx/nginx.conf`
2. Add SSL certificate volume mounts to docker-compose
3. Update environment variables with your domain

#### Using Cloudflare/Reverse Proxy:
1. Configure your reverse proxy to point to the Unraid server
2. Enable SSL termination at the proxy level
3. Set `CORS_ORIGIN` to match your domain

### 8. Monitoring and Maintenance

#### Health Checks:
- Application: `http://your-server:8080/health`
- API: `http://your-server:8080/api/health`

#### Logs:
```bash
# View application logs
docker logs ai-chat-app

# View all services
docker-compose -f docker-compose.prod.yml logs -f
```

#### Updates:
The CI/CD pipeline automatically creates new Docker images. To update:
```bash
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```

#### Backups:
1. Database: Use PostgreSQL backup tools or volume snapshots
2. User uploads: Backup the uploads directory
3. Configuration: Keep your `.env` file backed up

### 9. Troubleshooting

#### Common Issues:

**Connection Refused:**
- Check if all services are running: `docker-compose ps`
- Verify network connectivity between containers
- Check firewall settings on Unraid

**Database Connection Issues:**
- Verify DATABASE_URL format
- Check PostgreSQL logs: `docker logs ai-chat-app_postgres_1`
- Ensure database and user exist

**Authentication Problems:**
- Verify JWT_SECRET is set and consistent
- Check CORS_ORIGIN matches your access URL
- Review application logs for specific errors

**Performance Issues:**
- Monitor resource usage in Unraid dashboard
- Check Redis connection for caching
- Review Nginx access logs for bottlenecks

### 10. Advanced Configuration

#### Custom AI Models:
Update environment variables to use different OpenAI models or add support for local AI models.

#### Scaling:
The Docker Compose setup supports horizontal scaling:
```bash
docker-compose -f docker-compose.prod.yml up -d --scale ai-chat=3
```

#### Custom Domains:
1. Update Nginx configuration with your domain
2. Configure SSL certificates
3. Update CORS and security headers

## Support

For issues or questions:
1. Check the application logs
2. Review this deployment guide
3. Check the GitHub repository issues
4. Create a new issue with relevant logs and configuration details

## Security Considerations

- Keep your `.env` file secure and never commit it to version control
- Regularly update Docker images for security patches
- Use strong passwords for database and JWT secrets
- Configure proper firewall rules on your Unraid server
- Consider using a reverse proxy with additional security features