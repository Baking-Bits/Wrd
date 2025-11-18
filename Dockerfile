FROM node:20-alpine

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache dumb-init curl python3 make g++

# Create app directory
WORKDIR /app/backend

# Copy package files first for better caching
COPY ai-chat-app/backend/package*.json ./

# Install dependencies and rebuild native modules for Alpine Linux
RUN npm ci --only=production && \
    npm rebuild bcrypt --build-from-source && \
    npm cache clean --force

# Copy application code
COPY ai-chat-app/backend/ ./

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD curl -f http://localhost:3000/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "simple-server.js"]