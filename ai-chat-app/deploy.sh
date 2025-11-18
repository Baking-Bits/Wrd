#!/bin/bash

# AI Chat App - Unraid Deployment Script
# This script builds and deploys the Docker container to Unraid

set -e  # Exit on error

echo "🚀 AI Chat App - Docker Deployment Script"
echo "=========================================="

# Configuration
APP_NAME="ai-chat-app"
IMAGE_NAME="ai-chat-app:latest"
CONTAINER_NAME="ai-chat-app"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running in project directory
if [ ! -f "Dockerfile" ]; then
    echo -e "${RED}❌ Error: Dockerfile not found. Run this script from the project root.${NC}"
    exit 1
fi

# Step 1: Build Docker image
echo -e "\n${YELLOW}📦 Building Docker image...${NC}"
docker build -t $IMAGE_NAME .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
else
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi

# Step 2: Stop and remove existing container (if exists)
if docker ps -a | grep -q $CONTAINER_NAME; then
    echo -e "\n${YELLOW}🛑 Stopping existing container...${NC}"
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
    echo -e "${GREEN}✅ Existing container removed${NC}"
fi

# Step 3: Deploy container (adjust environment variables as needed)
echo -e "\n${YELLOW}🚀 Deploying container...${NC}"

# Prompt for sensitive information if not provided
read -p "Enter Database Password: " -s DB_PASSWORD
echo
read -p "Enter JWT Secret (leave empty to generate): " JWT_SECRET

if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(openssl rand -base64 48)
    echo "Generated JWT Secret: $JWT_SECRET"
fi

docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -e DB_HOST=192.168.1.206 \
  -e DB_PORT=3306 \
  -e DB_USER=ChatterRaveUser \
  -e DB_PASSWORD="$DB_PASSWORD" \
  -e DB_NAME=ChatterRave \
  -e JWT_SECRET="$JWT_SECRET" \
  -e LOCALAI_URL=http://192.168.1.206:8082 \
  -e AUTOMATIC1111_URL=http://192.168.1.206:7860 \
  $IMAGE_NAME

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✅ Container deployed successfully${NC}"
    echo -e "${GREEN}🌐 Application available at: http://localhost:3000${NC}"
else
    echo -e "\n${RED}❌ Container deployment failed${NC}"
    exit 1
fi

# Step 4: Show logs
echo -e "\n${YELLOW}📋 Container logs (Ctrl+C to exit):${NC}"
sleep 2
docker logs -f $CONTAINER_NAME
