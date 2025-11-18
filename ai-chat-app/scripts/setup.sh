#!/bin/bash
# Setup script for AI Chat App with Docker

echo "🚀 Setting up AI Chat App with Docker..."
echo "========================================"

# Check if Docker and Docker Compose are installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    
    # Generate secure passwords and secrets
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/" | cut -c1-64)
    
    # Update .env file with generated secrets
    sed -i "s/your_secure_db_password_here/$DB_PASSWORD/" .env
    sed -i "s/your_secure_redis_password_here/$REDIS_PASSWORD/" .env
    sed -i "s/your_jwt_secret_key_minimum_32_characters_long/$JWT_SECRET/" .env
    
    echo "🔐 Generated secure passwords and secrets"
else
    echo "✅ .env file already exists"
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p backend/src/uploads
mkdir -p database/backups
mkdir -p docker/nginx/conf.d

echo "📦 Installing backend dependencies..."
cd backend
npm install
cd ..

echo "🔧 Building Docker images..."
docker-compose build

echo "🗄️  Setting up database..."
docker-compose up -d database redis

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 10

# Run migrations
echo "🔄 Running database migrations..."
docker-compose exec -T database psql -U aichat_user -d ai_chat -f /docker-entrypoint-initdb.d/01-schema.sql || true

echo "🚀 Starting all services..."
docker-compose up -d

echo ""
echo "🎉 Setup complete! AI Chat App is now running."
echo ""
echo "📋 Service Status:"
echo "   🌐 Web Application: http://localhost (via nginx)"
echo "   🗄️  Database: localhost:5432"
echo "   🔴 Redis: localhost:6379"
echo "   💬 LocalAI: localhost:8082"
echo "   🎨 Automatic1111: localhost:7860"
echo "   🔧 ComfyUI: localhost:8188"
echo ""
echo "🔧 Management Commands:"
echo "   📊 View logs: docker-compose logs -f"
echo "   🛑 Stop services: docker-compose down"
echo "   🔄 Restart: docker-compose restart"
echo "   🗑️  Clean up: docker-compose down -v"
echo ""
echo "🔐 Admin Account:"
echo "   📧 Email: admin@localhost"
echo "   🔑 Password: admin123 (CHANGE THIS!)"
echo ""
echo "💡 Next Steps:"
echo "   1. Open http://localhost in your browser"
echo "   2. Log in with the admin account"
echo "   3. Change the admin password in settings"
echo "   4. Create your first personality"
echo "   5. Start chatting with AI!"
echo ""
echo "📚 Documentation: docs/CONTAINERIZATION_PLAN.md"