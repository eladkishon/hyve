#!/bin/bash
# hyve/lib/config.sh - Configuration management

CONFIG_FILE=".hyve.yaml"
DEFAULT_WORKSPACES_DIR="workspaces"

# Find config file by walking up directory tree
find_config() {
    local dir="$PWD"
    while [ "$dir" != "/" ]; do
        if [ -f "$dir/$CONFIG_FILE" ]; then
            echo "$dir/$CONFIG_FILE"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# Get project root (directory containing config)
get_project_root() {
    local config=$(find_config)
    if [ -n "$config" ]; then
        dirname "$config"
    else
        echo "$PWD"
    fi
}

# Simple YAML value getter (no external deps)
yaml_get() {
    local file=$1
    local key=$2
    local default=$3

    # Try yq first if available
    if command -v yq &> /dev/null; then
        local value=$(yq eval "$key // \"\"" "$file" 2>/dev/null)
        if [ -n "$value" ] && [ "$value" != "null" ]; then
            echo "$value"
            return
        fi
    fi

    # Fallback to awk-based extraction for simple keys
    local simple_key=$(echo "$key" | sed 's/^\.//' | sed 's/\[.*\]//')
    local parts=(${simple_key//./ })
    local value=""

    if [ ${#parts[@]} -eq 1 ]; then
        # Top-level key
        value=$(awk -F: -v key="${parts[0]}" '
            $1 == key {
                val = $2
                for(i=3; i<=NF; i++) val = val ":" $i  # Handle values with colons
                gsub(/^[[:space:]]+/, "", val)
                gsub(/[[:space:]]*#.*$/, "", val)     # Remove comments
                gsub(/"/, "", val)
                print val
                exit
            }
        ' "$file" 2>/dev/null)
    elif [ ${#parts[@]} -eq 2 ]; then
        # Two-level key (e.g., database.enabled, branches.prefix)
        value=$(awk -v section="${parts[0]}" -v key="${parts[1]}" '
            /^[a-zA-Z]/ {
                current = $1
                gsub(/:/, "", current)
                in_section = (current == section)
            }
            in_section && /^  / {
                line_key = $1
                gsub(/:/, "", line_key)
                if (line_key == key) {
                    val = $0
                    sub(/^[[:space:]]*[^:]+:[[:space:]]*/, "", val)
                    gsub(/[[:space:]]*#.*$/, "", val)     # Remove comments
                    gsub(/"/, "", val)
                    gsub(/^[[:space:]]+/, "", val)        # Trim leading
                    gsub(/[[:space:]]+$/, "", val)        # Trim trailing
                    print val
                    exit
                }
            }
        ' "$file" 2>/dev/null)
    fi

    echo "${value:-$default}"
}

# Get workspaces directory
get_workspaces_dir() {
    local config_file=$(find_config)
    local project_root=$(get_project_root)
    local configured="$DEFAULT_WORKSPACES_DIR"

    if [ -n "$config_file" ]; then
        configured=$(yaml_get "$config_file" '.workspaces_dir' "$DEFAULT_WORKSPACES_DIR")
    fi

    # Expand ~ if present
    configured="${configured/#\~/$HOME}"

    # Remove leading ./
    configured="${configured#./}"

    # If relative path, make it relative to project root
    if [[ "$configured" != /* ]]; then
        configured="$project_root/$configured"
    fi

    echo "$configured"
}

# Get list of configured repos
get_repos() {
    local config_file=$(find_config)
    if [ -z "$config_file" ]; then
        return
    fi

    if command -v yq &> /dev/null; then
        yq eval '.repos | keys | .[]' "$config_file" 2>/dev/null
    else
        # Extract repo names from YAML
        sed -n '/^repos:/,/^[a-z]/p' "$config_file" | grep -E '^  [a-zA-Z0-9_-]+:' | sed 's/:.*$//' | tr -d ' '
    fi
}

# Get repo path
get_repo_path() {
    local repo_name=$1
    local config_file=$(find_config)
    local project_root=$(get_project_root)

    if [ -z "$config_file" ]; then
        echo "$project_root/$repo_name"
        return
    fi

    local path=""
    if command -v yq &> /dev/null; then
        path=$(yq eval ".repos.$repo_name.path // \"$repo_name\"" "$config_file" 2>/dev/null)
    else
        # Extract path for specific repo using awk (more portable)
        path=$(awk -v repo="$repo_name" '
            /^  [a-zA-Z]/ { current_repo = $1; gsub(/:/, "", current_repo) }
            current_repo == repo && /path:/ {
                sub(/.*path:[[:space:]]*/, "")
                gsub(/"/, "")
                print
                exit
            }
        ' "$config_file")
        path=${path:-$repo_name}
    fi

    # Handle ./ prefix
    path="${path#./}"

    # If relative path, make it relative to project root
    if [[ "$path" != /* ]]; then
        path="$project_root/$path"
    fi

    echo "$path"
}

# Database config getters
get_db_enabled() {
    local config_file=$(find_config)
    [ -n "$config_file" ] && [ "$(yaml_get "$config_file" '.database.enabled' 'false')" = "true" ]
}

get_db_source_port() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.database.source_port' '5432'
}

get_db_base_port() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.database.base_port' '5500'
}

get_db_user() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.database.user' 'postgres'
}

get_db_password() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.database.password' 'postgres'
}

get_db_name() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.database.name' 'postgres'
}

get_db_image() {
    local config_file=$(find_config)
    yaml_get "$config_file" '.database.image' 'postgres:15'
}

get_branch_prefix() {
    local config_file=$(find_config)
    local prefix=$(yaml_get "$config_file" '.branches.prefix' 'feature/')
    # Remove any trailing comments
    prefix="${prefix%%#*}"
    # Trim whitespace
    prefix="${prefix%"${prefix##*[![:space:]]}"}"
    echo "$prefix"
}

# Initialize config
cmd_init() {
    local project_root="$PWD"

    if [ -f "$project_root/$CONFIG_FILE" ]; then
        log_warning "Configuration already exists: $CONFIG_FILE"
        if ! confirm "Overwrite?"; then
            return 0
        fi
    fi

    print_banner
    log_info "Initializing hyve in $project_root"

    # Detect git repos
    local repos=()
    for dir in */; do
        if [ -d "$dir/.git" ]; then
            repos+=("${dir%/}")
        fi
    done

    # Check if current dir is a git repo
    local is_monorepo=false
    if [ -d ".git" ]; then
        is_monorepo=true
    fi

    # Generate config
    cat > "$project_root/$CONFIG_FILE" << 'EOF'
# ⬡ Hyve - Multi-Repo Agent Configuration
# Autonomous workspaces for multi-repo development
# https://github.com/eladkishon/hyve

# Where to create feature workspaces (relative to this file)
workspaces_dir: ./workspaces

# Repository definitions
# Each repo will get its own git worktree per feature
repos:
EOF

    if [ ${#repos[@]} -gt 0 ]; then
        for repo in "${repos[@]}"; do
            local remote=$(cd "$repo" && git remote get-url origin 2>/dev/null || echo "")
            cat >> "$project_root/$CONFIG_FILE" << EOF
  $repo:
    path: ./$repo
    remote: $remote
EOF
        done
    elif $is_monorepo; then
        local remote=$(git remote get-url origin 2>/dev/null || echo "")
        cat >> "$project_root/$CONFIG_FILE" << EOF
  main:
    path: .
    remote: $remote
EOF
    else
        cat >> "$project_root/$CONFIG_FILE" << EOF
  # Add your repos here:
  # backend:
  #   path: ./backend
  #   remote: git@github.com:org/backend.git
  # frontend:
  #   path: ./frontend
  #   remote: git@github.com:org/frontend.git
EOF
    fi

    cat >> "$project_root/$CONFIG_FILE" << 'EOF'

# Database cloning (optional)
# Clone your dev database for each feature workspace
database:
  enabled: false
  image: postgres:15
  source_port: 5432      # Port of dev database to clone from
  base_port: 5500        # Starting port for feature databases (5500, 5501, ...)
  user: postgres
  password: postgres
  name: postgres

# Branch naming convention
branches:
  prefix: feature/       # Branches: feature/<feature-name>

# Claude Code agent settings
agent:
  # Autonomy level:
  #   full - auto-commit, auto-test, auto-PR
  #   semi - work autonomously, pause before commits (recommended)
  #   supervised - pause at each major step
  autonomy: semi
  checkpoint_before_commit: true
EOF

    log_success "Created $CONFIG_FILE"

    # Create workspaces directory
    mkdir -p "$project_root/workspaces"
    log_success "Created workspaces/ directory"

    # Create .gitignore entry
    if [ -f "$project_root/.gitignore" ]; then
        if ! grep -q "^workspaces/$" "$project_root/.gitignore" 2>/dev/null; then
            echo -e "\n# Hyve workspaces\nworkspaces/" >> "$project_root/.gitignore"
            log_success "Added workspaces/ to .gitignore"
        fi
    else
        cat > "$project_root/.gitignore" << 'EOF'
# Hyve workspaces
workspaces/
EOF
        log_success "Created .gitignore"
    fi

    echo ""
    divider
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo ""
    echo "  1. Edit ${CYAN}.hyve.yaml${NC} to configure your repos"
    echo "  2. Create a workspace: ${CYAN}hyve create my-feature repo1 repo2${NC}"
    echo "  3. Install Claude commands: ${CYAN}hyve install-commands${NC}"
    echo ""
}
