#!/bin/bash
# hyve/lib/workspace.sh - Workspace management

# Get workspace directory for a feature
get_workspace_dir() {
    local feature_name=$1
    echo "$(get_workspaces_dir)/$feature_name"
}

# Get workspace config file
get_workspace_config() {
    local feature_name=$1
    echo "$(get_workspace_dir "$feature_name")/.hyve-workspace.json"
}

# Check if workspace exists
workspace_exists() {
    local feature_name=$1
    [ -d "$(get_workspace_dir "$feature_name")" ]
}

# List existing feature branches across repos
list_feature_branches() {
    local project_root=$(get_project_root)
    local prefix=$(get_branch_prefix)
    local branches=()

    for repo in $(get_repos); do
        local repo_path=$(get_repo_path "$repo")
        if [ -d "$repo_path/.git" ]; then
            # Get remote branches matching prefix
            local repo_branches=$(cd "$repo_path" && git branch -r 2>/dev/null | grep "origin/${prefix}" | sed "s|.*origin/${prefix}||" | sort -u)
            for branch in $repo_branches; do
                if [[ ! " ${branches[@]} " =~ " ${branch} " ]]; then
                    branches+=("$branch")
                fi
            done
            # Also check local branches
            local local_branches=$(cd "$repo_path" && git branch 2>/dev/null | grep "${prefix}" | sed "s|.*${prefix}||" | sort -u)
            for branch in $local_branches; do
                if [[ ! " ${branches[@]} " =~ " ${branch} " ]]; then
                    branches+=("$branch")
                fi
            done
        fi
    done

    printf '%s\n' "${branches[@]}" | sort -u
}

# ============================================================================
# Dependency Installation Utilities
# ============================================================================

# Fast pnpm install using prefer-offline mode
# This leverages pnpm's content-addressable store for speed:
# - --prefer-offline: uses local store first, avoids network calls when possible
fast_pnpm_install() {
    local workspace_dir="$1"
    local shell_wrapper="$2"

    local install_cmd="pnpm install --prefer-offline"

    if [ -n "$shell_wrapper" ]; then
        bash -l -c "cd '$workspace_dir' && $shell_wrapper $install_cmd" >/dev/null 2>&1
    else
        (cd "$workspace_dir" && $install_cmd) >/dev/null 2>&1
    fi
    return $?
}

