#!/bin/bash
# Unraid Deployment Script for AI Chat App
# Run this on your Unraid server

# Configuration
IMAGE_NAME="ghcr.io/baking-bits/wrd:latest"
CONTAINER_NAME="ai-chat-app"
HOST_PORT=3007
CONTAINER_PORT=3000
ENV_FILE="/mnt/user/BotFiles/Wrd/ai-chat-app/.env"
SSH_KEY_DIR="/mnt/user/BotFiles/Wrd/ai-chat-app/.ssh"

# Stop and remove existing container if it exists
echo "Stopping existing container..."
docker stop $CONTAINER_NAME 2>/dev/null
docker rm $CONTAINER_NAME 2>/dev/null

# Pull latest image
echo "Pulling latest image..."
docker pull $IMAGE_NAME

# Run container with proper volume mounts
echo "Starting container..."
docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p $HOST_PORT:$CONTAINER_PORT \
  --env-file $ENV_FILE \
  -v $SSH_KEY_DIR:/root/.ssh:ro \
  $IMAGE_NAME

# Wait a few seconds for container to start
sleep 5

# Show container status
echo ""
echo "Container status:"
docker ps -f name=$CONTAINER_NAME

# Show recent logs
echo ""
echo "Recent logs:"
docker logs --tail 20 $CONTAINER_NAME

echo ""
echo "Deployment complete!"
echo "Access the app at: http://192.168.1.206:$HOST_PORT"
echo ""
echo "To view logs: docker logs -f $CONTAINER_NAME"
echo "To stop: docker stop $CONTAINER_NAME"
