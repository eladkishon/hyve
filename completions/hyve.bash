#!/bin/bash
# hyve bash completion
# Add to ~/.bashrc: source /path/to/hyve/completions/hyve.bash

_hyve_find_config() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        [[ -f "$dir/.hyve.yaml" ]] && { echo "$dir/.hyve.yaml"; return; }
        [[ -f "$dir/.hyve.yml" ]] && { echo "$dir/.hyve.yml"; return; }
        dir="$(dirname "$dir")"
    done
}

_hyve_get_workspaces() {
    local config_file=$(_hyve_find_config)
    [[ -z "$config_file" ]] && return

    local config_dir="$(dirname "$config_file")"
    local workspaces_dir
    workspaces_dir=$(grep "^workspaces_dir:" "$config_file" 2>/dev/null | cut -d: -f2 | tr -d ' "'"'"'')
    [[ -z "$workspaces_dir" ]] && workspaces_dir="./workspaces"

    # Resolve relative path
    [[ "$workspaces_dir" == ./* ]] && workspaces_dir="$config_dir/${workspaces_dir#./}"

    [[ -d "$workspaces_dir" ]] && ls -1 "$workspaces_dir" 2>/dev/null | grep -v "^\."
}

_hyve_get_repos() {
    local config_file=$(_hyve_find_config)
    [[ -z "$config_file" ]] && return

    awk '/^repos:/{flag=1; next} /^[a-z]/ && flag{exit} flag && /^  [a-zA-Z0-9_-]+:/{gsub(/[: ]/, ""); print}' "$config_file" 2>/dev/null
}

_hyve_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="create list status cleanup db run halt"

    case $cword in
        1)
            COMPREPLY=($(compgen -W "$commands" -- "$cur"))
            ;;
        2)
            case "$prev" in
                create)
                    # Workspace name - no completion, just show options
                    COMPREPLY=($(compgen -W "--from --no-setup" -- "$cur"))
                    ;;
                cleanup)
                    local workspaces=$(_hyve_get_workspaces)
                    COMPREPLY=($(compgen -W "$workspaces -f --force" -- "$cur"))
                    ;;
                status|db|run|halt)
                    local workspaces=$(_hyve_get_workspaces)
                    COMPREPLY=($(compgen -W "$workspaces" -- "$cur"))
                    ;;
                *)
                    COMPREPLY=()
                    ;;
            esac
            ;;
        *)
            local cmd="${words[1]}"
            case "$cmd" in
                create)
                    local repos=$(_hyve_get_repos)
                    COMPREPLY=($(compgen -W "$repos --from --no-setup" -- "$cur"))
                    ;;
                *)
                    COMPREPLY=()
                    ;;
            esac
            ;;
    esac
}

complete -F _hyve_completions hyve