# Create workspace
cmd_create() {
    local feature_name=""
    local repos=()
    local from_branch=""
    local use_existing=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --from|-f)
                from_branch="$2"
                use_existing=true
                shift 2
                ;;
            --existing|-e)
                use_existing=true
                shift
                ;;
            *)
                if [ -z "$feature_name" ]; then
                    feature_name="$1"
                else
                    repos+=("$1")
                fi
                shift
                ;;
        esac
    done

    # Interactive mode if --existing without branch name
    if $use_existing && [ -z "$from_branch" ] && [ -z "$feature_name" ]; then
        echo ""
        print_logo
        echo ""
        log_info "Select an existing feature branch:"
        echo ""

        local branches=($(list_feature_branches))
        if [ ${#branches[@]} -eq 0 ]; then
            log_error "No existing feature branches found"
            exit 1
        fi

        local i=1
        for branch in "${branches[@]}"; do
            echo "  ${CYAN}$i)${NC} $branch"
            i=$((i + 1))
        done
        echo ""

        read -p "Enter number or branch name: " selection

        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le ${#branches[@]} ]; then
            feature_name="${branches[$((selection - 1))]}"
        else
            feature_name="$selection"
        fi
    fi

    # If --from was used:
    # - from_branch is the branch name (without prefix)
    # - feature_name becomes the first repo (if any)
    # - We need to use from_branch as the feature name
    if [ -n "$from_branch" ]; then
        # If feature_name was set, it's actually a repo
        if [ -n "$feature_name" ]; then
            repos=("$feature_name" "${repos[@]}")
        fi
        feature_name="$from_branch"
    fi

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo ""
        echo "Usage: hyve create <feature-name> [repos...]"
        echo "       hyve create --existing                    # Select from existing branches"
        echo "       hyve create --from <branch-name> [repos...]"
        exit 1
    fi

    # Sanitize feature name to be a valid git branch name
    local original_name="$feature_name"
    feature_name=$(sanitize_branch_name "$feature_name")
    if [ "$original_name" != "$feature_name" ]; then
        log_info "Sanitized name: '$original_name' → '$feature_name'"
    fi

    # Add required repos first (if configured)
    local config_file=$(find_config)
    local required_repos=()
    if [ -n "$config_file" ]; then
        if command -v yq &> /dev/null; then
            required_repos=($(yq eval '.required_repos[]' "$config_file" 2>/dev/null | grep -v null || true))
        else
            # Fallback to awk parsing
            required_repos=($(awk '
                /^required_repos:/ { in_section = 1; next }
                in_section && /^  - / {
                    sub(/^  - /, "")
                    gsub(/[[:space:]]*#.*$/, "")
                    print
                }
                in_section && /^[a-zA-Z]/ { exit }
            ' "$config_file"))
        fi
    fi

    # Merge required repos with user-specified repos (avoiding duplicates)
    local all_repos=()
    for req_repo in "${required_repos[@]}"; do
        all_repos+=("$req_repo")
    done
    for repo in "${repos[@]}"; do
        # Only add if not already in list
        local already_added=false
        for existing in "${all_repos[@]}"; do
            if [ "$existing" = "$repo" ]; then
                already_added=true
                break
            fi
        done
        if ! $already_added; then
            all_repos+=("$repo")
        fi
    done
    repos=("${all_repos[@]}")

    # If no repos specified, use all configured repos
    if [ ${#repos[@]} -eq 0 ]; then
        repos=($(get_repos))
    fi

    if [ ${#repos[@]} -eq 0 ]; then
        log_error "No repos configured. Run 'hyve init' first or specify repos."
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    local branch_prefix=$(get_branch_prefix)
    # When using --from, the branch name is used as-is (no prefix added)
    local branch_name
    if $use_existing; then
        branch_name="$feature_name"
    else
        branch_name="${branch_prefix}${feature_name}"
    fi

    if workspace_exists "$feature_name"; then
        log_error "Workspace '$feature_name' already exists"
        log_info "Use 'hyve status $feature_name' to check it"
        exit 1
    fi

    echo ""
    print_logo
    echo ""
    log_info "Creating workspace: ${BOLD}$feature_name${NC}"
    echo ""

    mkdir -p "$workspace_dir"

    # Create worktrees for each repo IN PARALLEL
    # Each repo is independent, so we can parallelize across repos
    local worktree_status_dir=$(mktemp -d)
    local worktree_pids=()

    for repo in "${repos[@]}"; do
        (
            local repo_path=$(get_repo_path "$repo")
            local worktree_dir="$workspace_dir/$repo"
            local status_file="$worktree_status_dir/$repo"

            if [ ! -d "$repo_path/.git" ] && [ ! -f "$repo_path/.git" ]; then
                echo "not_found" > "$status_file"
                exit 0
            fi

            if [ ! -d "$repo_path" ]; then
                echo "not_found" > "$status_file"
                exit 0
            fi

            cd "$repo_path" || { echo "error:Cannot cd to $repo_path" > "$status_file"; exit 0; }

            # Pull latest changes from base branch before creating worktree
            local base_branch=$(get_base_branch "$repo_path")
            if git show-ref --verify --quiet "refs/heads/$base_branch" 2>/dev/null; then
                local current_branch=$(git branch --show-current)
                git stash --quiet 2>/dev/null || true
                git checkout "$base_branch" --quiet 2>/dev/null
                git pull --quiet origin "$base_branch" 2>/dev/null || true
                if [ -n "$current_branch" ] && [ "$current_branch" != "$base_branch" ]; then
                    git checkout "$current_branch" --quiet 2>/dev/null || true
                fi
                git stash pop --quiet 2>/dev/null || true
            fi

            # Check if branch exists (local or remote)
            local branch_exists=false
            if git show-ref --verify --quiet "refs/heads/$branch_name" 2>/dev/null; then
                branch_exists=true
            elif git show-ref --verify --quiet "refs/remotes/origin/$branch_name" 2>/dev/null; then
                branch_exists=true
            fi

            local git_output
            local use_existing_local=$use_existing
            if $branch_exists || $use_existing_local; then
                if git_output=$(git worktree add "$worktree_dir" "$branch_name" 2>&1); then
                    echo "success:existing branch" > "$status_file"
                elif git_output=$(git worktree add "$worktree_dir" "origin/$branch_name" 2>&1); then
                    echo "success:from remote" > "$status_file"
                else
                    local base_branch=$(get_base_branch "$repo_path")
                    if git_output=$(git worktree add "$worktree_dir" -b "$branch_name" "$base_branch" 2>&1); then
                        echo "success:new branch from $base_branch" > "$status_file"
                    else
                        echo "error:$git_output" > "$status_file"
                    fi
                fi
            else
                local base_branch=$(get_base_branch "$repo_path")
                if git_output=$(git worktree add "$worktree_dir" -b "$branch_name" "$base_branch" 2>&1); then
                    echo "success:new branch from $base_branch" > "$status_file"
                else
                    echo "error:$git_output" > "$status_file"
                fi
            fi
        ) &
        worktree_pids+=("$!:$repo")
    done

    # Wait for all worktree jobs and collect results
    local created_repos=()
    for pid_repo in "${worktree_pids[@]}"; do
        local pid="${pid_repo%%:*}"
        local repo="${pid_repo#*:}"
        wait "$pid"
        local status_file="$worktree_status_dir/$repo"
        if [ -f "$status_file" ]; then
            local status=$(cat "$status_file")
            case "$status" in
                success:*)
                    local msg="${status#success:}"
                    log_success "$repo → $branch_name ($msg)"
                    created_repos+=("$repo")
                    ;;
                not_found)
                    log_warning "Repository not found: $repo"
                    ;;
                error:*)
                    local msg="${status#error:}"
                    log_error "Failed to create worktree for $repo: $msg"
                    ;;
            esac
        fi
    done

    # Cleanup
    rm -rf "$worktree_status_dir"

    if [ ${#created_repos[@]} -eq 0 ]; then
        log_error "No worktrees created"
        rm -rf "$workspace_dir"
        exit 1
    fi

    # Install dependencies for each repo IN PARALLEL
    # Uses pnpm's --frozen-lockfile --prefer-offline for speed
    echo ""
    log_step "Installing dependencies (parallel)..."

    # Get shell wrapper from config (e.g., for nvm)
    local config_file=$(find_config)
    local shell_wrapper=""
    if command -v yq &> /dev/null; then
        shell_wrapper=$(yq eval ".services.shell_wrapper // \"\"" "$config_file" 2>/dev/null)
        if [ "$shell_wrapper" = "null" ]; then
            shell_wrapper=""
        fi
    fi

    # Create temp dir for setup status files
    local setup_status_dir=$(mktemp -d)
    local setup_pids=()

    for repo in "${created_repos[@]}"; do
        local worktree_dir="$workspace_dir/$repo"

        # Skip if no package.json (not a Node project)
        if [ ! -f "$worktree_dir/package.json" ]; then
            continue
        fi

        # Run dependency install in background
        (
            local status_file="$setup_status_dir/$repo"
            # Use --frozen-lockfile (skip resolution) and --prefer-offline (use local store)
            # This is fast because pnpm's store already has most packages
            if fast_pnpm_install "$worktree_dir" "$shell_wrapper"; then
                echo "success" > "$status_file"
            else
                # Fallback to regular install if frozen-lockfile fails (e.g., lockfile outdated)
                if [ -n "$shell_wrapper" ]; then
                    bash -l -c "cd '$worktree_dir' && $shell_wrapper pnpm install" >/dev/null 2>&1
                else
                    (cd "$worktree_dir" && pnpm install) >/dev/null 2>&1
                fi
                if [ $? -eq 0 ]; then
                    echo "success" > "$status_file"
                else
                    echo "failed" > "$status_file"
                fi
            fi
        ) &
        setup_pids+=("$!:$repo")
    done

    # Wait for all dependency installs and report results
    for pid_repo in "${setup_pids[@]}"; do
        local pid="${pid_repo%%:*}"
        local repo="${pid_repo#*:}"
        wait "$pid"
        local status_file="$setup_status_dir/$repo"
        if [ -f "$status_file" ] && [ "$(cat "$status_file")" = "success" ]; then
            log_success "$repo → dependencies installed"
        else
            log_warning "$repo → dependencies failed (continuing anyway)"
        fi
    done

    # Cleanup
    rm -rf "$setup_status_dir"

    # Run post-install setup scripts (for non-pnpm tasks like migrations, builds, etc.)
    local has_setup_scripts=false
    for repo in "${created_repos[@]}"; do
        local setup_script=""
        if [ -n "$config_file" ]; then
            if command -v yq &> /dev/null; then
                setup_script=$(yq eval ".repos.$repo.setup_script // \"\"" "$config_file" 2>/dev/null)
                if [ "$setup_script" = "null" ]; then
                    setup_script=""
                fi
            fi
        fi
        # Skip if setup_script is just "pnpm install" (already handled above)
        if [ -n "$setup_script" ] && [ "$setup_script" != "pnpm install" ]; then
            has_setup_scripts=true
            break
        fi
    done

    if $has_setup_scripts; then
        echo ""
        log_step "Running setup scripts..."
        local script_status_dir=$(mktemp -d)
        local script_pids=()

        for repo in "${created_repos[@]}"; do
            local worktree_dir="$workspace_dir/$repo"
            local setup_script=""
            if [ -n "$config_file" ]; then
                if command -v yq &> /dev/null; then
                    setup_script=$(yq eval ".repos.$repo.setup_script // \"\"" "$config_file" 2>/dev/null)
                    if [ "$setup_script" = "null" ]; then
                        setup_script=""
                    fi
                fi
            fi

            # Skip if no setup script or if it's just "pnpm install"
            if [ -z "$setup_script" ] || [ "$setup_script" = "pnpm install" ]; then
                continue
            fi

            (
                local status_file="$script_status_dir/$repo"
                if [ -n "$shell_wrapper" ]; then
                    if bash -l -c "cd '$worktree_dir' && $shell_wrapper $setup_script" >/dev/null 2>&1; then
                        echo "success" > "$status_file"
                    else
                        echo "failed" > "$status_file"
                    fi
                else
                    if (cd "$worktree_dir" && eval "$setup_script") >/dev/null 2>&1; then
                        echo "success" > "$status_file"
                    else
                        echo "failed" > "$status_file"
                    fi
                fi
            ) &
            script_pids+=("$!:$repo")
        done

        for pid_repo in "${script_pids[@]}"; do
            local pid="${pid_repo%%:*}"
            local repo="${pid_repo#*:}"
            wait "$pid"
            local status_file="$script_status_dir/$repo"
            if [ -f "$status_file" ] && [ "$(cat "$status_file")" = "success" ]; then
                log_success "$repo → setup complete"
            else
                log_warning "$repo → setup failed (continuing anyway)"
            fi
        done

        rm -rf "$script_status_dir"
    fi

    # Handle database/Docker setup
    local db_port=""
    local db_container=""
    local docker_mode=false

    if get_docker_enabled; then
        # Docker mode: generate docker-compose.yaml, don't create standalone database
        docker_mode=true
        log_step "Docker mode enabled - generating docker-compose.yaml..."
        source "$LIB_DIR/services-docker.sh"
        local compose_file=$(generate_docker_compose "$feature_name")
        if [ -n "$compose_file" ]; then
            log_success "Generated $compose_file"
        else
            log_warning "Failed to generate docker-compose.yaml"
        fi

        # Calculate db_port for config (used by docker-compose)
        local workspace_index=$(get_workspace_index "$feature_name")
        local db_base_port=$(get_db_base_port)
        db_port=$((db_base_port + workspace_index))
    elif get_db_enabled; then
        # Non-Docker mode: create standalone database container
        source "$LIB_DIR/database.sh"
        db_port=$(create_feature_database "$feature_name")
        db_container="hyve-db-$feature_name"
    fi

    # Calculate port offset for this workspace
    local workspace_index=$(get_workspace_index "$feature_name")
    local port_offset=$(yaml_get "$(find_config)" '.services.port_offset' '1000')
    local base_port=$(yaml_get "$(find_config)" '.services.base_port' '4000')
    local workspace_base=$((base_port + (workspace_index * port_offset)))
    local config_file="$(find_config)"

    # Helper function to get port for a service
    get_service_port() {
        local service=$1
        if command -v yq &> /dev/null; then
            local default_port=$(yq eval ".services.definitions.$service.default_port" "$config_file" 2>/dev/null)
            if [ -n "$default_port" ] && [ "$default_port" != "null" ]; then
                local offset=$((default_port - 3000))
                echo $((workspace_base + offset))
                return
            fi
        fi
        echo ""
    }

    # Helper function to get the default (original) port for a service from config
    get_service_default_port() {
        local service=$1
        if command -v yq &> /dev/null; then
            local default_port=$(yq eval ".services.definitions.$service.default_port" "$config_file" 2>/dev/null)
            if [ -n "$default_port" ] && [ "$default_port" != "null" ]; then
                echo "$default_port"
                return
            fi
        fi
        echo ""
    }

    # Helper function to get all services defined in config
    get_all_services() {
        if command -v yq &> /dev/null; then
            yq eval '.services.definitions | keys | .[]' "$config_file" 2>/dev/null | grep -v null || true
        fi
    }

    # Create shared .env file at workspace root
    # This allows services with envDir: "../.env" (like webapp) to read from parent
    local shared_env="$workspace_dir/.env"
    cat > "$shared_env" << ENVEOF
# Hyve Workspace Environment
# Workspace: $feature_name
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
#
# Shared environment file for all services in this workspace.
# Individual services can override these in their own .env files.

# Service Ports
ENVEOF

    # Add all service ports to shared file
    if command -v yq &> /dev/null; then
        local services=($(yq eval '.services.definitions | keys | .[]' "$config_file" 2>/dev/null))
        for service in "${services[@]}"; do
            local port=$(get_service_port "$service")
            if [ -n "$port" ]; then
                local upper_service=$(echo "$service" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
                echo "${upper_service}_PORT=$port" >> "$shared_env"
            fi
        done
    fi

    # Add API URLs for frontends
    local server_port=$(get_service_port "server")
    if [ -n "$server_port" ]; then
        cat >> "$shared_env" << ENVEOF

# API URLs for frontends
API_BASE_URL=http://localhost:${server_port}
VITE_API_BASE_URL=http://localhost:${server_port}
ENVEOF
    fi
    local socketio_port=$(get_service_port "socketio")
    if [ -n "$socketio_port" ]; then
        cat >> "$shared_env" << ENVEOF
SOCKET_URL=http://localhost:${socketio_port}
VITE_SOCKET_URL=http://localhost:${socketio_port}
ENVEOF
    fi

    # Add database config to shared file
    if [ -n "$db_port" ]; then
        local db_user=$(get_db_user)
        local db_pass=$(get_db_password)
        local db_name=$(get_db_name)
        cat >> "$shared_env" << ENVEOF

# Database
DATABASE_URL=postgresql://${db_user}:${db_pass}@localhost:${db_port}/${db_name}
POSTGRES_PORT=$db_port
ENVEOF
    fi

    # Generate .env files from main repo with workspace-specific port overrides
    echo ""
    log_step "Generating .env files..."
    for repo in "${created_repos[@]}"; do
        local repo_path=$(get_repo_path "$repo")
        local worktree_dir="$workspace_dir/$repo"
        local env_example="$worktree_dir/.env.example"
        local main_env="$repo_path/.env"
        local env_file="$worktree_dir/.env"

        # Priority: 1) Copy .env from main repo, 2) Copy .env.example, 3) Create empty
        if [ -f "$main_env" ]; then
            cp "$main_env" "$env_file"
            log_success "$repo/.env copied from main repo"
        elif [ -f "$env_example" ]; then
            cp "$env_example" "$env_file"
            log_success "$repo/.env created from .env.example"
        else
            touch "$env_file"
            log_info "$repo/.env created (no .env found)"
        fi

        # Calculate workspace-specific values
        local repo_port=$(get_service_port "$repo")
        local db_user=$(get_db_user)
        local db_pass=$(get_db_password)
        local db_name=$(get_db_name)
        local new_db_url="postgresql://${db_user}:${db_pass}@localhost:${db_port}/${db_name}"

        # Replace DATABASE_URL with workspace database port
        if [ -n "$db_port" ]; then
            # Use sed to replace existing DATABASE_URL or POSTGRES_PORT
            if grep -q "^DATABASE_URL=" "$env_file" 2>/dev/null; then
                sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${new_db_url}|" "$env_file"
                rm -f "$env_file.bak"
            fi
            if grep -q "^POSTGRES_PORT=" "$env_file" 2>/dev/null; then
                sed -i.bak "s|^POSTGRES_PORT=.*|POSTGRES_PORT=${db_port}|" "$env_file"
                rm -f "$env_file.bak"
            fi
        fi

        # Replace PORT with workspace-specific port
        if [ -n "$repo_port" ]; then
            if grep -q "^PORT=" "$env_file" 2>/dev/null; then
                sed -i.bak "s|^PORT=.*|PORT=${repo_port}|" "$env_file"
                rm -f "$env_file.bak"
            fi
        fi

        # Replace all service ports generically based on config
        # Iterates over all services in .hyve.yaml and replaces localhost:default_port with localhost:workspace_port
        for service in $(get_all_services); do
            local svc_default_port=$(get_service_default_port "$service")
            local svc_workspace_port=$(get_service_port "$service")
            if [ -n "$svc_default_port" ] && [ -n "$svc_workspace_port" ] && [ "$svc_default_port" != "$svc_workspace_port" ]; then
                sed -i.bak "s|localhost:${svc_default_port}|localhost:${svc_workspace_port}|g" "$env_file"
                rm -f "$env_file.bak"
            fi
        done

        # Append hyve workspace marker and any missing configs
        cat >> "$env_file" << ENVEOF

# ===== Hyve Workspace Configuration =====
# Workspace: $feature_name
# Ports updated for workspace isolation
ENVEOF

        # Add PORT if not already in file
        if [ -n "$repo_port" ] && ! grep -q "^PORT=" "$env_file" 2>/dev/null; then
            echo "PORT=$repo_port" >> "$env_file"
        fi

        # Add DATABASE_URL if not already in file
        if [ -n "$db_port" ] && ! grep -q "^DATABASE_URL=" "$env_file" 2>/dev/null; then
            echo "DATABASE_URL=${new_db_url}" >> "$env_file"
            echo "POSTGRES_PORT=${db_port}" >> "$env_file"
        fi
    done

    # Create workspace config
    local repos_json=$(printf '"%s",' "${created_repos[@]}" | sed 's/,$//')
    cat > "$(get_workspace_config "$feature_name")" << EOF
{
    "name": "$feature_name",
    "branch": "$branch_name",
    "repos": [$repos_json],
    "docker": {
        "enabled": $($docker_mode && echo "true" || echo "false")
    },
    "database": {
        "enabled": $(get_db_enabled && echo "true" || echo "false"),
        "port": ${db_port:-null},
        "container": "${db_container:-null}"
    },
    "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "status": "active"
}
EOF

    # Create .env file
    cat > "$workspace_dir/.env" << EOF
# Hyve workspace: $feature_name
# Branch: $branch_name
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

HYVE_WORKSPACE=$feature_name
HYVE_BRANCH=$branch_name
EOF

    if [ -n "$db_port" ]; then
        local db_user=$(get_db_user)
        local db_pass=$(get_db_password)
        local db_name=$(get_db_name)
        cat >> "$workspace_dir/.env" << EOF

# Database
DATABASE_URL=postgresql://${db_user}:${db_pass}@localhost:${db_port}/${db_name}
POSTGRES_PORT=$db_port
EOF
    fi

    # Create workspace CLAUDE.md
    cat > "$workspace_dir/CLAUDE.md" << EOF
# ⬡ Hyve Workspace: $feature_name

This is an isolated workspace for feature development.

## Branch
All repos are on branch: \`$branch_name\`

## Repos
$(for repo in "${created_repos[@]}"; do echo "- \`$repo/\`"; done)

## Environment
$(if [ -n "$db_port" ]; then echo "- **Database**: PostgreSQL on port $db_port"; fi)
- **Config**: \`.env\` file with environment variables

## Workflow
1. Make changes in this workspace
2. Changes are isolated to the \`$branch_name\` branch
3. Test locally before committing
4. Commit with descriptive messages

## Cross-repo changes
If making API changes across repos:
1. Backend/server changes first
2. Regenerate any API schemas
3. Frontend changes after schema update
4. Commit in sequence with references
EOF

    echo ""
    divider
    echo ""
    echo -e "${GREEN}${BOLD}Workspace Ready!${NC}"
    echo ""
    echo -e "  ${DIM}Location:${NC}  $workspace_dir"
    echo -e "  ${DIM}Branch:${NC}    $branch_name"
    echo -e "  ${DIM}Repos:${NC}     ${created_repos[*]}"
    if [ -n "$db_port" ]; then
        echo -e "  ${DIM}Database:${NC}  localhost:$db_port"
    fi
    echo ""

    if $docker_mode; then
        echo -e "  ${CYAN}${BOLD}Docker Mode${NC} - Start services with:"
        echo -e "  ${DIM}hyve up${NC} $feature_name"
        echo ""
    else
        echo -e "  ${DIM}cd${NC} $workspace_dir"
        echo ""
    fi
}

# List workspaces
cmd_list() {
    local workspaces_dir=$(get_workspaces_dir)

    echo ""
    print_logo
    section "Workspaces"

    if [ ! -d "$workspaces_dir" ] || [ -z "$(ls -A "$workspaces_dir" 2>/dev/null)" ]; then
        log_info "No workspaces found"
        echo ""
        echo "Create one with: ${CYAN}hyve create <feature-name> [repos...]${NC}"
        echo ""
        return
    fi

    for dir in "$workspaces_dir"/*/; do
        local config="$dir/.hyve-workspace.json"
        if [ -f "$config" ]; then
            local name=$(jq -r '.name' "$config")
            local branch=$(jq -r '.branch' "$config")
            local repos=$(jq -r '.repos | join(", ")' "$config")
            local db_enabled=$(jq -r '.database.enabled' "$config")
            local db_port=$(jq -r '.database.port // empty' "$config")
            local db_container=$(jq -r '.database.container // empty' "$config")

            echo ""
            echo -e "  ${YELLOW}⬡${NC} ${BOLD}$name${NC}"
            echo -e "    ${DIM}Branch:${NC} $branch"
            echo -e "    ${DIM}Repos:${NC}  $repos"

            if [ "$db_enabled" = "true" ] && [ -n "$db_container" ]; then
                if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
                    echo -e "    ${DIM}DB:${NC}     ${GREEN}●${NC} port $db_port"
                else
                    echo -e "    ${DIM}DB:${NC}     ${RED}●${NC} stopped"
                fi
            fi
        fi
    done
    echo ""
}

# Show workspace status
cmd_status() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        cmd_list
        return
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    local config=$(get_workspace_config "$feature_name")

    echo ""
    print_logo
    section "Workspace: $feature_name"

    local branch=$(jq -r '.branch' "$config")
    local repos=$(jq -r '.repos[]' "$config")
    local db_enabled=$(jq -r '.database.enabled' "$config")
    local db_port=$(jq -r '.database.port // empty' "$config")
    local db_container=$(jq -r '.database.container // empty' "$config")

    echo ""
    echo -e "  ${DIM}Location:${NC} $workspace_dir"
    echo -e "  ${DIM}Branch:${NC}   $branch"

    # Database status
    if [ "$db_enabled" = "true" ] && [ -n "$db_container" ]; then
        echo ""
        echo -e "  ${BOLD}Database${NC}"
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
            echo -e "    Status: ${GREEN}running${NC} on port $db_port"
        else
            echo -e "    Status: ${RED}stopped${NC}"
            echo -e "    Start:  ${CYAN}hyve start $feature_name${NC}"
        fi
    fi

    # Repo status
    echo ""
    echo -e "  ${BOLD}Repositories${NC}"
    for repo in $repos; do
        local repo_dir="$workspace_dir/$repo"
        if [ -d "$repo_dir" ]; then
            cd "$repo_dir"
            local current_branch=$(git branch --show-current 2>/dev/null)
            local changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
            local ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
            local behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo "?")

            echo ""
            echo -e "    ${CYAN}$repo/${NC}"
            echo -e "      Branch:   $current_branch"

            if [ "$changes" -gt 0 ]; then
                echo -e "      Changes:  ${YELLOW}$changes uncommitted${NC}"
            else
                echo -e "      Changes:  ${GREEN}clean${NC}"
            fi

            if [ "$ahead" != "?" ] && [ "$ahead" -gt 0 ]; then
                echo -e "      Ahead:    ${YELLOW}$ahead commits${NC}"
            fi
            if [ "$behind" != "?" ] && [ "$behind" -gt 0 ]; then
                echo -e "      Behind:   ${YELLOW}$behind commits${NC}"
            fi
        fi
    done
    echo ""
}

# Start workspace services
cmd_start() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local config=$(get_workspace_config "$feature_name")
    local db_container=$(jq -r '.database.container // empty' "$config")
    local db_port=$(jq -r '.database.port // empty' "$config")

    if [ -z "$db_container" ]; then
        log_info "No services to start for this workspace"
        return
    fi

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
        log_info "Database already running on port $db_port"
    else
        log_step "Starting database..."
        docker start "$db_container" >/dev/null 2>&1
        log_success "Database started on port $db_port"
    fi
}

# Stop workspace services
cmd_stop() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local config=$(get_workspace_config "$feature_name")
    local db_container=$(jq -r '.database.container // empty' "$config")

    if [ -z "$db_container" ]; then
        log_info "No services to stop"
        return
    fi

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
        log_step "Stopping database..."
        docker stop "$db_container" >/dev/null 2>&1
        log_success "Database stopped"
    else
        log_info "Database not running"
    fi
}

# Cleanup workspace
cmd_cleanup() {
    local feature_name=""
    local force=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--force)
                force=true
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

    # Interactive selection if no feature name provided
    if [ -z "$feature_name" ]; then
        echo ""
        print_logo
        echo ""

        # Get list of existing workspaces
        local workspaces_dir=$(get_workspaces_dir)
        local workspaces=()
        if [ -d "$workspaces_dir" ]; then
            while IFS= read -r dir; do
                [ -n "$dir" ] && workspaces+=("$(basename "$dir")")
            done < <(find "$workspaces_dir" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort)
        fi

        if [ ${#workspaces[@]} -eq 0 ]; then
            log_error "No workspaces found"
            exit 1
        fi

        # Use arrow-key interactive selector
        feature_name=$(interactive_select "Select workspace to remove (↑/↓, Enter to confirm, q to quit):" "${workspaces[@]}") || {
            log_info "Cancelled"
            exit 0
        }
        echo ""
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    local config=$(get_workspace_config "$feature_name")

    echo ""
    print_logo
    echo ""
    log_warning "This will remove workspace '${BOLD}$feature_name${NC}':"
    echo "  - Git worktrees (branches preserved in main repos)"
    echo "  - Database container and data"
    echo "  - Workspace directory"
    echo ""

    if ! $force; then
        if ! confirm "Are you sure?"; then
            log_info "Cancelled"
            return
        fi
        echo ""
    fi

    # Stop and remove database
    local db_container=$(jq -r '.database.container // empty' "$config" 2>/dev/null)
    if [ -n "$db_container" ]; then
        log_step "Removing database container..."
        docker rm -f "$db_container" >/dev/null 2>&1 || true
        log_success "Database removed"
    fi

    # Remove worktrees IN PARALLEL (each repo is independent)
    local repos=$(jq -r '.repos[]' "$config" 2>/dev/null)
    local cleanup_pids=()
    local cleanup_status_dir=$(mktemp -d)

    log_step "Removing worktrees (parallel)..."
    for repo in $repos; do
        (
            local repo_dir="$workspace_dir/$repo"
            local main_repo=$(get_repo_path "$repo")
            local status_file="$cleanup_status_dir/$repo"

            if [ -d "$main_repo/.git" ] || [ -f "$main_repo/.git" ]; then
                cd "$main_repo"
                git worktree remove "$repo_dir" --force 2>/dev/null || true
                git worktree prune 2>/dev/null || true
                echo "success" > "$status_file"
            else
                echo "skipped" > "$status_file"
            fi
        ) &
        cleanup_pids+=("$!:$repo")
    done

    # Wait for all cleanup jobs
    for pid_repo in "${cleanup_pids[@]}"; do
        local pid="${pid_repo%%:*}"
        local repo="${pid_repo#*:}"
        wait "$pid"
        local status_file="$cleanup_status_dir/$repo"
        if [ -f "$status_file" ] && [ "$(cat "$status_file")" = "success" ]; then
            log_success "$repo worktree removed"
        fi
    done
    rm -rf "$cleanup_status_dir"

    # Remove workspace directory
    rm -rf "$workspace_dir"
    log_success "Workspace '$feature_name' removed"
    echo ""
}

# Open shell in workspace
cmd_shell() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    cd "$workspace_dir"
    exec $SHELL
}

# Install dependencies (remove symlinks, run pnpm install)
cmd_install() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        echo "Usage: hyve install <feature-name>"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local workspace_dir=$(get_workspace_dir "$feature_name")
    local config=$(get_workspace_config "$feature_name")
    local repos=$(jq -r '.repos[]' "$config")

    echo ""
    print_logo
    echo ""
    log_info "Installing dependencies for ${BOLD}$feature_name${NC}"
    echo ""

    for repo in $repos; do
        local repo_dir="$workspace_dir/$repo"

        if [ ! -d "$repo_dir" ]; then
            continue
        fi

        log_step "Installing ${BOLD}$repo${NC}..."

        # Remove symlinked node_modules if exists
        if [ -L "$repo_dir/node_modules" ]; then
            rm "$repo_dir/node_modules"
            log_info "  Removed node_modules symlink"
        fi

        # Remove nested symlinks too
        for subdir in "$repo_dir"/*/; do
            if [ -L "$subdir/node_modules" ]; then
                rm "$subdir/node_modules"
            fi
        done

        # Run pnpm install
        cd "$repo_dir"
        if pnpm install; then
            log_success "$repo dependencies installed"
        else
            log_error "Failed to install $repo dependencies"
        fi
        echo ""
    done

    log_success "All dependencies installed"
    echo ""
}

# Connect to workspace database
cmd_db() {
    local feature_name=$1

    if [ -z "$feature_name" ]; then
        log_error "Feature name required"
        exit 1
    fi

    if ! workspace_exists "$feature_name"; then
        log_error "Workspace not found: $feature_name"
        exit 1
    fi

    local config=$(get_workspace_config "$feature_name")
    local db_port=$(jq -r '.database.port // empty' "$config")
    local db_container=$(jq -r '.database.container // empty' "$config")

    if [ -z "$db_port" ]; then
        log_error "No database configured for this workspace"
        exit 1
    fi

    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
        log_error "Database not running. Start it with: hyve start $feature_name"
        exit 1
    fi

    local db_user=$(get_db_user)
    local db_name=$(get_db_name)
    local db_pass=$(get_db_password)

    PGPASSWORD="$db_pass" psql -h localhost -p "$db_port" -U "$db_user" -d "$db_name"
}
