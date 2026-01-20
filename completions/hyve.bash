#!/bin/bash
# hyve bash completion
# Add to ~/.bashrc: source /path/to/hyve/completions/hyve.bash

_hyve_completions() {
    local cur prev words cword
    _init_completion || return

    # All available commands
    local commands="init create list status start stop cleanup shell db install install-commands run halt open services logs up down docker-status docker-logs docker-exec docker-restart docker-rebuild"

    # Commands that take a workspace name as first arg
    local workspace_commands="status start stop cleanup shell db install run halt open services logs up down docker-status docker-logs docker-exec docker-restart docker-rebuild"

    # Commands that take repo names after workspace
    local repo_commands="create run docker-exec"

    # Get list of workspaces
    _hyve_get_workspaces() {
        local config_file
        config_file=$(find . -maxdepth 1 -name ".hyve.yaml" -o -name ".hyve.yml" 2>/dev/null | head -1)
        if [ -n "$config_file" ]; then
            local workspaces_dir
            workspaces_dir=$(grep "^workspaces_dir:" "$config_file" 2>/dev/null | sed 's/workspaces_dir:[[:space:]]*//' | sed 's/^[[:space:]]*//')
            if [ -z "$workspaces_dir" ]; then
                workspaces_dir="./workspaces"
            fi
            if [ -d "$workspaces_dir" ]; then
                ls -1 "$workspaces_dir" 2>/dev/null | grep -v "^\." || true
            fi
        fi
    }

    # Get list of repos from config
    _hyve_get_repos() {
        local config_file
        config_file=$(find . -maxdepth 1 -name ".hyve.yaml" -o -name ".hyve.yml" 2>/dev/null | head -1)
        if [ -n "$config_file" ]; then
            if command -v yq &> /dev/null; then
                yq eval '.repos | keys | .[]' "$config_file" 2>/dev/null | grep -v null || true
            else
                # Fallback: parse repos section with awk
                awk '/^repos:/{flag=1; next} /^[a-z]/ && flag{exit} flag && /^  [a-zA-Z_-]+:/{gsub(/[: ]/, ""); print}' "$config_file" 2>/dev/null || true
            fi
        fi
    }

    # Get services for a workspace
    _hyve_get_services() {
        local workspace="$1"
        local config_file
        config_file=$(find . -maxdepth 1 -name ".hyve.yaml" -o -name ".hyve.yml" 2>/dev/null | head -1)
        if [ -n "$config_file" ]; then
            local workspaces_dir
            workspaces_dir=$(grep "^workspaces_dir:" "$config_file" 2>/dev/null | sed 's/workspaces_dir:[[:space:]]*//' | sed 's/^[[:space:]]*//')
            if [ -z "$workspaces_dir" ]; then
                workspaces_dir="./workspaces"
            fi
            local workspace_config="$workspaces_dir/$workspace/.hyve-workspace.json"
            if [ -f "$workspace_config" ]; then
                jq -r '.repos[]' "$workspace_config" 2>/dev/null || true
            fi
        fi
    }

    case $cword in
        1)
            # First argument: complete commands
            COMPREPLY=($(compgen -W "$commands" -- "$cur"))
            ;;
        2)
            # Second argument: depends on command
            case "$prev" in
                create)
                    # Complete with --existing, --from, or repo names
                    local opts="--existing --from"
                    local repos=$(_hyve_get_repos)
                    COMPREPLY=($(compgen -W "$opts $repos" -- "$cur"))
                    ;;
                status|start|stop|cleanup|shell|db|install|run|halt|open|services|logs|up|down|docker-status|docker-logs|docker-exec|docker-restart|docker-rebuild)
                    # Complete with workspace names
                    local workspaces=$(_hyve_get_workspaces)
                    COMPREPLY=($(compgen -W "$workspaces" -- "$cur"))
                    ;;
                *)
                    COMPREPLY=()
                    ;;
            esac
            ;;
        *)
            # Third+ argument: depends on command
            local cmd="${words[1]}"
            case "$cmd" in
                create)
                    # After workspace name, complete with repo names
                    if [[ "${words[2]}" == "--from" ]]; then
                        # After --from, next is branch name (no completion)
                        # Then repos
                        if [ $cword -ge 4 ]; then
                            local repos=$(_hyve_get_repos)
                            COMPREPLY=($(compgen -W "$repos" -- "$cur"))
                        fi
                    else
                        local repos=$(_hyve_get_repos)
                        COMPREPLY=($(compgen -W "$repos" -- "$cur"))
                    fi
                    ;;
                run)
                    # After workspace name, complete with services
                    local workspace="${words[2]}"
                    local services=$(_hyve_get_services "$workspace")
                    if [ -z "$services" ]; then
                        services=$(_hyve_get_repos)
                    fi
                    COMPREPLY=($(compgen -W "$services" -- "$cur"))
                    ;;
                logs|docker-logs)
                    # After workspace name, complete with services, then -f
                    local workspace="${words[2]}"
                    if [ $cword -eq 3 ]; then
                        local services=$(_hyve_get_services "$workspace")
                        if [ -z "$services" ]; then
                            services=$(_hyve_get_repos)
                        fi
                        COMPREPLY=($(compgen -W "$services -f" -- "$cur"))
                    else
                        COMPREPLY=($(compgen -W "-f" -- "$cur"))
                    fi
                    ;;
                docker-exec)
                    # After workspace, complete with services
                    local workspace="${words[2]}"
                    if [ $cword -eq 3 ]; then
                        local services=$(_hyve_get_services "$workspace")
                        if [ -z "$services" ]; then
                            services=$(_hyve_get_repos)
                        fi
                        COMPREPLY=($(compgen -W "$services" -- "$cur"))
                    fi
                    ;;
                docker-restart|docker-rebuild)
                    # After workspace, complete with services
                    local workspace="${words[2]}"
                    local services=$(_hyve_get_services "$workspace")
                    if [ -z "$services" ]; then
                        services=$(_hyve_get_repos)
                    fi
                    COMPREPLY=($(compgen -W "$services" -- "$cur"))
                    ;;
                down)
                    # Complete with -v
                    COMPREPLY=($(compgen -W "-v" -- "$cur"))
                    ;;
                *)
                    COMPREPLY=()
                    ;;
            esac
            ;;
    esac
}

complete -F _hyve_completions hyve
