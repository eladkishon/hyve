<p align="center">
  <img src="assets/logo.svg" width="120" alt="Hyve Logo">
</p>

<h1 align="center">⬡ Hyve</h1>

<p align="center">
  <strong>Autonomous Multi-Repo Agent Workspaces</strong>
</p>

<p align="center">
  Create isolated feature workspaces with git worktrees and database cloning<br>
  for parallel multi-repo development with Claude Code
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#claude-code-integration">Claude Code</a>
</p>

---

## The Problem

Working on features that span multiple repositories is painful:
- Switching branches across repos breaks your environment
- Database state gets corrupted when testing different features
- Can't work on multiple features in parallel
- Context switching kills productivity

## The Solution

**Hyve** creates isolated workspaces for each feature:

```
~/my-project/workspaces/
├── feature-auth/           # Working on authentication
│   ├── backend/            # Git worktree → feature/auth
│   ├── frontend/           # Git worktree → feature/auth
│   └── .env                # DATABASE_URL → port 5500
│
├── feature-billing/        # Working on billing (in parallel!)
│   ├── backend/            # Git worktree → feature/billing
│   ├── frontend/           # Git worktree → feature/billing
│   └── .env                # DATABASE_URL → port 5501
```

Each workspace gets:
- **Isolated git branches** via worktrees (no more `git stash`)
- **Isolated database** cloned from your dev DB (optional)
- **Claude Code integration** for autonomous agent development

## Installation

```bash
# Clone the repo
git clone https://github.com/eladkishon/hyve.git ~/.hyve

# Add to PATH (add to your .bashrc/.zshrc)
export PATH="$HOME/.hyve/bin:$PATH"

# Or use the install script
curl -fsSL https://raw.githubusercontent.com/eladkishon/hyve/main/install.sh | bash
```

### Requirements

- `git` (with worktree support, v2.5+)
- `docker` (for database isolation)
- `jq` (for JSON parsing)
- Optional: `yq` (for better YAML parsing)

## Quick Start

### 1. Initialize in your project

```bash
cd ~/my-project
hyve init
```

This creates `.hyve.yaml` with auto-detected repos.

### 2. Configure your repos

Edit `.hyve.yaml`:

```yaml
workspaces_dir: ./workspaces

repos:
  backend:
    path: ./backend
    remote: git@github.com:myorg/backend.git
  frontend:
    path: ./frontend
    remote: git@github.com:myorg/frontend.git

database:
  enabled: true
  source_port: 5432      # Your dev database
  base_port: 5500        # Feature DBs start here
  user: postgres
  password: postgres
  name: mydb
```

### 3. Create a feature workspace

```bash
# New feature (creates new branches)
hyve create user-auth backend frontend

# From existing branch
hyve create --existing                    # Interactive selection
hyve create --from my-branch backend      # Specific branch
```

### 4. Work on your feature

```bash
cd workspaces/user-auth
# Your repos are here on feature/user-auth branches
# Database is running on an isolated port
```

### 5. Clean up when done

```bash
hyve cleanup user-auth
# Removes workspace, keeps git branches
```

## Features

### 🌲 Git Worktree Isolation

Each feature gets worktrees instead of branch switching:
- No `git stash` needed
- Work on multiple features simultaneously
- Branches are preserved when workspace is deleted

### 🗄️ Database Cloning

Optionally clone your dev database for each feature:
- Each workspace gets its own PostgreSQL container
- Cloned from your running dev database
- Isolated ports (5500, 5501, 5502...)
- No more "who broke the dev database?"

### 🤖 Claude Code Integration

Built for autonomous AI development:
- Slash commands for Claude Code
- Semi-autonomous agent protocol
- Cross-repo coordination support

### 📋 Branch Selection

Work with existing branches:
```bash
# Interactive: shows all feature/* branches
hyve create --existing

# Specific branch
hyve create --from existing-feature backend frontend
```

## Commands

