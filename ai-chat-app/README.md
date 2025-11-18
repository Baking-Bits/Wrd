# AI Chat App

A modern, production-ready AI chat application with user authentication, persistent chat history, and customizable AI personalities. Built with Node.js, Express, PostgreSQL, and a hybrid frontend that supports both API and local storage modes.

## Features

### 🤖 AI Chat Capabilities
- Multiple AI personalities with customizable settings
- Persistent chat history across sessions
- Real-time streaming responses
- File upload support for context
- Conversation export functionality

### 👥 User Management
- Secure user registration and authentication
- JWT-based session management
- Password reset functionality
- User settings and preferences

### 🏗️ Architecture
- **Backend**: Node.js with Express.js REST API
- **Database**: PostgreSQL with comprehensive schema
- **Caching**: Redis for sessions and rate limiting
- **Frontend**: Vanilla JavaScript with hybrid API/localStorage support
- **Containerization**: Docker with multi-service orchestration
- **CI/CD**: GitHub Actions with automated building and deployment

### 🔒 Security
- bcrypt password hashing
- JWT token-based authentication
- Rate limiting and request validation
- CORS protection
- Input sanitization
- Comprehensive security headers

## Quick Start

### Local Development

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ai-chat-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start development services:**
   ```bash
   docker-compose up -d postgres redis
   npm run dev
   ```

5. **Access the application:**
   - Frontend (localStorage mode): Open `frontend/index.html` in browser
   - API mode: `http://localhost:3000`

### Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive production deployment instructions.

## Project Structure

```
ai-chat-app/
├── backend/                 # Node.js API server
│   ├── controllers/         # Route handlers
│   ├── middleware/          # Authentication, validation, etc.
│   ├── models/             # Database models
│   ├── routes/             # API route definitions
│   ├── utils/              # Helper functions
│   └── server.js           # Main server file
├── frontend/               # Client-side application
│   ├── js/                 # JavaScript modules
│   ├── css/                # Stylesheets
│   ├── assets/             # Static assets
│   └── index.html          # Main HTML file
├── docker/                 # Docker configurations
│   └── nginx/              # Nginx proxy configuration
├── database/               # Database schemas and migrations
├── .github/workflows/      # CI/CD pipelines
├── docker-compose.yml      # Development environment
├── docker-compose.prod.yml # Production environment
├── Dockerfile             # Production image build
├── DEPLOYMENT.md          # Deployment guide
└── README.md              # This file
```

## API Documentation

### Authentication Endpoints

#### POST /api/auth/register
Register a new user account.

**Request Body:**
```json
{
  "username": "string",
  "email": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "email": "string"
  },
  "token": "jwt_token"
}
```

#### POST /api/auth/login
Authenticate user and receive JWT token.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

#### POST /api/auth/logout
Invalidate current JWT token.

### Chat Management

#### GET /api/chats
Retrieve user's chat history.

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "string",
    "created_at": "timestamp",
    "updated_at": "timestamp",
    "message_count": "number"
  }
]
```

#### POST /api/chats
Create a new chat session.

#### GET /api/chats/:id/messages
Retrieve messages from specific chat.

#### POST /api/chats/:id/messages
Send a message to AI and receive response.

### Personality Management

#### GET /api/personalities
Get available AI personalities.

#### POST /api/personalities
Create custom AI personality.

#### PUT /api/personalities/:id
Update existing personality.

### Settings

#### GET /api/settings
Retrieve user settings and preferences.

#### PUT /api/settings
Update user settings.

## Environment Configuration

### Required Environment Variables

```env
# Application
NODE_ENV=development|production
PORT=3000
APP_NAME=AI Chat App
APP_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
DB_HOST=localhost
DB_PORT=5432
DB_NAME=aichat_dev
DB_USER=aichat
DB_PASSWORD=your_password

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Authentication
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# AI Configuration
OPENAI_API_KEY=your_openai_api_key
DEFAULT_MODEL=gpt-3.5-turbo
MAX_TOKENS=2000
TEMPERATURE=0.7

# Security
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm run test:auth
npm run test:chats
```

### Database Operations

```bash
# Run migrations
npm run migrate

# Seed development data
npm run seed

# Reset database
npm run db:reset
```

### Development Tools

```bash
# Start development server with hot reload
npm run dev

# Lint code
npm run lint

# Format code
npm run format

# Build for production
npm run build
```

## Docker Development

### Development Environment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production Testing

```bash
# Build and start production stack
docker-compose -f docker-compose.prod.yml up --build

# Scale application instances
docker-compose -f docker-compose.prod.yml up -d --scale ai-chat=3
```

## Hybrid Frontend Mode

The frontend supports both API and localStorage modes:

### API Mode (Production)
- Connects to backend API for full functionality
- User authentication and multi-user support
- Persistent data across devices
- Real-time features and collaboration

### localStorage Mode (Development/Offline)
- Stores data in browser localStorage
- No authentication required
- Single-user experience
- Useful for development and testing

The application automatically detects the available mode and adapts accordingly.

## Contributing

1. **Fork the repository**
2. **Create a feature branch:**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes and add tests**
4. **Run the test suite:**
   ```bash
   npm test
   ```
5. **Commit your changes:**
   ```bash
   git commit -m 'Add amazing feature'
   ```
6. **Push to the branch:**
   ```bash
   git push origin feature/amazing-feature
   ```
7. **Open a Pull Request**

## Monitoring and Logging

### Application Metrics
- Request/response times
- Error rates and types
- User activity patterns
- AI model usage statistics

### Health Checks
- `/health` - Basic application health
- `/api/health` - Detailed service status
- Database connectivity
- Redis connectivity
- External API availability

### Log Levels
- `error`: Error conditions
- `warn`: Warning conditions
- `info`: Informational messages
- `debug`: Debug-level messages

## Security

### Best Practices Implemented
- Password hashing with bcrypt
- JWT token management
- Input validation and sanitization
- Rate limiting
- CORS configuration
- Security headers
- SQL injection prevention
- XSS protection

### Security Considerations
- Keep dependencies updated
- Use strong JWT secrets
- Configure proper CORS origins
- Enable HTTPS in production
- Regular security audits
- Monitor for suspicious activity

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For questions, issues, or contributions:
- Create an issue on GitHub
- Check the [deployment guide](DEPLOYMENT.md)
- Review the API documentation above
- Check existing issues and discussions

## Changelog

### Version 1.0.0
- Initial release
- Complete backend API
- User authentication system
- AI chat functionality
- Docker containerization
- CI/CD pipeline setup
- Production deployment support