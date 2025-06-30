#!/bin/bash
# multi-deploy.sh - Deploy multiple radio station instances with complete isolation
# Usage: ./multi-deploy.sh 3400 3401 3402

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_TAG="radio-station:latest"

# Logging functions
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
}

# Build image once (only if needed)
build_image() {
    local rebuild_flag=$1
    
    if [[ "$rebuild_flag" == "--rebuild" ]] || ! docker image inspect $IMAGE_TAG >/dev/null 2>&1; then
        log_info "Building radio station image..."
        
        if [ ! -f "Dockerfile" ]; then
            log_error "Dockerfile not found in current directory"
            exit 1
        fi
        
        docker build -t $IMAGE_TAG . || {
            log_error "Failed to build image"
            exit 1
        }
        
        log_success "Image built successfully: $IMAGE_TAG"
    else
        log_info "Using existing image: $IMAGE_TAG"
    fi
}

# Deploy single instance with complete isolation
deploy_instance() {
    local port=$1
    local rebuild_flag=$2
    local container_name="radio-station-${port}"
    
    log_info "Deploying radio station instance on port $port..."
    
    # Validate port number
    if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
        log_error "Invalid port number: $port (must be 1024-65535)"
        return 1
    fi
    
    # Check if port is already in use
    if netstat -tuln 2>/dev/null | grep -q ":${port} " || ss -tuln 2>/dev/null | grep -q ":${port} "; then
        log_warning "Port $port appears to be in use"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 1
        fi
    fi
    
    # Build image if this is not a batch operation
    if [[ "$rebuild_flag" != "skip-build" ]]; then
        build_image $rebuild_flag
    fi
    
    # Stop and remove existing container if it exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        log_info "Stopping existing container: $container_name"
        docker stop $container_name 2>/dev/null || true
        docker rm $container_name 2>/dev/null || true
    fi
    
    # Create unique volumes for this instance (isolated data)
    log_info "Creating isolated volumes for port $port..."
    docker volume create radio-station-${port}_incoming 2>/dev/null || true
    docker volume create radio-station-${port}_reencoded 2>/dev/null || true
    docker volume create radio-station-${port}_metadata 2>/dev/null || true
    docker volume create radio-station-${port}_logs 2>/dev/null || true
    
    # Run container with completely isolated volumes and environment
    log_info "Starting container: $container_name"
    docker run -d \
        --name $container_name \
        --restart unless-stopped \
        -p ${port}:3000 \
        -v radio-station-${port}_incoming:/app/data/incoming \
        -v radio-station-${port}_reencoded:/app/data/reencoded \
        -v radio-station-${port}_metadata:/app/data/metadata \
        -v radio-station-${port}_logs:/app/data/logs \
        -e NODE_ENV=development \
        -e PORT=3000 \
        -e HOST_PORT=${port} \
        -e INCOMING_DIR=/app/data/incoming \
        -e REENCODED_DIR=/app/data/reencoded \
        -e METADATA_DIR=/app/data/metadata \
        -e LOGS_DIR=/app/data/logs \
        -e LOG_LEVEL=debug \
        -e MAX_CONCURRENT_ENCODING=2 \
        -e EXTERNAL_JANUS_IP=${EXTERNAL_JANUS_IP:-localhost} \
        -e EXTERNAL_JANUS_PORT=${EXTERNAL_JANUS_PORT:-8088} \
        $IMAGE_TAG || {
        log_error "Failed to start container on port $port"
        return 1
    }
    
    # Wait for container to start
    log_info "Waiting for service to initialize..."
    sleep 8
    
    # Health check with retries
    local health_url="http://localhost:${port}/api/health"
    local max_attempts=10
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f "$health_url" >/dev/null 2>&1; then
            log_success "✅ Radio station deployed successfully on port $port"
            log_info "🌐 Access at: http://localhost:$port"
            log_info "🔧 API at: http://localhost:$port/api"
            log_info "❤️  Health: http://localhost:$port/api/health"
            return 0
        else
            if [ $attempt -eq $max_attempts ]; then
                log_warning "⚠️  Service started but health check failed on port $port"
                log_info "🔍 Check logs: ./multi-deploy.sh logs $port"
                log_info "🌐 Try accessing: http://localhost:$port"
                return 0
            else
                log_info "Health check attempt $attempt/$max_attempts failed, retrying in 3 seconds..."
                sleep 3
                attempt=$((attempt + 1))
            fi
        fi
    done
}

