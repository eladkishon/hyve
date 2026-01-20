#!/bin/bash
# hyve/lib/services.sh - Multi-service orchestration for feature workspaces

# Run pre-start script for a service
run_prestart_script() {
    local feature_name=$1
    local service_name=$2
    local service_dir=$3
    local project_root=$(get_project_root)

    # Special handling for rn-platform-website: copy schema from main repo
    if [ "$service_name" = "rn-platform-website" ]; then
        local main_schema="$project_root/rn-platform-website/src/schema/schema.ts"
        local workspace_schema="$service_dir/src/schema/schema.ts"

        if [ -f "$main_schema" ]; then
            mkdir -p "$(dirname "$workspace_schema")"
            cp "$main_schema" "$workspace_schema" 2>/dev/null || true
        fi

        # Clear Vite cache to prevent crypto errors with symlinked node_modules
        rm -rf "$project_root/rn-platform-website/node_modules/.vite" 2>/dev/null || true
    fi
}

# Get workspace index (for port calculation)
get_workspace_index() {
    local feature_name=$1
    local workspaces_dir=$(get_workspaces_dir)
    local index=0

    # Sort workspaces by creation date to get stable indices
    for dir in $(ls -1dt "$workspaces_dir"/*/ 2>/dev/null); do
        local name=$(basename "$dir")
        if [ "$name" = "$feature_name" ]; then
            echo $index
            return
        fi
        index=$((index + 1))
    done

    # New workspace gets next index
    echo $index
}

# Get services config values
get_services_port_offset() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.services.port_offset' '1000'
}

get_services_base_port() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.services.base_port' '4000'
}

# Calculate port for a service in a workspace
# Uses default_port from config: workspace_port = base_port + (default_port - 3000) + (index * offset)
calculate_service_port() {
    local feature_name=$1
    local service_name=$2
    local default_port=$3

    local index=$(get_workspace_index "$feature_name")
    local port_offset=$(get_services_port_offset)
    local base_port=$(get_services_base_port)

    # Calculate workspace base port
    local workspace_base=$((base_port + (index * port_offset)))

    # Get default_port from config if not provided
    if [ -z "$default_port" ] || [ "$default_port" = "0" ]; then
        local config_file=$(find_config)
        if [ -n "$config_file" ] && command -v yq &> /dev/null; then
            default_port=$(yq eval ".services.definitions.$service_name.default_port" "$config_file" 2>/dev/null)
        fi
    fi

    # If still no default port, use fallback
    if [ -z "$default_port" ] || [ "$default_port" = "null" ]; then
        default_port=3000
    fi

    # Service offset is calculated from default_port
    local service_offset=$((default_port - 3000))

    echo $((workspace_base + service_offset))
}

# Get all services for a workspace
get_workspace_services() {
    local feature_name=$1
    local config=$(get_workspace_config "$feature_name")
    local repos=$(jq -r '.repos[]' "$config" 2>/dev/null)

    # Map repos to service names
    for repo in $repos; do
        case "$repo" in
            server|webapp|socketio|mobile|patients-app|rn-platform-website)
                echo "$repo"
                ;;
        esac
    done
}

# Generate .env.services file for a workspace
generate_services_env() {
    local feature_name=$1
    local workspace_dir=$(get_workspace_dir "$feature_name")
    local env_file="$workspace_dir/.env.services"

    local services=$(get_workspace_services "$feature_name")

    # Calculate all ports first
    local server_port=$(calculate_service_port "$feature_name" "server" 3000)
    local webapp_port=$(calculate_service_port "$feature_name" "webapp" 3001)
    local socketio_port=$(calculate_service_port "$feature_name" "socketio" 3002)
    local rn_platform_port=$(calculate_service_port "$feature_name" "rn-platform-website" 3012)
    local patients_app_port=$(calculate_service_port "$feature_name" "patients-app" 5173)
    local mobile_port=$(calculate_service_port "$feature_name" "mobile" 8080)

    # Get database port if available
    local config=$(get_workspace_config "$feature_name")
    local db_port=$(jq -r '.database.port // empty' "$config" 2>/dev/null)

    cat > "$env_file" << EOF
# Hyve Services Environment
# Workspace: $feature_name
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
#
# These ports are calculated based on workspace index to avoid conflicts
# when running multiple features simultaneously.

# Service Ports
SERVER_PORT=$server_port
WEBAPP_PORT=$webapp_port
SOCKETIO_PORT=$socketio_port
RN_PLATFORM_PORT=$rn_platform_port
PATIENTS_APP_PORT=$patients_app_port
MOBILE_PORT=$mobile_port

# API URLs for frontends
API_BASE_URL=http://localhost:$server_port
VITE_API_BASE_URL=http://localhost:$server_port
SOCKET_URL=http://localhost:$socketio_port
VITE_SOCKET_URL=http://localhost:$socketio_port
EOF

    if [ -n "$db_port" ]; then
        cat >> "$env_file" << EOF

# Database
DATABASE_PORT=$db_port
EOF
    fi

    echo "$env_file"
}

# Start a single service in a workspace
start_service() {
    local feature_name=$1
    local service_name=$2
    local workspace_dir=$(get_workspace_dir "$feature_name")
    local service_dir="$workspace_dir/$service_name"

    if [ ! -d "$service_dir" ]; then
        log_warning "Service directory not found: $service_dir"
        return 1
    fi

    # Get port for this service (for display purposes)
    local port
    case "$service_name" in
        server)              port=$(calculate_service_port "$feature_name" "server" 3000) ;;
        webapp)              port=$(calculate_service_port "$feature_name" "webapp" 3001) ;;
        socketio)            port=$(calculate_service_port "$feature_name" "socketio" 3002) ;;
        rn-platform-website) port=$(calculate_service_port "$feature_name" "rn-platform-website" 3012) ;;
        patients-app)        port=$(calculate_service_port "$feature_name" "patients-app" 5173) ;;
        mobile)              port=$(calculate_service_port "$feature_name" "mobile" 8080) ;;
    esac

    # Create log directory
    local log_dir="$workspace_dir/.hyve/logs"
    mkdir -p "$log_dir"

    # Create PID directory
    local pid_dir="$workspace_dir/.hyve/pids"
    mkdir -p "$pid_dir"

    local log_file="$log_dir/$service_name.log"
    local pid_file="$pid_dir/$service_name.pid"

    # Check if already running
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log_info "$service_name already running (PID $pid) on port $port"
            return 0
        fi
        rm -f "$pid_file"
    fi

    log_step "Starting ${BOLD}$service_name${NC} on port ${CYAN}$port${NC}"

    # Run pre-start script if it exists
    run_prestart_script "$feature_name" "$service_name" "$service_dir"

    # Get config file and dev command
    local config_file=$(find_config)
    local dev_command="pnpm dev"
    if [ -n "$config_file" ] && command -v yq &> /dev/null; then
        local configured_cmd=$(yq eval ".services.definitions.$service_name.dev_command // \"\"" "$config_file" 2>/dev/null)
        if [ -n "$configured_cmd" ] && [ "$configured_cmd" != "null" ]; then
            dev_command="$configured_cmd"
        fi
    fi

    # Get shell wrapper from config (e.g., for nvm, volta, etc.)
    local shell_wrapper=""
    if [ -n "$config_file" ] && command -v yq &> /dev/null; then
        shell_wrapper=$(yq eval ".services.shell_wrapper // \"\"" "$config_file" 2>/dev/null)
        if [ "$shell_wrapper" = "null" ]; then
            shell_wrapper=""
        fi
    fi

    # Start the service
    cd "$service_dir"

    # Source the workspace .env.services file to get all environment variables
    local workspace_dir=$(get_workspace_dir "$feature_name")
    local env_services_file="$workspace_dir/.env.services"

    # Apply shell wrapper if configured, otherwise run command directly
    if [ -n "$shell_wrapper" ]; then
        nohup bash -c "cd '$service_dir' && $shell_wrapper $dev_command" > "$log_file" 2>&1 &
    else
        nohup bash -c "cd '$service_dir' && $dev_command" > "$log_file" 2>&1 &
    fi

    local bg_pid=$!
    echo "$bg_pid" > "$pid_file"

    # Wait a moment and check if it started
    sleep 2
    if kill -0 "$bg_pid" 2>/dev/null; then
        log_success "$service_name started (PID $bg_pid)"
        return 0
    fi

    log_error "Failed to start $service_name - check $log_file"
    return 1
}

# Stop a single service
stop_service() {
    local feature_name=$1
    local service_name=$2
    local workspace_dir=$(get_workspace_dir "$feature_name")
    local pid_file="$workspace_dir/.hyve/pids/$service_name.pid"

    if [ ! -f "$pid_file" ]; then
        log_info "$service_name not running"
        return 0
    fi

    local pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
        log_step "Stopping $service_name (PID $pid)"
        kill "$pid" 2>/dev/null

        # Wait for graceful shutdown
        local count=0
        while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
            sleep 0.5
            count=$((count + 1))
        done

        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null
        fi

        log_success "$service_name stopped"
    fi

    rm -f "$pid_file"
}

# Run all services for a workspace
cmd_run() {
    local feature_name=""
    local services_to_run=()

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
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
        echo "Usage: hyve run <feature-name> [services...]"
        echo ""
        echo "Examples:"
        echo "  hyve run my-feature                    # Run all services"
        echo "  hyve run my-feature server webapp      # Run specific services"
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
    log_info "Starting services for ${BOLD}$feature_name${NC}"
    echo ""

    # Generate services env file
    local env_file=$(generate_services_env "$feature_name")
    log_success "Generated $env_file"
    echo ""

    # Get services to run
    if [ ${#services_to_run[@]} -eq 0 ]; then
        services_to_run=($(get_workspace_services "$feature_name"))
    fi

    if [ ${#services_to_run[@]} -eq 0 ]; then
        log_warning "No services found in workspace"
        exit 1
    fi

    # Start database first if configured
    local config=$(get_workspace_config "$feature_name")
    local db_container=$(jq -r '.database.container // empty' "$config" 2>/dev/null)
    if [ -n "$db_container" ]; then
        if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
            log_step "Starting database..."
            docker start "$db_container" >/dev/null 2>&1
            log_success "Database started"
            echo ""
        fi
    fi

    # Determine service startup order (server first, then others)
    local ordered_services=()

    # Server first
    for svc in "${services_to_run[@]}"; do
        if [ "$svc" = "server" ]; then
            ordered_services+=("$svc")
        fi
    done

    # Socketio second
    for svc in "${services_to_run[@]}"; do
        if [ "$svc" = "socketio" ]; then
            ordered_services+=("$svc")
        fi
    done

    # Then frontends
    for svc in "${services_to_run[@]}"; do
        if [ "$svc" != "server" ] && [ "$svc" != "socketio" ]; then
            ordered_services+=("$svc")
        fi
    done

    # Start services
    local started_services=()
    for service in "${ordered_services[@]}"; do
        if start_service "$feature_name" "$service"; then
            started_services+=("$service")
        fi

        # Wait a bit between services to let server start first
        if [ "$service" = "server" ]; then
            sleep 2
        fi
    done

    echo ""
    divider
    echo ""

    # Show summary
    echo -e "${GREEN}${BOLD}Services Running${NC}"
    echo ""

    local workspace_dir=$(get_workspace_dir "$feature_name")
    for service in "${started_services[@]}"; do
        local port
        case "$service" in
            server)              port=$(calculate_service_port "$feature_name" "server" 3000) ;;
            webapp)              port=$(calculate_service_port "$feature_name" "webapp" 3001) ;;
            socketio)            port=$(calculate_service_port "$feature_name" "socketio" 3002) ;;
            rn-platform-website) port=$(calculate_service_port "$feature_name" "rn-platform-website" 3012) ;;
            patients-app)        port=$(calculate_service_port "$feature_name" "patients-app" 5173) ;;
            mobile)              port=$(calculate_service_port "$feature_name" "mobile" 8080) ;;
        esac
        echo -e "  ${CYAN}$service${NC}  →  http://localhost:$port"
    done

    echo ""
    echo -e "  ${DIM}Logs:${NC} $workspace_dir/.hyve/logs/"
    echo -e "  ${DIM}Stop:${NC} hyve halt $feature_name"
    echo ""

    # Auto-open browsers after services are started
    log_step "Opening browsers..."
    sleep 2  # Give services a moment to fully start

    local opened_count=0
    for service in "${started_services[@]}"; do
        local port
        local url=""

        case "$service" in
            server|socketio)
                # Server and socketio don't have web UIs, skip
                continue
                ;;
            webapp)
                port=$(calculate_service_port "$feature_name" "webapp" 3001)
                url="http://localhost:$port"
                ;;
            rn-platform-website)
                port=$(calculate_service_port "$feature_name" "rn-platform-website" 3012)
                url="http://localhost:$port"
                ;;
            patients-app)
                port=$(calculate_service_port "$feature_name" "patients-app" 5173)
                url="http://localhost:$port"
                ;;
            mobile)
                port=$(calculate_service_port "$feature_name" "mobile" 8080)
                url="http://localhost:$port"
                ;;
        esac

        if [ -n "$url" ]; then
            # Open URL based on platform
            if command -v open &> /dev/null; then
                # macOS
                open "$url" 2>/dev/null &
            elif command -v xdg-open &> /dev/null; then
                # Linux
                xdg-open "$url" 2>/dev/null &
            elif command -v start &> /dev/null; then
                # Windows
                start "$url" 2>/dev/null &
            fi
            opened_count=$((opened_count + 1))
            sleep 0.5  # Small delay between opening tabs
        fi
    done

    if [ $opened_count -gt 0 ]; then
        log_success "Opened $opened_count browser tab(s)"
    fi
    echo ""
}

# Stop all services for a workspace
cmd_halt() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve halt <feature-name>"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    echo ""
    print_logo
    echo ""
    log_info "Stopping services for ${BOLD}$feature_name${NC}"
    echo ""

    local services=$(get_workspace_services "$feature_name")
    for service in $services; do
        stop_service "$feature_name" "$service"
    done

    # Optionally stop database
    local config=$(get_workspace_config "$feature_name")
    local db_container=$(jq -r '.database.container // empty' "$config" 2>/dev/null)
    if [ -n "$db_container" ]; then
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
            log_step "Stopping database..."
            docker stop "$db_container" >/dev/null 2>&1
            log_success "Database stopped"
        fi
    fi

    echo ""
    log_success "All services stopped"
    echo ""
}

# Open browser tabs for workspace services
cmd_open() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve open <feature-name>"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    echo ""
    print_logo
    echo ""
    log_info "Opening browsers for ${BOLD}$feature_name${NC}"
    echo ""

    local services=$(get_workspace_services "$feature_name")
    local opened=false

    for service in $services; do
        local port
        local url=""

        case "$service" in
            server)
                port=$(calculate_service_port "$feature_name" "server" 3000)
                # Server doesn't have a web UI typically, skip
                continue
                ;;
            socketio)
                # Socketio doesn't have a web UI, skip
                continue
                ;;
            webapp)
                port=$(calculate_service_port "$feature_name" "webapp" 3001)
                url="http://localhost:$port"
                ;;
            rn-platform-website)
                port=$(calculate_service_port "$feature_name" "rn-platform-website" 3012)
                url="http://localhost:$port"
                ;;
            patients-app)
                port=$(calculate_service_port "$feature_name" "patients-app" 5173)
                url="http://localhost:$port"
                ;;
            mobile)
                port=$(calculate_service_port "$feature_name" "mobile" 8080)
                url="http://localhost:$port"
                ;;
        esac

        if [ -n "$url" ]; then
            log_step "Opening ${BOLD}$service${NC} → $url"

            # Open URL based on platform
            if command -v open &> /dev/null; then
                # macOS
                open "$url"
            elif command -v xdg-open &> /dev/null; then
                # Linux
                xdg-open "$url"
            elif command -v start &> /dev/null; then
                # Windows
                start "$url"
            else
                log_warning "Cannot detect browser opener. URL: $url"
            fi

            opened=true
            sleep 0.5  # Small delay between opening tabs
        fi
    done

    if ! $opened; then
        log_warning "No web services found to open"
    else
        echo ""
        log_success "Browsers opened"
    fi
    echo ""
}

# Show service status
cmd_services() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve services <feature-name>"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    echo ""
    print_logo
    section "Services: $feature_name"

    local workspace_dir=$(get_workspace_dir "$feature_name")
    local pid_dir="$workspace_dir/.hyve/pids"
    local services=$(get_workspace_services "$feature_name")

    echo ""
    for service in $services; do
        local port
        case "$service" in
            server)              port=$(calculate_service_port "$feature_name" "server" 3000) ;;
            webapp)              port=$(calculate_service_port "$feature_name" "webapp" 3001) ;;
            socketio)            port=$(calculate_service_port "$feature_name" "socketio" 3002) ;;
            rn-platform-website) port=$(calculate_service_port "$feature_name" "rn-platform-website" 3012) ;;
            patients-app)        port=$(calculate_service_port "$feature_name" "patients-app" 5173) ;;
            mobile)              port=$(calculate_service_port "$feature_name" "mobile" 8080) ;;
        esac

        local status="${RED}stopped${NC}"
        local pid=""
        local pid_file="$pid_dir/$service.pid"

        if [ -f "$pid_file" ]; then
            pid=$(cat "$pid_file")
            if kill -0 "$pid" 2>/dev/null; then
                status="${GREEN}running${NC}"
            fi
        fi

        printf "  %-20s  Port %-5s  %b\n" "$service" "$port" "$status"
    done

    # Database status
    local config=$(get_workspace_config "$feature_name")
    local db_container=$(jq -r '.database.container // empty' "$config" 2>/dev/null)
    local db_port=$(jq -r '.database.port // empty' "$config" 2>/dev/null)

    if [ -n "$db_container" ]; then
        local db_status="${RED}stopped${NC}"
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
            db_status="${GREEN}running${NC}"
        fi
        printf "  %-20s  Port %-5s  %b\n" "database" "$db_port" "$db_status"
    fi

    echo ""
}

# View logs for a service
cmd_logs() {
    local feature_name=$1
    local service_name=$2
    local follow=false

    # Parse -f flag
    if [ "$service_name" = "-f" ]; then
        follow=true
        service_name=$3
    fi

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve logs <feature-name> [service] [-f]"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    local log_dir="$workspace_dir/.hyve/logs"

    if [ -z "$service_name" ]; then
        # Show all logs
        log_info "Available logs in $log_dir:"
        ls -la "$log_dir"/*.log 2>/dev/null || echo "No logs found"
        return
    fi

    local log_file="$log_dir/$service_name.log"
    if [ ! -f "$log_file" ]; then
        log_error "Log file not found: $log_file"
        exit 1
    fi

    if $follow; then
        tail -f "$log_file"
    else
        less "$log_file"
    fi
}