| Command | Description |
|---------|-------------|
| `hyve init` | Initialize hyve in current directory |
| `hyve create <name> [repos...]` | Create new feature workspace |
| `hyve create --existing` | Create from existing branch (interactive) |
| `hyve create --from <branch>` | Create from specific branch |
| `hyve list` | List all workspaces |
| `hyve status [name]` | Show workspace status |
| `hyve start <name>` | Start database for workspace |
| `hyve stop <name>` | Stop database for workspace |
| `hyve cleanup <name>` | Remove workspace |
| `hyve shell <name>` | Open shell in workspace |
| `hyve db <name>` | Connect to workspace database (psql) |
| `hyve install-commands` | Install Claude Code slash commands |

## Configuration

### `.hyve.yaml` Reference

```yaml
# Where to create workspaces (relative to this file)
workspaces_dir: ./workspaces

# Repository definitions
repos:
  backend:
    path: ./backend              # Path relative to project root
    remote: git@github.com:...   # Optional, for reference
  frontend:
    path: ./frontend

# Database configuration (optional)
database:
  enabled: true                  # Set to false to disable
  image: postgres:15             # Docker image
  source_port: 5432              # Dev DB to clone from
  base_port: 5500                # Starting port for feature DBs
  user: postgres
  password: postgres
  name: mydb

# Branch naming
branches:
  prefix: feature/               # Branches: feature/<name>

# Claude Code agent settings
agent:
  autonomy: semi                 # full, semi, supervised
  checkpoint_before_commit: true
```

## Claude Code Integration

### Install Slash Commands

```bash
hyve install-commands
```

This adds to your `.claude/commands/`:
- `/hyve-create` - Create workspace
- `/hyve-status` - Check status
- `/hyve-work` - Spawn autonomous agent
- `/hyve-cleanup` - Remove workspace

### Agent Protocol

When you run `/hyve-work my-feature "Add user authentication"`:

1. **Explore** - Agent reads codebase, understands requirements
2. **Implement** - Makes changes following existing patterns
3. **Test** - Runs tests, fixes failures
4. **Checkpoint** - Stops and reports changes before committing

You approve, modify, or reject. The agent never commits without permission.

### Cross-Repo Coordination

For features spanning repos (e.g., API + frontend):

1. Backend changes first
2. Schema regeneration (`pnpm openapi:local` or similar)
3. Frontend changes
4. Coordinated commits with cross-references

## Examples

### Monorepo with Multiple Services

```yaml
repos:
  api:
    path: ./services/api
  web:
    path: ./apps/web
  mobile:
    path: ./apps/mobile
  shared:
    path: ./packages/shared
```

### Multi-Repo Project

```yaml
repos:
  backend:
    path: ../backend
    remote: git@github.com:myorg/backend.git
  frontend:
    path: ../frontend
    remote: git@github.com:myorg/frontend.git
```

### Without Database

```yaml
database:
  enabled: false
```

## How It Works

### Git Worktrees

Instead of:
```bash
cd backend && git checkout feature/auth
cd ../frontend && git checkout feature/auth
# 😰 Can't work on billing now without stashing
```

Hyve does:
```bash
git worktree add workspaces/auth/backend -b feature/auth
git worktree add workspaces/auth/frontend -b feature/auth
# 🎉 Both features exist simultaneously
```

### Database Cloning

```bash
# Start isolated PostgreSQL
docker run -d --name hyve-db-auth -p 5500:5432 postgres:15

# Clone from dev database (using container's pg_dump to avoid version mismatch)
docker exec hyve-db-auth pg_dump -h host.docker.internal -p 5432 ... | \
docker exec -i hyve-db-auth psql ...
```

## Troubleshooting

### "Database clone failed"

Your dev database must be accessible from Docker:
- macOS: Uses `host.docker.internal`
- Linux: Uses `172.17.0.1` (Docker bridge)

Check: `psql -h localhost -p <source_port> -U postgres`

### "Worktree already exists"

The branch may already have a worktree. Check:
```bash
cd your-repo
git worktree list
```

### "Permission denied"

Ensure hyve is executable:
```bash
chmod +x ~/.hyve/bin/hyve
```

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE)

---

<p align="center">
  <strong>⬡ Hyve</strong> - Isolated workspaces for the hive mind
</p>
