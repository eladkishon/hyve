#!/bin/bash
# hyve/lib/services-docker.sh - Docker-based service orchestration
# Provides complete isolation using Docker containers with volume-mounted code

# Simple "up" command - start workspace and open browsers
cmd_up() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve up <feature-name>"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        log_info "Create it with: hyve create $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")

    # Check if docker-compose.yaml exists
    if [ ! -f "$workspace_dir/docker-compose.yaml" ]; then
        log_error "No docker-compose.yaml found in workspace"
        log_info "This workspace may not have Docker mode enabled"
        exit 1
    fi

    echo ""
    print_logo
    echo ""
    log_info "Starting workspace ${BOLD}$feature_name${NC}"
    echo ""

    cd "$workspace_dir"

    # Start all services (--profile all starts all application services)
    log_step "Starting Docker services..."
    docker compose --profile all up -d

    # Wait for services to be ready
    log_step "Waiting for services to start..."
    sleep 5

    # Get port configuration for display and browser opening
    local workspace_index=$(get_workspace_index "$feature_name")
    local port_offset=$(get_services_port_offset)
    local base_port=$(get_services_base_port)
    local workspace_base=$((base_port + (workspace_index * port_offset)))
    local db_base_port=$(get_db_base_port)

    echo ""
    divider
    echo ""
    echo -e "${GREEN}${BOLD}Workspace Running${NC}"
    echo ""

    local config=$(get_workspace_config "$feature_name")
    local repos=$(jq -r '.repos[]' "$config" 2>/dev/null)
    local urls_to_open=()

    for repo in $repos; do
        local port=""
        local url=""
        case "$repo" in
            server)
                port=$((workspace_base + 0))
                echo -e "  ${CYAN}server${NC}              →  localhost:$port"
                ;;
            socketio)
                port=$((workspace_base + 2))
                echo -e "  ${CYAN}socketio${NC}            →  localhost:$port"
                ;;
            webapp)
                port=$((workspace_base + 1))
                url="http://localhost:$port"
                echo -e "  ${CYAN}webapp${NC}              →  $url"
                urls_to_open+=("$url")
                ;;
            rn-platform-website)
                port=$((workspace_base + 12))
                url="http://localhost:$port"
                echo -e "  ${CYAN}rn-platform-website${NC} →  $url"
                urls_to_open+=("$url")
                ;;
            patients-app)
                port=$((workspace_base + 73))
                url="http://localhost:$port"
                echo -e "  ${CYAN}patients-app${NC}        →  $url"
                urls_to_open+=("$url")
                ;;
            mobile)
                port=$((workspace_base + 80))
                url="http://localhost:$port"
                echo -e "  ${CYAN}mobile${NC}              →  $url"
                urls_to_open+=("$url")
                ;;
        esac
    done

    echo ""
    echo -e "  ${DIM}Database:${NC}  localhost:$((db_base_port + workspace_index))"
    echo ""

    # Open browsers
    if [ ${#urls_to_open[@]} -gt 0 ]; then
        log_step "Opening browsers..."
        for url in "${urls_to_open[@]}"; do
            if command -v open &> /dev/null; then
                open "$url" 2>/dev/null &
            elif command -v xdg-open &> /dev/null; then
                xdg-open "$url" 2>/dev/null &
            fi
            sleep 0.5
        done
        log_success "Opened ${#urls_to_open[@]} browser tab(s)"
    fi

    echo ""
    echo -e "  ${DIM}Stop with:${NC}  hyve down $feature_name"
    echo -e "  ${DIM}Logs:${NC}       hyve docker-logs $feature_name -f"
    echo ""
}

# Get Docker compose template path from config or default location
get_docker_template() {
    local config_file=$(find_config)
    local project_root=$(get_project_root)

    # Check for template path in .hyve.yaml
    if [ -n "$config_file" ] && command -v yq &> /dev/null; then
        local configured_template=$(yq eval '.docker.template // ""' "$config_file" 2>/dev/null)
        if [ -n "$configured_template" ] && [ "$configured_template" != "null" ]; then
            # Resolve relative to project root
            if [[ "$configured_template" != /* ]]; then
                configured_template="$project_root/$configured_template"
            fi
            if [ -f "$configured_template" ]; then
                echo "$configured_template"
                return
            fi
        fi
    fi

    # Default locations to check
    local default_locations=(
        "$project_root/.hyve/docker-compose.template.yaml"
        "$project_root/.hyve/docker-compose.template.yml"
        "$project_root/docker-compose.hyve.yaml"
    )

    for loc in "${default_locations[@]}"; do
        if [ -f "$loc" ]; then
            echo "$loc"
            return
        fi
    done

    # No template found
    echo ""
}

# Generate docker-compose.yaml for a workspace
generate_docker_compose() {
    local feature_name=$1
    local workspace_dir=$(get_workspace_dir "$feature_name")
    local template_file=$(get_docker_template)
    local output_file="$workspace_dir/docker-compose.yaml"

    # Get workspace config
    local config=$(get_workspace_config "$feature_name")
    local repos=$(jq -r '.repos[]' "$config" 2>/dev/null)

    # Get port configuration
    local workspace_index=$(get_workspace_index "$feature_name")
    local port_offset=$(get_services_port_offset)
    local base_port=$(get_services_base_port)
    local workspace_base=$((base_port + (workspace_index * port_offset)))

    # Calculate ports for each service
    local server_port=$((workspace_base + 0))
    local webapp_port=$((workspace_base + 1))
    local socketio_port=$((workspace_base + 2))
    local rn_platform_port=$((workspace_base + 12))
    local patients_app_port=$((workspace_base + 73))
    local mobile_port=$((workspace_base + 80))

    # Database port
    local db_base_port=$(get_db_base_port)
    local db_port=$((db_base_port + workspace_index))

    # Database credentials
    local db_user=$(get_db_user)
    local db_pass=$(get_db_password)
    local db_name=$(get_db_name)

    # Read template and replace placeholders
    if [ ! -f "$template_file" ]; then
        log_error "Docker compose template not found: $template_file"
        return 1
    fi

    # Use absolute path for workspace directory
    local abs_workspace_dir=$(cd "$workspace_dir" && pwd)

    sed -e "s|{{WORKSPACE_NAME}}|$feature_name|g" \
        -e "s|{{WORKSPACE_DIR}}|$abs_workspace_dir|g" \
        -e "s|{{GENERATED_AT}}|$(date -u +%Y-%m-%dT%H:%M:%SZ)|g" \
        -e "s|{{DB_USER}}|$db_user|g" \
        -e "s|{{DB_PASSWORD}}|$db_pass|g" \
        -e "s|{{DB_NAME}}|$db_name|g" \
        -e "s|{{DB_PORT}}|$db_port|g" \
        -e "s|{{SERVER_PORT}}|$server_port|g" \
        -e "s|{{WEBAPP_PORT}}|$webapp_port|g" \
        -e "s|{{SOCKETIO_PORT}}|$socketio_port|g" \
        -e "s|{{RN_PLATFORM_PORT}}|$rn_platform_port|g" \
        -e "s|{{PATIENTS_APP_PORT}}|$patients_app_port|g" \
        -e "s|{{MOBILE_PORT}}|$mobile_port|g" \
        "$template_file" > "$output_file"

    # Filter out services that don't exist in this workspace
    local temp_file=$(mktemp)
    cp "$output_file" "$temp_file"

    # Check each service and remove if not in workspace
    for service in server socketio webapp rn-platform-website patients-app mobile; do
        local has_service=false
        for repo in $repos; do
            if [ "$repo" = "$service" ]; then
                has_service=true
                break
            fi
        done

        if ! $has_service; then
            # Remove the service section from docker-compose
            # This is a simplified removal - in production you might use yq
            log_info "Skipping service $service (not in workspace)"
        fi
    done

    echo "$output_file"
}

# Clone database from source into Docker container
clone_database_docker() {
    local feature_name=$1
    local workspace_dir=$(get_workspace_dir "$feature_name")
    local source_port=$(get_db_source_port)
    local db_user=$(get_db_user)
    local db_pass=$(get_db_password)
    local db_name=$(get_db_name)
    local container_name="hyve-${feature_name}-postgres"

    # Check if source database is accessible
    if ! PGPASSWORD="$db_pass" psql -h localhost -p "$source_port" -U "$db_user" -d "$db_name" -c "SELECT 1" >/dev/null 2>&1; then
        log_info "Source database not available, starting with empty database"
        return
    fi

    log_step "Cloning database from port $source_port..."

    # Wait for container to be ready
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker exec "$container_name" pg_isready -U "$db_user" >/dev/null 2>&1; then
            break
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    if [ $attempt -eq $max_attempts ]; then
        log_warning "Database container not ready for cloning"
        return 1
    fi

    # Clone using pg_dump piped to container
    if docker exec "$container_name" sh -c "PGPASSWORD='$db_pass' pg_dump -h host.docker.internal -p $source_port -U $db_user $db_name | PGPASSWORD='$db_pass' psql -U $db_user -d $db_name" >/dev/null 2>&1; then
        log_success "Database cloned successfully"
    else
        # Fallback: try docker bridge IP (Linux)
        if docker exec "$container_name" sh -c "PGPASSWORD='$db_pass' pg_dump -h 172.17.0.1 -p $source_port -U $db_user $db_name | PGPASSWORD='$db_pass' psql -U $db_user -d $db_name" >/dev/null 2>&1; then
            log_success "Database cloned successfully"
        else
            log_warning "Could not clone database, starting with empty database"
        fi
    fi
}

# Start services using Docker Compose
cmd_docker_run() {
    local feature_name=""
    local services_to_run=()
    local detached=true
    local skip_clone=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --attach|-a)
                detached=false
                shift
                ;;
            --skip-clone)
                skip_clone=true
                shift
                ;;
            *)
                if [ -z "$feature_name" ]; then
                    feature_name="$1"
                else
                    services_to_run+=("$1")
                fi
                shift
                ;;
        esac
    done

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo ""
        echo "Usage: hyve docker-run <feature-name> [services...]"
        echo ""
        echo "Options:"
        echo "  --attach, -a     Run in foreground (see all logs)"
        echo "  --skip-clone     Don't clone the database"
        echo ""
        echo "Examples:"
        echo "  hyve docker-run my-feature                    # Run all services"
        echo "  hyve docker-run my-feature server webapp      # Run specific services"
        echo "  hyve docker-run my-feature -a                 # Run attached (foreground)"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        log_info "Create it with: hyve create $feature_name [repos...]"
        exit 1
    fi

    echo ""
    print_logo
    echo ""
    log_info "Starting Docker services for ${BOLD}$feature_name${NC}"
    echo ""

    local workspace_dir=$(get_workspace_dir "$feature_name")

    # Generate docker-compose.yaml
    log_step "Generating docker-compose.yaml..."
    local compose_file=$(generate_docker_compose "$feature_name")
    log_success "Generated $compose_file"
    echo ""

    # Determine which profiles to use
    local profiles=""
    if [ ${#services_to_run[@]} -eq 0 ]; then
        # Run all services
        profiles="--profile all"
    else
        # Run specific services
        for svc in "${services_to_run[@]}"; do
            profiles="$profiles --profile $svc"
        done
    fi

    # Start infrastructure first (postgres)
    log_step "Starting infrastructure (postgres)..."
    cd "$workspace_dir"
    docker compose up -d postgres

    # Wait for infrastructure to be healthy
    log_step "Waiting for postgres to be ready..."
    local max_wait=60
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if docker exec "hyve-${feature_name}-postgres" pg_isready -U "$(get_db_user)" >/dev/null 2>&1; then
            break
        fi

        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done
    echo ""

    if [ $waited -ge $max_wait ]; then
        log_warning "Infrastructure may not be fully ready"
    else
        log_success "Infrastructure ready"
    fi

    # Clone database if requested
    if ! $skip_clone; then
        clone_database_docker "$feature_name"
    fi

    echo ""

    # Start application services
    log_step "Starting application services..."
    if $detached; then
        docker compose $profiles up -d
    else
        docker compose $profiles up
        return
    fi

    echo ""
    divider
    echo ""

    # Get port configuration for display
    local workspace_index=$(get_workspace_index "$feature_name")
    local port_offset=$(get_services_port_offset)
    local base_port=$(get_services_base_port)
    local workspace_base=$((base_port + (workspace_index * port_offset)))
    local db_base_port=$(get_db_base_port)

    echo -e "${GREEN}${BOLD}Docker Services Running${NC}"
    echo ""
    echo -e "  ${DIM}Infrastructure:${NC}"
    echo -e "    postgres    →  localhost:$((db_base_port + workspace_index))"
    echo ""
    echo -e "  ${DIM}Applications:${NC}"

    local config=$(get_workspace_config "$feature_name")
    local repos=$(jq -r '.repos[]' "$config" 2>/dev/null)

    for repo in $repos; do
        local port=""
        local url=""
        case "$repo" in
            server)
                port=$((workspace_base + 0))
                ;;
            socketio)
                port=$((workspace_base + 2))
                ;;
            webapp)
                port=$((workspace_base + 1))
                url="http://localhost:$port"
                ;;
            rn-platform-website)
                port=$((workspace_base + 12))
                url="http://localhost:$port"
                ;;
            patients-app)
                port=$((workspace_base + 73))
                url="http://localhost:$port"
                ;;
            mobile)
                port=$((workspace_base + 80))
                url="http://localhost:$port"
                ;;
        esac

        if [ -n "$port" ]; then
            if [ -n "$url" ]; then
                echo -e "    ${CYAN}$repo${NC}  →  $url"
            else
                echo -e "    ${CYAN}$repo${NC}  →  localhost:$port"
            fi
        fi
    done

    echo ""
    echo -e "  ${DIM}Commands:${NC}"
    echo -e "    Logs:    hyve docker-logs $feature_name [service]"
    echo -e "    Stop:    hyve docker-halt $feature_name"
    echo -e "    Status:  hyve docker-status $feature_name"
    echo -e "    Shell:   docker exec -it hyve-${feature_name}-server sh"
    echo ""
}

# Stop all Docker services for a workspace
cmd_docker_halt() {
    local feature_name=$1
    local remove_volumes=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--volumes)
                remove_volumes=true
                shift
                ;;
            *)
                if [ -z "$feature_name" ]; then
                    feature_name="$1"
                fi
                shift
                ;;
        esac
    done

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve docker-halt <feature-name> [-v|--volumes]"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    echo ""
    print_logo
    echo ""
    log_info "Stopping Docker services for ${BOLD}$feature_name${NC}"
    echo ""

    local workspace_dir=$(get_workspace_dir "$feature_name")
    cd "$workspace_dir"

    if $remove_volumes; then
        log_step "Stopping and removing containers and volumes..."
        docker compose down -v
    else
        log_step "Stopping containers..."
        docker compose down
    fi

    echo ""
    log_success "All Docker services stopped"
    echo ""
}

# Show Docker service status
cmd_docker_status() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve docker-status <feature-name>"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")

    if [ ! -f "$workspace_dir/docker-compose.yaml" ]; then
        log_error "No docker-compose.yaml found. Run 'hyve docker-run $feature_name' first."
        exit 1
    fi

    echo ""
    print_logo
    section "Docker Status: $feature_name"
    echo ""

    cd "$workspace_dir"
    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
    echo ""
}

# View Docker service logs
cmd_docker_logs() {
    local feature_name=""
    local service_name=""
    local follow=false
    local tail_lines=100

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--follow)
                follow=true
                shift
                ;;
            -n|--tail)
                tail_lines=$2
                shift 2
                ;;
            *)
                if [ -z "$feature_name" ]; then
                    feature_name="$1"
                elif [ -z "$service_name" ]; then
                    service_name="$1"
                fi
                shift
                ;;
        esac
    done

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve docker-logs <feature-name> [service] [-f] [-n lines]"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    cd "$workspace_dir"

    local follow_flag=""
    if $follow; then
        follow_flag="-f"
    fi

    if [ -n "$service_name" ]; then
        docker compose logs $follow_flag --tail $tail_lines "$service_name"
    else
        docker compose logs $follow_flag --tail $tail_lines
    fi
}

# Execute command in a Docker service container
cmd_docker_exec() {
    local feature_name=$1
    local service_name=$2
    shift 2
    local cmd="${@:-sh}"

    if [ -z "$feature_name" ] || [ -z "$service_name" ]; then
        log_error "Feature name and service name required"
        echo "Usage: hyve docker-exec <feature-name> <service> [command]"
        echo ""
        echo "Examples:"
        echo "  hyve docker-exec my-feature server          # Open shell"
        echo "  hyve docker-exec my-feature server pnpm test"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    cd "$workspace_dir"

    docker compose exec "$service_name" $cmd
}

# Restart a specific Docker service
cmd_docker_restart() {
    local feature_name=$1
    local service_name=$2

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve docker-restart <feature-name> [service]"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    cd "$workspace_dir"

    if [ -n "$service_name" ]; then
        log_step "Restarting $service_name..."
        docker compose restart "$service_name"
    else
        log_step "Restarting all services..."
        docker compose restart
    fi

    log_success "Restart complete"
}

# Rebuild Docker service (useful after package.json changes)
cmd_docker_rebuild() {
    local feature_name=$1
    local service_name=$2

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve docker-rebuild <feature-name> [service]"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    cd "$workspace_dir"

    if [ -n "$service_name" ]; then
        log_step "Rebuilding $service_name..."
        docker compose up -d --build --force-recreate "$service_name"
    else
        log_step "Rebuilding all services..."
        docker compose up -d --build --force-recreate
    fi

    log_success "Rebuild complete"
}
