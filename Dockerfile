# Simple and Robust Dockerfile
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm ci && npm cache clean --force

# Copy frontend source
COPY frontend/ ./

# Build Angular for production
RUN npm run build

# Debug what we built
RUN echo "=== Build Output Debug ===" && \
    ls -la && \
    echo "Dist directory:" && \
    ls -la dist/ && \
    echo "Contents of dist subdirectories:" && \
    find dist/ -type f -name "*.html" && \
    echo "All JS files:" && \
    find dist/ -name "*.js" | head -3

# Backend runtime stage
FROM node:20-alpine AS runtime

# Install system dependencies
RUN apk add --no-cache \
    ffmpeg \
    dumb-init \
    curl \
    && addgroup -g 1001 -S nodejs \
    && adduser -S radio -u 1001

WORKDIR /app

# Copy backend package files
COPY package*.json ./

# Install backend dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy backend source
COPY . .

# Create public directory
RUN mkdir -p /app/public

# Copy ALL files from dist to public (let's see what we get)
COPY --from=frontend-builder /app/frontend/dist/ ./public-temp/

# Move files to the right place using a simple script
RUN cd public-temp && \
    # If there's a browser subdirectory, use that
    if [ -d "*/browser" ]; then \
        echo "Found browser subdirectory, copying from there" && \
        cp -r */browser/* /app/public/; \
    # If there's any subdirectory with index.html, use that  
    elif [ -n "$(find . -name 'index.html' | head -1)" ]; then \
        INDEX_PATH=$(find . -name 'index.html' | head -1 | xargs dirname) && \
        echo "Found index.html in $INDEX_PATH, copying from there" && \
        cp -r "$INDEX_PATH"/* /app/public/; \
    # Otherwise copy everything
    else \
        echo "No browser subdir found, copying everything" && \
        cp -r ./* /app/public/; \
    fi && \
    cd /app && rm -rf public-temp

# Final debug
RUN echo "=== Final Public Directory ===" && \
    ls -la /app/public/ && \
    echo "Index.html present:" && \
    ls -la /app/public/index.html 2>/dev/null || echo "NO INDEX.HTML FOUND"

# Create data directories with correct permissions
RUN mkdir -p /app/data/incoming \
             /app/data/reencoded \
             /app/data/metadata \
             /app/data/logs \
    && chown -R radio:nodejs /app/data \
    && chown -R radio:nodejs /app/public

# Switch to non-root user
USER radio

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Expose port
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]