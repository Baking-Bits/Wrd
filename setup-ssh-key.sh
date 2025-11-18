#!/bin/bash

# Setup SSH key for Docker container to control Unraid containers
# Run this script on your Unraid server

KEY_DIR="/mnt/user/BotFiles/Wrd/ai-chat-app/.ssh"
KEY_FILE="$KEY_DIR/unraid_key"

echo "🔐 Setting up SSH keys for AI Chat App..."

# Create .ssh directory if it doesn't exist
mkdir -p "$KEY_DIR"

# Generate SSH key pair if it doesn't exist
if [ ! -f "$KEY_FILE" ]; then
    echo "📝 Generating new SSH key pair..."
    ssh-keygen -t rsa -b 4096 -f "$KEY_FILE" -N "" -C "ai-chat-app-docker"
    echo "✅ SSH key pair generated"
else
    echo "✅ SSH key already exists"
fi

# Add public key to root's authorized_keys
echo "🔑 Adding public key to authorized_keys..."
mkdir -p /root/.ssh
chmod 700 /root/.ssh

if ! grep -q "$(cat $KEY_FILE.pub)" /root/.ssh/authorized_keys 2>/dev/null; then
    cat "$KEY_FILE.pub" >> /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    echo "✅ Public key added to authorized_keys"
else
    echo "✅ Public key already in authorized_keys"
fi

# Set correct permissions
chmod 600 "$KEY_FILE"
chmod 644 "$KEY_FILE.pub"

echo ""
echo "✅ SSH setup complete!"
echo ""
echo "Private key: $KEY_FILE"
echo "Public key: $KEY_FILE.pub"
echo ""
echo "You can now start the Docker container with:"
echo "  Volume mount: $KEY_DIR:/root/.ssh:ro"
echo "  Environment: DOCKER_SSH_KEY_PATH=/root/.ssh/unraid_key"
