#!/bin/bash

# AI Chat App - Quick Start Script
# This script helps you get the application running quickly

set -e

echo "🚀 AI Chat App - Quick Start"
echo "=============================="

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration before continuing."
    echo "   Minimum required: JWT_SECRET, OPENAI_API_KEY"
    read -p "Press Enter after editing .env file..."
fi

# Function to start development environment
start_dev() {
    echo "🔧 Starting development environment..."
    
    # Install Node.js dependencies
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing Node.js dependencies..."
        npm install
    fi
    
    # Start Docker services
    echo "🐳 Starting PostgreSQL and Redis..."
    docker-compose up -d postgres redis
    
    # Wait for services to be ready
    echo "⏳ Waiting for services to be ready..."
    sleep 10
    
    # Run database migrations
    echo "🗄️  Setting up database..."
    npm run migrate 2>/dev/null || echo "Note: Migrations may need to be implemented"
    
    # Start the application
    echo "🌟 Starting the application..."
    echo "   Frontend (localStorage mode): Open frontend/index.html in browser"
    echo "   Backend API: http://localhost:3000"
    echo "   To start backend: npm run dev"
    echo ""
    echo "✅ Development environment ready!"
}

# Function to start production environment
start_prod() {
    echo "🚀 Starting production environment..."
    
    # Check if production .env exists
    if [ ! -f .env.production ]; then
        echo "📝 Creating production .env file from template..."
        cp .env.production .env
    fi
    
    # Build and start production stack
    echo "🏗️  Building and starting production stack..."
    docker-compose -f docker-compose.prod.yml up --build -d
    
    # Wait for services
    echo "⏳ Waiting for services to be ready..."
    sleep 20
    
    # Check health
    echo "🔍 Checking service health..."
    docker-compose -f docker-compose.prod.yml ps
    
    echo "✅ Production environment started!"
    echo "   Application available at: http://localhost"
    echo "   View logs with: docker-compose -f docker-compose.prod.yml logs -f"
}

# Function to stop all services
stop_services() {
    echo "🛑 Stopping all services..."
    docker-compose down 2>/dev/null || true
    docker-compose -f docker-compose.prod.yml down 2>/dev/null || true
    echo "✅ All services stopped."
}

# Function to show logs
show_logs() {
    echo "📋 Showing application logs..."
    if docker-compose ps | grep -q "ai-chat-app"; then
        docker-compose logs -f
    elif docker-compose -f docker-compose.prod.yml ps | grep -q "ai-chat"; then
        docker-compose -f docker-compose.prod.yml logs -f
    else
        echo "No running containers found."
    fi
}

# Function to reset development environment
reset_dev() {
    echo "🔄 Resetting development environment..."
    stop_services
    docker volume rm ai-chat-app_postgres_data 2>/dev/null || true
    docker volume rm ai-chat-app_redis_data 2>/dev/null || true
    echo "✅ Development environment reset."
}

# Main menu
show_menu() {
    echo ""
    echo "Please choose an option:"
    echo "1) Start development environment"
    echo "2) Start production environment"  
    echo "3) Stop all services"
    echo "4) Show logs"
    echo "5) Reset development environment"
    echo "6) Exit"
    echo ""
}

# Handle command line arguments
case "${1:-}" in
    "dev")
        start_dev
        exit 0
        ;;
    "prod") 
        start_prod
        exit 0
        ;;
    "stop")
        stop_services
        exit 0
        ;;
    "logs")
        show_logs
        exit 0
        ;;
    "reset")
        reset_dev
        exit 0
        ;;
esac

# Interactive menu if no arguments provided
while true; do
    show_menu
    read -p "Enter your choice (1-6): " choice
    
    case $choice in
        1)
            start_dev
            break
            ;;
        2)
            start_prod
            break
            ;;
        3)
            stop_services
            break
            ;;
        4)
            show_logs
            break
            ;;
        5)
            reset_dev
            ;;
        6)
            echo "👋 Goodbye!"
            break
            ;;
        *)
            echo "❌ Invalid option. Please choose 1-6."
            ;;
    esac
done