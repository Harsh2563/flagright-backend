# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Install netcat for the wait script
RUN apt-get update && apt-get install -y netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 5000

# Create a non-root user
RUN useradd -m appuser && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Command to run the application
CMD ["npm", "start"]
