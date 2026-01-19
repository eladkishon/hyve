#!/bin/bash
# hyve/lib/utils.sh - Utility functions

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Logging functions
log_info() { echo -e "${CYAN}◆${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_step() { echo -e "${BLUE}→${NC} $1"; }

# Print banner
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
    echo -e "    ${DIM}Autonomous Multi-Repo Agent Workspaces${NC}"
    echo ""
}

# Print mini logo
print_logo() {
    echo -e "${YELLOW}⬡${NC} ${BOLD}hyve${NC}"
}

# Check if command exists
require_cmd() {
    if ! command -v "$1" &> /dev/null; then
        log_error "Required command not found: $1"
        exit 1
    fi
}

# Check dependencies
check_dependencies() {
    require_cmd git
    require_cmd docker
    require_cmd jq
}

# Generate random port in range
find_available_port() {
    local base_port=$1
    local port=$base_port
    while [ $port -lt $((base_port + 100)) ]; do
        if ! lsof -i :$port >/dev/null 2>&1; then
            echo $port
            return
        fi
        port=$((port + 1))
    done
    log_error "No available ports found starting from $base_port"
    exit 1
}

# Confirm action
confirm() {
    local message=$1
    local default=${2:-no}

    if [ "$default" = "yes" ]; then
        read -p "$message [Y/n]: " response
        case "$response" in
            [nN][oO]|[nN]) return 1 ;;
            *) return 0 ;;
        esac
    else
        read -p "$message [y/N]: " response
        case "$response" in
            [yY][eE][sS]|[yY]) return 0 ;;
            *) return 1 ;;
        esac
    fi
}

# Print a divider line
divider() {
    echo -e "${DIM}─────────────────────────────────────────────────${NC}"
}

# Print section header
section() {
    echo ""
    echo -e "${BOLD}$1${NC}"
    divider
}

# Box drawing for status display
box_start() {
    echo -e "${DIM}┌─────────────────────────────────────────────────┐${NC}"
}

box_end() {
    echo -e "${DIM}└─────────────────────────────────────────────────┘${NC}"
}

box_line() {
    local text=$1
    printf "${DIM}│${NC} %-47s ${DIM}│${NC}\n" "$text"
}

box_header() {
    local text=$1
    echo -e "${DIM}│${NC} ${BOLD}$text${NC}"
    echo -e "${DIM}├─────────────────────────────────────────────────┤${NC}"
}
