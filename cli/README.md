# Hyve

**Workspaces for AI Agents**

Run multiple AI agents in parallel. Each gets isolated git branches, databases, and ports. Zero conflicts.

## Install

```bash
npm install -g hyve-cli
```

## Quick Start

```bash
# Initialize in your project
hyve init

# Create an isolated workspace
hyve create auth-feature server webapp

# Start all services
hyve run auth-feature

# Point your AI agent at the workspace
claude --cwd ~/workspaces/auth-feature
```

## Features

- **Git Worktrees** - Each workspace gets its own branch
- **Database Cloning** - Instant PostgreSQL snapshots via Docker
- **Port Isolation** - No conflicts between services
- **Agent Ready** - Works with Claude, Cursor, Aider, and any AI agent

## Running Multiple Agents

```bash
# Terminal 1: Claude working on auth
hyve create auth-feature server && hyve run auth-feature
claude --cwd ~/workspaces/auth-feature

# Terminal 2: Cursor working on billing
hyve create billing-api server && hyve run billing-api
cursor ~/workspaces/billing-api

# Terminal 3: Aider working on UI
hyve create ui-refactor webapp && hyve run ui-refactor
cd ~/workspaces/ui-refactor && aider
```

## Commands

| Command | Description |
|---------|-------------|
| `hyve init` | Initialize Hyve in current directory |
| `hyve create <name> [repos...]` | Create a new workspace |
| `hyve attach <workspace> [repos...]` | Attach repos to existing workspace |
| `hyve run <workspace>` | Start all services |
| `hyve stop <workspace>` | Stop all services |
| `hyve list` | List all workspaces |
| `hyve cleanup <workspace>` | Remove a workspace |

## Documentation

Full documentation: https://eladkishon.github.io/hyve

## License

MIT
