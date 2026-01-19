#!/bin/bash
# hyve/lib/database.sh - Database management

# Get port for a feature's database
get_feature_db_port() {
    local feature_name=$1
    local config=$(get_workspace_config "$feature_name")

    if [ -f "$config" ]; then
        jq -r '.database.port // empty' "$config"
    fi
}

# Create database for feature
create_feature_database() {
    local feature_name=$1
    local base_port=$(get_db_base_port)
    local source_port=$(get_db_source_port)
    local db_image=$(get_db_image)
    local db_user=$(get_db_user)
    local db_pass=$(get_db_password)
    local db_name=$(get_db_name)

    local container_name="hyve-db-$feature_name"
    local db_port=$(find_available_port "$base_port")

    log_step "Starting database container on port $db_port"

    # Start PostgreSQL container
    docker run -d \
        --name "$container_name" \
        -e POSTGRES_USER="$db_user" \
        -e POSTGRES_PASSWORD="$db_pass" \
        -e POSTGRES_DB="$db_name" \
        -p "$db_port:5432" \
        "$db_image" >/dev/null

    # Wait for database to be ready
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if PGPASSWORD="$db_pass" psql -h localhost -p "$db_port" -U "$db_user" -d "$db_name" -c "SELECT 1" >/dev/null 2>&1; then
            break
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    if [ $attempt -eq $max_attempts ]; then
        log_warning "Database may not be fully ready"
    fi

    log_success "Database container started"

    # Clone from source database if available
    clone_database "$source_port" "$db_port" "$container_name" "$db_user" "$db_pass" "$db_name"

    echo "$db_port"
}

# Clone database from source
clone_database() {
    local source_port=$1
    local target_port=$2
    local container_name=$3
    local db_user=$4
    local db_pass=$5
    local db_name=$6

    # Check if source database is accessible
    if ! PGPASSWORD="$db_pass" psql -h localhost -p "$source_port" -U "$db_user" -d "$db_name" -c "SELECT 1" >/dev/null 2>&1; then
        log_info "Source database not available, starting with empty database"
        return
    fi

    log_step "Cloning database from port $source_port..."

    # Use the container's pg_dump to avoid version mismatch
    if docker exec -e PGPASSWORD="$db_pass" "$container_name" \
        pg_dump -h host.docker.internal -p "$source_port" -U "$db_user" "$db_name" 2>/dev/null | \
        docker exec -i "$container_name" psql -U "$db_user" -d "$db_name" >/dev/null 2>&1; then
        log_success "Database cloned successfully"
    else
        # Fallback: try docker bridge IP (Linux)
        if docker exec -e PGPASSWORD="$db_pass" "$container_name" \
            pg_dump -h 172.17.0.1 -p "$source_port" -U "$db_user" "$db_name" 2>/dev/null | \
            docker exec -i "$container_name" psql -U "$db_user" -d "$db_name" >/dev/null 2>&1; then
            log_success "Database cloned successfully"
        else
            log_warning "Could not clone database, starting with empty database"
        fi
    fi
}