# Deploy multiple instances efficiently (build once, deploy many)
deploy_multiple() {
    local args=("$@")
    local rebuild_flag=""
    local ports=()
    
    # Parse arguments for rebuild flag
    for arg in "${args[@]}"; do
        if [[ "$arg" == "--rebuild" ]]; then
            rebuild_flag="--rebuild"
        elif [[ "$arg" =~ ^[0-9]+$ ]]; then
            ports+=("$arg")
        fi
    done
    
    if [ ${#ports[@]} -eq 0 ]; then
        log_error "No valid port numbers provided"
        usage
        exit 1
    fi
    
    log_info "Deploying ${#ports[@]} radio station instances..."
    
    # Build image once for all instances
    build_image $rebuild_flag
    
    # Deploy each instance (skip individual build steps)
    local success_count=0
    local total_count=${#ports[@]}
    
    for port in "${ports[@]}"; do
        echo ""
        log_info "Deploying instance $((success_count + 1))/$total_count..."
        
        if deploy_instance $port "skip-build"; then
            success_count=$((success_count + 1))
        else
            log_error "Failed to deploy instance on port $port"
        fi
    done
    
    echo ""
    log_success "Deployment completed: $success_count/$total_count instances deployed successfully"
    
    if [ $success_count -gt 0 ]; then
        show_status
    fi
}

# Show running instances with detailed information
show_status() {
    echo ""
    log_info "Radio Station Instances Status:"
    echo "=================================="
    
    # Check for running instances
    local running_containers=$(docker ps --filter "name=radio-station-" --format "{{.Names}}" 2>/dev/null)
    
    if [ -z "$running_containers" ]; then
        echo "No radio station instances are currently running."
        echo ""
        return
    fi
    
    # Show detailed status
    printf "%-20s %-15s %-15s %-20s\n" "CONTAINER" "PORT" "STATUS" "UPTIME"
    echo "--------------------------------------------------------------------------------"
    
    while IFS= read -r container; do
        if [ -n "$container" ]; then
            local port=$(echo "$container" | sed 's/radio-station-//')
            local status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")
            local uptime=$(docker inspect --format='{{.State.StartedAt}}' "$container" 2>/dev/null | xargs -I {} date -d {} +"%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "unknown")
            
            printf "%-20s %-15s %-15s %-20s\n" "$container" "$port" "$status" "$uptime"
        fi
    done <<< "$running_containers"
    
    echo ""
    
    # Show volume information
    log_info "Storage Volumes:"
    echo "================"
    local volume_count=$(docker volume ls --filter "name=radio-station-" --format "{{.Name}}" 2>/dev/null | wc -l)
    echo "Total volumes: $volume_count"
    
    # Show first few volumes as examples
    docker volume ls --filter "name=radio-station-" --format "{{.Name}}" 2>/dev/null | head -8 | while read volume; do
        if [ -n "$volume" ]; then
            echo "  • $volume"
        fi
    done
    
    if [ "$volume_count" -gt 8 ]; then
        echo "  ... and $((volume_count - 8)) more"
    fi
    
    echo ""
}

# Stop specific instance
stop_instance() {
    local port=$1
    local container_name="radio-station-${port}"
    
    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
        log_error "Invalid port number: $port"
        return 1
    fi
    
    log_info "Stopping radio station instance on port $port..."
    
    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        docker stop $container_name 2>/dev/null || true
        docker rm $container_name 2>/dev/null || true
        log_success "Stopped and removed: $container_name"
    else
        log_warning "No running container found for port $port"
    fi
}

# Stop all radio station instances
stop_all() {
    log_info "Stopping all radio station instances..."
    
    local containers=$(docker ps --filter "name=radio-station-" -q 2>/dev/null)
    
    if [ -z "$containers" ]; then
        log_info "No running radio station instances found"
        return
    fi
    
    # Stop all containers
    echo "$containers" | xargs -r docker stop
    
    # Remove all containers
    local all_containers=$(docker ps -a --filter "name=radio-station-" -q 2>/dev/null)
    if [ -n "$all_containers" ]; then
        echo "$all_containers" | xargs -r docker rm
    fi
    
    log_success "All radio station instances stopped and removed"
}

# Clean up everything (containers + volumes)
clean_all() {
    log_warning "This will remove ALL radio station containers and volumes!"
    read -p "Are you sure? This will delete all data! (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Stop and remove containers
        stop_all
        
        # Remove volumes
        log_info "Removing all radio station volumes..."
        local volumes=$(docker volume ls --filter "name=radio-station-" -q 2>/dev/null)
        if [ -n "$volumes" ]; then
            echo "$volumes" | xargs -r docker volume rm
            log_success "All volumes removed"
        else
            log_info "No volumes to remove"
        fi
        
        # Remove image if requested
        read -p "Also remove the radio-station image? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker rmi $IMAGE_TAG 2>/dev/null || log_info "Image not found or in use"
        fi
        
        log_success "Complete cleanup finished"
    else
        log_info "Cleanup cancelled"
    fi
}

# Show logs for specific instance
show_logs() {
    local port=$1
    local container_name="radio-station-${port}"
    
    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
        log_error "Invalid port number: $port"
        return 1
    fi
    
    if ! docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        log_error "No running container found for port $port"
        return 1
    fi
    
    log_info "Showing logs for radio-station-$port (press Ctrl+C to exit)..."
    echo ""
    docker logs -f "$container_name"
}

# Show usage information
usage() {
    echo "Radio Station Multi-Instance Deployment Tool"
    echo "============================================"
    echo ""
    echo "Usage:"
    echo "  $0 <port>                      Deploy single instance on specified port"
    echo "  $0 <port1> <port2> <port3>     Deploy multiple instances"
    echo "  $0 --rebuild <port>            Rebuild image and deploy single instance"
    echo "  $0 --rebuild <port1> <port2>   Rebuild image and deploy multiple instances"
    echo ""
    echo "Management Commands:"
    echo "  $0 status                      Show all running instances"
    echo "  $0 stop <port>                 Stop specific instance"
    echo "  $0 stop-all                    Stop all instances"
    echo "  $0 logs <port>                 Show real-time logs for instance"
    echo "  $0 clean                       Remove all containers and volumes"
    echo "  $0 build                       Build/rebuild image only"
    echo ""
    echo "Examples:"
    echo "  $0 3400                        Deploy single instance on port 3400"
    echo "  $0 3400 3401 3402              Deploy 3 instances on ports 3400, 3401, 3402"
    echo "  $0 --rebuild 3400              Rebuild image and deploy on port 3400"
    echo "  $0 stop 3401                   Stop instance on port 3401"
    echo "  $0 logs 3400                   Show logs for port 3400"
    echo "  $0 status                      Show all running instances"
    echo ""
    echo "Features:"
    echo "  • Complete data isolation per instance"
    echo "  • Build once, deploy multiple times"
    echo "  • Health checks and status monitoring"
    echo "  • Easy management and cleanup"
    echo ""
    echo "Each instance gets isolated volumes:"
    echo "  radio-station-<PORT>_incoming"
    echo "  radio-station-<PORT>_reencoded"
    echo "  radio-station-<PORT>_metadata"
    echo "  radio-station-<PORT>_logs"
}

# Main script logic
main() {
    # Check if Docker is available
    check_docker
    
    # Handle commands
    case "$1" in
        # Management commands
        status)
            show_status
            ;;
        stop)
            if [[ "$2" =~ ^[0-9]+$ ]]; then
                stop_instance $2
            else
                log_error "Usage: $0 stop <port>"
                exit 1
            fi
            ;;
        stop-all)
            stop_all
            ;;
        logs)
            if [[ "$2" =~ ^[0-9]+$ ]]; then
                show_logs $2
            else
                log_error "Usage: $0 logs <port>"
                exit 1
            fi
            ;;
        clean)
            clean_all
            ;;
        build)
            build_image "--rebuild"
            ;;
        help|--help|-h)
            usage
            ;;
        "")
            log_error "No command specified"
            usage
            exit 1
            ;;
        *)
            # Check if all arguments are valid (ports or --rebuild)
            local valid_args=true
            for arg in "$@"; do
                if [[ "$arg" != "--rebuild" ]] && ! [[ "$arg" =~ ^[0-9]+$ ]]; then
                    valid_args=false
                    break
                fi
            done
            
            if [ "$valid_args" = true ]; then
                if [[ $# -eq 1 ]] && [[ "$1" =~ ^[0-9]+$ ]]; then
                    # Single port deployment
                    deploy_instance $1
                else
                    # Multiple ports or rebuild + ports
                    deploy_multiple "$@"
                fi
            else
                log_error "Invalid arguments. Use ports (numbers) and/or --rebuild flag only."
                usage
                exit 1
            fi
            ;;
    esac
}

# Run main function with all arguments
main "$@"