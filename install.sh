#!/bin/bash
# ⬡ Hyve Installation Script
# https://github.com/eladkishon/hyve

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${HYVE_INSTALL_DIR:-$HOME/.hyve}"
REPO_URL="https://github.com/eladkishon/hyve.git"

print_banner() {
    echo -e "${YELLOW}"
    cat << 'EOF'

    ██╗  ██╗██╗   ██╗██╗   ██╗███████╗
    ██║  ██║╚██╗ ██╔╝██║   ██║██╔════╝
    ███████║ ╚████╔╝ ██║   ██║█████╗
    ██╔══██║  ╚██╔╝  ╚██╗ ██╔╝██╔══╝
    ██║  ██║   ██║    ╚████╔╝ ███████╗
    ╚═╝  ╚═╝   ╚═╝     ╚═══╝  ╚══════╝

EOF
    echo -e "${NC}"
    echo -e "    ${BOLD}Autonomous Multi-Repo Agent Workspaces${NC}"
    echo ""
}

log_info() { echo -e "${CYAN}◆${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

check_dependencies() {
    local missing=()

    if ! command -v git &> /dev/null; then
        missing+=("git")
    fi

    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    if ! command -v jq &> /dev/null; then
        missing+=("jq")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required dependencies: ${missing[*]}"
        echo ""
        echo "Please install them first:"
        for dep in "${missing[@]}"; do
            case $dep in
                git)
                    echo "  - git: https://git-scm.com/downloads"
                    ;;
                docker)
                    echo "  - docker: https://docs.docker.com/get-docker/"
                    ;;
                jq)
                    echo "  - jq: brew install jq (macOS) or apt install jq (Ubuntu)"
                    ;;
            esac
        done
        exit 1
    fi

    log_success "All dependencies found"
}

detect_shell() {
    local shell_name=$(basename "$SHELL")
    case $shell_name in
        zsh)
            echo "$HOME/.zshrc"
            ;;
        bash)
            if [ -f "$HOME/.bash_profile" ]; then
                echo "$HOME/.bash_profile"
            else
                echo "$HOME/.bashrc"
            fi
            ;;
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        *)
            echo "$HOME/.profile"
            ;;
    esac
}

install_hyve() {
    print_banner

    log_info "Installing Hyve to $INSTALL_DIR"
    echo ""

    # Check dependencies
    check_dependencies

    # Clone or update
    if [ -d "$INSTALL_DIR" ]; then
        log_info "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
        log_success "Updated Hyve"
    else
        log_info "Cloning Hyve..."
        git clone "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
            # If clone fails (repo doesn't exist yet), copy from local
            log_warning "Could not clone from GitHub, using local copy"
            mkdir -p "$INSTALL_DIR"
            if [ -d "$(dirname "$0")" ]; then
                cp -r "$(dirname "$0")/"* "$INSTALL_DIR/"
            fi
        }
        log_success "Installed Hyve"
    fi

    # Make executable
    chmod +x "$INSTALL_DIR/bin/hyve"

    # Add to PATH and shell completions
    local shell_rc=$(detect_shell)
    local shell_name=$(basename "$SHELL")
    local path_line='export PATH="$HOME/.hyve/bin:$PATH"'

    if ! grep -q ".hyve/bin" "$shell_rc" 2>/dev/null; then
        echo "" >> "$shell_rc"
        echo "# Hyve - Multi-Repo Agent Workspaces" >> "$shell_rc"
        echo "$path_line" >> "$shell_rc"

        # Add shell completions based on shell type
        case $shell_name in
            zsh)
                echo 'fpath=($HOME/.hyve/completions $fpath)' >> "$shell_rc"
                echo 'autoload -Uz compinit && compinit' >> "$shell_rc"
                log_success "Added Hyve to PATH and completions in $shell_rc"
                ;;
            bash)
                echo 'source "$HOME/.hyve/completions/hyve.bash"' >> "$shell_rc"
                log_success "Added Hyve to PATH and completions in $shell_rc"
                ;;
            *)
                log_success "Added Hyve to PATH in $shell_rc"
                ;;
        esac
    else
        log_info "PATH already configured"
    fi

    echo ""
    echo "─────────────────────────────────────────────────"
    echo ""
    echo -e "${GREEN}${BOLD}Installation complete!${NC}"
    echo ""
    echo "To get started:"
    echo ""
    echo -e "  1. Restart your terminal or run: ${CYAN}source $shell_rc${NC}"
    echo -e "  2. Navigate to your project: ${CYAN}cd ~/my-project${NC}"
    echo -e "  3. Initialize Hyve: ${CYAN}hyve init${NC}"
    echo -e "  4. Create a workspace: ${CYAN}hyve create my-feature repo1 repo2${NC}"
    echo ""
    echo -e "Run ${CYAN}hyve --help${NC} for more commands."
    echo ""
}

uninstall_hyve() {
    log_info "Uninstalling Hyve..."

    # Remove installation directory
    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
        log_success "Removed $INSTALL_DIR"
    fi

    # Remove from shell rc
    local shell_rc=$(detect_shell)
    if [ -f "$shell_rc" ]; then
        sed -i.bak '/.hyve/d' "$shell_rc" 2>/dev/null || true
        sed -i.bak '/Hyve - Multi-Repo/d' "$shell_rc" 2>/dev/null || true
        rm -f "${shell_rc}.bak"
        log_success "Removed from $shell_rc"
    fi

    log_success "Hyve uninstalled"
}

# Main
case "${1:-}" in
    --uninstall)
        uninstall_hyve
        ;;
    *)
        install_hyve
        ;;
esac
