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

    # If from_branch specified, use it as feature name
    if [ -n "$from_branch" ] && [ -z "$feature_name" ]; then
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
    local branch_name="${branch_prefix}${feature_name}"

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

    # Create worktrees for each repo
    local created_repos=()
    for repo in "${repos[@]}"; do
        local repo_path=$(get_repo_path "$repo")
        local worktree_dir="$workspace_dir/$repo"

        if [ ! -d "$repo_path/.git" ] && [ ! -f "$repo_path/.git" ]; then
            log_warning "Repository not found: $repo_path"
            continue
        fi

        log_step "Creating worktree for ${BOLD}$repo${NC}"

        if [ ! -d "$repo_path" ]; then
            log_error "  repo_path not found: $repo_path"
            continue
        fi

        cd "$repo_path" || { log_error "Cannot cd to $repo_path"; continue; }

        # Check if branch exists (local or remote)
        local branch_exists=false
        if git show-ref --verify --quiet "refs/heads/$branch_name" 2>/dev/null; then
            branch_exists=true
        elif git show-ref --verify --quiet "refs/remotes/origin/$branch_name" 2>/dev/null; then
            branch_exists=true
        fi

        local git_output
        if $branch_exists || $use_existing; then
            # Use existing branch
            if git_output=$(git worktree add "$worktree_dir" "$branch_name" 2>&1); then
                log_success "$repo → $branch_name (existing branch)"
                created_repos+=("$repo")
            elif git_output=$(git worktree add "$worktree_dir" "origin/$branch_name" 2>&1); then
                log_success "$repo → $branch_name (from remote)"
                created_repos+=("$repo")
            else
                log_warning "$repo: Branch $branch_name not found, creating new"
                if git_output=$(git worktree add "$worktree_dir" -b "$branch_name" 2>&1); then
                    log_success "$repo → $branch_name (new branch)"
                    created_repos+=("$repo")
                else
                    log_error "Failed to create worktree for $repo: $git_output"
                fi
            fi
        else
            # Create new branch
            if git_output=$(git worktree add "$worktree_dir" -b "$branch_name" 2>&1); then
                log_success "$repo → $branch_name (new branch)"
                created_repos+=("$repo")
            else
                log_error "Failed to create worktree for $repo: $git_output"
            fi
        fi
    done

    if [ ${#created_repos[@]} -eq 0 ]; then
        log_error "No worktrees created"
        rm -rf "$workspace_dir"
        exit 1
    fi

    # Handle database
    local db_port=""
    local db_container=""
    if get_db_enabled; then
        source "$LIB_DIR/database.sh"
        create_feature_database "$feature_name"
        db_port=$(get_feature_db_port "$feature_name")
        db_container="hyve-db-$feature_name"
    fi

    # Create workspace config
    local repos_json=$(printf '"%s",' "${created_repos[@]}" | sed 's/,$//')
    cat > "$(get_workspace_config "$feature_name")" << EOF
{
    "name": "$feature_name",
    "branch": "$branch_name",
    "repos": [$repos_json],
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
    echo -e "  ${DIM}cd${NC} $workspace_dir"
    echo ""
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
    local config=$(get_workspace_config "$feature_name")

    echo ""
    print_logo
    echo ""
    log_warning "This will remove workspace '${BOLD}$feature_name${NC}':"
    echo "  - Git worktrees (branches preserved in main repos)"
    echo "  - Database container and data"
    echo "  - Workspace directory"
    echo ""

    if ! confirm "Are you sure?"; then
        log_info "Cancelled"
        return
    fi

    echo ""

    # Stop and remove database
    local db_container=$(jq -r '.database.container // empty' "$config" 2>/dev/null)
    if [ -n "$db_container" ]; then
        log_step "Removing database container..."
        docker rm -f "$db_container" >/dev/null 2>&1 || true
        log_success "Database removed"
    fi

    # Remove worktrees
    local repos=$(jq -r '.repos[]' "$config" 2>/dev/null)
    for repo in $repos; do
        local repo_dir="$workspace_dir/$repo"
        local main_repo=$(get_repo_path "$repo")

        if [ -d "$main_repo/.git" ] || [ -f "$main_repo/.git" ]; then
            log_step "Removing worktree: $repo"
            cd "$main_repo"
            git worktree remove "$repo_dir" --force 2>/dev/null || true
        fi
    done

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
