#!/bin/bash
# hyve/lib/commands.sh - Claude Code command installation

# Install slash commands for Claude Code
cmd_install_commands() {
    local project_root=$(get_project_root)
    local commands_dir="$project_root/.claude/commands"

    mkdir -p "$commands_dir"

    log_info "Installing Claude Code slash commands..."

    # hyve-create command
    cat > "$commands_dir/hyve-create.md" << 'EOF'
Create a new Hyve feature workspace.

Arguments: $ARGUMENTS

Format: <feature-name> [repos...] or --existing to select from existing branches

Examples:
- /hyve-create user-auth backend frontend
- /hyve-create --existing
- /hyve-create --from existing-branch backend

## Steps:

1. Parse arguments to determine feature name and repos
2. Run: `hyve create <feature-name> [repos...]`
3. Report the workspace location and branch name
4. Suggest next steps

## If --existing flag:
Show list of existing feature branches and let user select one.
EOF
    log_success "Created hyve-create command"

    # hyve-status command
    cat > "$commands_dir/hyve-status.md" << 'EOF'
Show status of Hyve workspaces.

Arguments: $ARGUMENTS (optional feature name)

## Steps:

1. Run: `hyve status [feature-name]`
2. If specific feature, show detailed status including:
   - Git status for each repo
   - Database status
   - Uncommitted changes
3. If no feature specified, list all workspaces
EOF
    log_success "Created hyve-status command"

    # hyve-work command
    cat > "$commands_dir/hyve-work.md" << 'EOF'
Start working on a Hyve feature with a single command.

Arguments: $ARGUMENTS (format: <feature-name> [repos...] -- <task-description>)

Examples:
- /hyve-work user-auth -- "Add password reset endpoint"
- /hyve-work user-auth server webapp -- "Add login API"
- /hyve-work --from existing-branch server -- "Continue work on feature"

## Pre-flight (auto-setup):

1. Check if workspace exists: `hyve status <feature-name>`
2. If workspace does NOT exist:
   - Parse repos from arguments (or use all repos if none specified)
   - Create it: `hyve create <feature-name> [repos...]` or `hyve create --from <branch> [repos...]`
   - Report the new workspace creation to the user
3. If workspace exists:
   - Report that existing workspace is being used
4. Start services: `hyve start <feature-name>`
5. Read workspace config from .hyve-workspace.json

## Argument Parsing:

- Everything before `--` is workspace config (feature name, optional repos, optional --from flag)
- Everything after `--` is the task description
- If no `--` separator, treat last quoted argument as task description

## Agent Configuration:

Spawn a Task agent with:
- subagent_type: "general-purpose"
- run_in_background: true

## Agent Prompt Template:

You are working on feature "<feature-name>" in an isolated Hyve workspace.

WORKSPACE: <workspace-path>
BRANCH: <branch-name>
REPOS: <list of repos>
DATABASE: <if enabled, port number>

TASK: <task-description>

PROTOCOL:
1. EXPLORE - Understand the codebase and requirements
2. IMPLEMENT - Make changes following existing patterns
3. TEST - Run tests, fix failures
4. CHECKPOINT - Before committing, STOP and report:
   - Summary of changes per repo
   - Files modified
   - Test results
   - Proposed commit messages

DO NOT COMMIT without approval. Wait for user to approve, modify, or reject.

CROSS-REPO COORDINATION:
- Backend changes first
- Regenerate API schemas
- Frontend changes after schema sync
- Commit in sequence with cross-references
EOF
    log_success "Created hyve-work command"

    # hyve-cleanup command
    cat > "$commands_dir/hyve-cleanup.md" << 'EOF'
Clean up a Hyve feature workspace.

Arguments: $ARGUMENTS (feature name)

## Pre-flight:
1. Check for uncommitted changes
2. Check for unpushed commits
3. Warn user if any pending work

## Steps:
1. Run: `hyve cleanup <feature-name>`
2. Confirm with user
3. Report cleanup completion

Note: Git branches are preserved in main repos. Only the workspace is removed.
EOF
    log_success "Created hyve-cleanup command"

    echo ""
    log_success "Slash commands installed to $commands_dir"
    echo ""
    echo "Available commands:"
    echo "  /hyve-create   - Create new workspace"
    echo "  /hyve-status   - Check workspace status"
    echo "  /hyve-work     - Spawn agent for feature"
    echo "  /hyve-cleanup  - Remove workspace"
    echo ""
}
