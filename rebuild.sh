#!/bin/bash
# rebuild.sh - Complete rebuild script

echo "🔄 Rebuilding Radio Station with Frontend Fix..."

# Stop existing container
echo "1. Stopping existing containers..."
docker-compose down

# Remove old images to force rebuild
echo "2. Removing old images..."
docker rmi $(docker images "radio-station*" -q) 2>/dev/null || echo "No old images to remove"

# Build fresh
echo "3. Building fresh containers..."
docker-compose build --no-cache

# Start services
echo "4. Starting services..."
docker-compose up -d

# Wait for startup
echo "5. Waiting for startup..."
sleep 10

# Check health
echo "6. Checking health..."
health=$(curl -s http://localhost:3000/api/health)
if echo "$health" | jq -e '.frontend.available' > /dev/null 2>&1; then
    frontend_available=$(echo "$health" | jq -r '.frontend.available')
    if [ "$frontend_available" = "true" ]; then
        echo "✅ Frontend is available!"
        echo "🌐 Access your radio station at: http://localhost:3000"
    else
        echo "❌ Frontend not available"
        echo "Frontend status:" 
        echo "$health" | jq '.frontend'
    fi
else
    echo "❌ Health check failed"
    echo "Response: $health"
fi

# Show logs
echo "7. Recent logs:"
docker logs radio-station --tail 15

echo "🏁 Rebuild completed!"
echo ""
echo "💡 Troubleshooting:"
echo "   - Check logs: docker logs radio-station"
echo "   - Shell access: docker exec -it radio-station sh"
echo "   - Health check: curl http://localhost:3000/api/health"