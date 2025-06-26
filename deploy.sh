#!/bin/bash
# deploy.sh - Simplified Radio Station Deployment Script (Single Container)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="radio-station"
ENV=${1:-development}

# Get host port and set dynamic container name
get_host_port() {
    if [ -f .env ]; then
        HOST_PORT=$(grep "^HOST_PORT=" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
    fi
    # Default to 3000 if not set
    HOST_PORT=${HOST_PORT:-3000}
    echo $HOST_PORT
}

HOST_PORT=$(get_host_port)
CONTAINER_NAME="radio-station-${HOST_PORT}"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    log_success "Docker is running"
}

# Check if environment file exists
check_env_file() {
    if [ ! -f .env ]; then
        if [ -f .env.example ]; then
            log_warning ".env file not found. Copying from .env.example"
            cp .env.example .env
            log_warning "Please update .env file with your Janus server configuration"
        else
            log_error ".env file not found and no .env.example available"
            exit 1
        fi
    fi
    log_success "Environment file found"
}

# Create production directories
create_production_dirs() {
    if [ "$ENV" = "production" ]; then
        log_info "Creating production directories..."
        
        DIRS=(
            "/opt/radio-station/data"
            "/opt/radio-station/data/incoming"
            "/opt/radio-station/data/reencoded"
            "/opt/radio-station/data/metadata"
            "/opt/radio-station/data/logs"
        )
        
        for dir in "${DIRS[@]}"; do
            if [ ! -d "$dir" ]; then
                sudo mkdir -p "$dir"
                sudo chown $USER:$USER "$dir"
                log_info "Created directory: $dir"
            fi
        done
        
        log_success "Production directories ready"
    fi
}

# Build and deploy
deploy() {
    log_info "Starting deployment for environment: $ENV"
    log_info "Using host port: $HOST_PORT"
    log_info "Container name: $CONTAINER_NAME"
    
    # Preparation
    check_docker
    check_env_file
    create_production_dirs
    
    # Choose compose file
    if [ "$ENV" = "production" ]; then
        COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
        ACCESS_URL="http://localhost:${HOST_PORT}"
        log_info "Using production configuration"
    else
        COMPOSE_FILES="-f docker-compose.yml"
        ACCESS_URL="http://localhost:${HOST_PORT}"
        log_info "Using development configuration"
    fi
    
    # Stop existing container if running
    log_info "Stopping existing container..."
    docker-compose $COMPOSE_FILES down 2>/dev/null || true
    
    # Build and start
    log_info "Building and starting container..."
    docker-compose $COMPOSE_FILES build --no-cache
    docker-compose $COMPOSE_FILES up -d
    
    # Wait for service to be ready
    log_info "Waiting for service to be ready..."
    sleep 15
    
    # Health check
    log_info "Performing health check..."
    
    if [ "$ENV" = "production" ]; then
        HEALTH_URL="http://localhost:${HOST_PORT}/api/health"
    else
        HEALTH_URL="http://localhost:${HOST_PORT}/api/health"
    fi
    
    # Try health check multiple times
    for i in {1..10}; do
        if curl -f $HEALTH_URL >/dev/null 2>&1; then
            log_success "Service is healthy and running!"
            break
        else
            if [ $i -eq 10 ]; then
                log_warning "Health check failed. Service might still be starting..."
                log_info "Check logs with: ./deploy.sh $ENV logs"
            else
                log_info "Health check attempt $i/10 failed, retrying in 3 seconds..."
                sleep 3
            fi
        fi
    done
    
    log_success "Deployment completed!"
    log_info "🌐 Application available at: $ACCESS_URL"
    log_info "🔧 API available at: $ACCESS_URL/api"
    log_info "❤️  Health check: $ACCESS_URL/api/health"
    
    # Show container status
    echo ""
    log_info "Container status:"
    docker-compose $COMPOSE_FILES ps
}

# Stop service
stop() {
    log_info "Stopping services..."
    
    if [ "$ENV" = "production" ]; then
        COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
    else
        COMPOSE_FILES="-f docker-compose.yml"
    fi
    
    docker-compose $COMPOSE_FILES down
    log_success "Services stopped"
}

# Show logs
logs() {
    FOLLOW=${3:-""}
    
    if [ "$ENV" = "production" ]; then
        COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
    else
        COMPOSE_FILES="-f docker-compose.yml"
    fi
    
    if [ "$FOLLOW" = "follow" ] || [ "$FOLLOW" = "-f" ]; then
        docker-compose $COMPOSE_FILES logs -f $CONTAINER_NAME
    else
        docker-compose $COMPOSE_FILES logs --tail=50 $CONTAINER_NAME
    fi
}

# Restart service
restart() {
    log_info "Restarting service..."
    stop
    sleep 2
    deploy
}

# Backup data
backup() {
    log_info "Creating backup..."
    
    BACKUP_DIR="backup/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # Backup volumes
    docker run --rm -v radio_metadata:/source -v $(pwd)/$BACKUP_DIR:/backup alpine tar czf /backup/metadata.tar.gz -C /source .
    docker run --rm -v radio_logs:/source -v $(pwd)/$BACKUP_DIR:/backup alpine tar czf /backup/logs.tar.gz -C /source .
    
    log_success "Backup created at: $BACKUP_DIR"
}

# Show container status
status() {
    log_info "Container status:"
    
    if [ "$ENV" = "production" ]; then
        COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
    else
        COMPOSE_FILES="-f docker-compose.yml"
    fi
    
    docker-compose $COMPOSE_FILES ps
    
    echo ""
    log_info "Container resource usage:"
    docker stats --no-stream $CONTAINER_NAME 2>/dev/null || log_warning "Container not running"
    
    echo ""
    log_info "Volume information:"
    docker volume ls | grep radio_ || log_warning "No radio volumes found"
}

# Access container shell
shell() {
    log_info "Accessing container shell..."
    docker exec -it $CONTAINER_NAME sh
}

# Show usage
usage() {
    echo "Usage: $0 [environment] [command]"
    echo ""
    echo "Environments:"
    echo "  development (default)"
    echo "  production"
    echo ""
    echo "Commands:"
    echo "  deploy    - Build and deploy the application"
    echo "  stop      - Stop the service"
    echo "  restart   - Restart the service"
    echo "  logs      - Show application logs"
    echo "  status    - Show container status and resources"
    echo "  shell     - Access container shell"
    echo "  backup    - Create data backup"
    echo ""
    echo "Examples:"
    echo "  $0 development deploy"
    echo "  $0 production deploy"
    echo "  $0 development logs follow"
    echo "  $0 production backup"
    echo "  $0 development shell"
}

# Main script logic
case "${2:-deploy}" in
    deploy)
        deploy
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    logs)
        logs $@
        ;;
    status)
        status
        ;;
    shell)
        shell
        ;;
    backup)
        backup
        ;;
    *)
        usage
        exit 1
        ;;
esac