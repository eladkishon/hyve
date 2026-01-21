<p align="center">
  <img src="assets/logo.png" width="400" alt="Hyve Logo">
</p>

<p align="center">
  <strong>Isolated Workspaces for AI Agents & Multi-Repo Development</strong>
</p>

<p align="center">
  Run multiple Claude Code, Cursor, or Aider sessions in parallel.<br>
  Each agent gets isolated git branches, databases, and services.
</p>

<p align="center">
  <a href="https://github.com/eladkishon/hyve/actions/workflows/ci.yml">
    <img src="https://github.com/eladkishon/hyve/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/eladkishon/hyve/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <a href="https://github.com/eladkishon/hyve">
    <img src="https://img.shields.io/github/stars/eladkishon/hyve?style=social" alt="GitHub Stars">
  </a>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#configuration">Configuration</a>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/eladkishon">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee">
  </a>
</p>

---

## Why Hyve?

There are great git worktree managers out there ([gwq](https://github.com/d-kuro/gwq), [gtr](https://github.com/coderabbitai/git-worktree-runner)). But they only manage **code**.

Real features need more than branches:

| Problem | Worktree managers | Hyve |
|---------|-------------------|------|
| Git branches across multiple repos | ✅ | ✅ |
| Isolated database per feature | ❌ | ✅ |
| Run full stack with correct ports | ❌ | ✅ |
| Auto-configure .env files | ❌ | ✅ |
| Service health checks | ❌ | ✅ |

**Hyve gives you complete environment isolation**, not just code isolation.

## The Problem

You're working on `feature-A` and need to quickly test `feature-B`:

```bash
# The old way 😰
git stash
git checkout feature-b
# Wait, the database has feature-A migrations...
# And the .env points to wrong ports...
# And there's state in Redis...
# 2 hours later, you forgot what you were doing
```

## The Solution

```bash
# The Hyve way 🎉
hyve create feature-b server webapp
hyve run feature-b

# feature-A is still running in another terminal
# Both have isolated databases, correct ports, everything works
```

```
~/project/workspaces/
├── feature-a/
│   ├── server/       → git worktree on feature/feature-a
│   ├── webapp/       → git worktree on feature/feature-a
│   └── database      → postgres container on port 5500
│
├── feature-b/
│   ├── server/       → git worktree on feature/feature-b
│   ├── webapp/       → git worktree on feature/feature-b
│   └── database      → postgres container on port 5501
```

## Perfect for AI Coding Agents

Running multiple Claude Code / Cursor / Aider sessions in parallel? Each agent needs its own isolated environment:

- **Isolated branches** - agents don't conflict on git state
- **Isolated databases** - agents can run migrations without breaking each other
- **Isolated ports** - run full stack per agent session

```bash
# Terminal 1: Agent working on auth feature
hyve create auth server webapp && hyve run auth
# Claude Code works on localhost:4000

# Terminal 2: Agent working on billing feature
hyve create billing server webapp && hyve run billing
# Claude Code works on localhost:5000 (auto port offset)
```

## Installation

```bash
git clone https://github.com/eladkishon/hyve.git ~/.hyve
echo 'export PATH="$HOME/.hyve/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Requirements:** Node.js 22+, git 2.5+, Docker (for database isolation)

## Quick Start

### 1. Initialize in your project

```bash
cd ~/my-project
hyve init
```

### 2. Create a workspace

```bash
hyve create my-feature server webapp
```

This:
- Creates git worktrees for each repo on `feature/my-feature` branch
- Spins up an isolated PostgreSQL container
- Clones your dev database
- Configures .env files with correct ports

### 3. Run your stack

```bash
hyve run my-feature
```

Starts all services with health checks, correct port bindings, and environment variables.

### 4. Clean up

```bash
hyve cleanup my-feature
```

Removes workspace directory and database container. Git branches are preserved.

## Commands

| Command | Description |
|---------|-------------|
| `hyve create <name> [repos...]` | Create workspace with git worktrees + database |
| `hyve run <name> [services...]` | Start services with health checks |
| `hyve halt <name>` | Stop all services |
| `hyve status [name]` | Show workspace/service status |
| `hyve db <name>` | Connect to workspace database (psql) |
| `hyve cleanup <name>` | Remove workspace |
| `hyve list` | List all workspaces |

## Configuration

Create `.hyve.yaml` in your project root:

```yaml
workspaces_dir: ./workspaces

# Repos to include in workspaces
repos:
  server:
    path: ./server
    remote: git@github.com:myorg/server.git
    setup_script: "pnpm install"
  webapp:
    path: ./webapp
    remote: git@github.com:myorg/webapp.git
    setup_script: "pnpm install"

# Required repos (always included)
required_repos:
  - server
  - webapp

# Database cloning
database:
  enabled: true
  source_port: 5432        # Your dev database
  base_port: 5500          # Feature DBs: 5500, 5501, 5502...
  user: postgres
  password: postgres
  name: mydb
  seed_command: "psql -f seed.sql -p ${port}"  # Optional seeding

# Service orchestration
services:
  port_offset: 1000        # Port increment between workspaces
  base_port: 4000
  shell_wrapper: "source ~/.nvm/nvm.sh && nvm use &&"

  definitions:
    server:
      default_port: 3000
      dev_command: "pnpm dev"
      env_var: "PORT"
      health_check: "http://localhost:${port}/"
    webapp:
      default_port: 3001
      dev_command: "pnpm dev"
      depends_on: [server]
      env:
        API_URL: "http://localhost:${server_port}"

# Branch naming
branches:
  prefix: feature/
  base: main
```

## How It Works

### Git Worktrees

Instead of switching branches, hyve creates separate working directories:

```bash
git worktree add workspaces/my-feature/server -b feature/my-feature
```

Both features exist simultaneously. No stashing, no context loss.

### Database Cloning

Each workspace gets its own PostgreSQL container:

```bash
docker run -d --name hyve-db-my-feature -p 5500:5432 postgres:15
pg_dump source_db | psql -p 5500  # Clone data
```

### Port Management

Workspace 0: server:4000, webapp:4001, db:5500
Workspace 1: server:5000, webapp:5001, db:5501

All automatically configured in .env files.

## VS Code Integration

Hyve automatically updates your VS Code workspace file (`.code-workspace`) when creating workspaces:

```
my-project.code-workspace
├── server              # Main repo
├── webapp              # Main repo
├── [feature-a] server  # Workspace worktree
├── [feature-a] webapp  # Workspace worktree
├── [feature-b] server  # Another workspace
└── [feature-b] webapp
```

All your workspaces appear in the same VS Code window, organized by feature. Switch between features instantly without opening new windows.

## Claude Code Integration

### Slash Commands

Install slash commands for Claude Code:

```bash
hyve install-commands
```

This adds commands to your project's `.claude/commands/`:

| Command | Description |
|---------|-------------|
| `/hyve-create <name>` | Create a new workspace |
| `/hyve-work <name>` | Set context for working in a workspace |
| `/hyve-status` | Check workspace and service status |
| `/hyve-cleanup <name>` | Remove a workspace |

### MCP Server

Hyve includes an MCP server so Claude can manage workspaces directly:

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "hyve": {
      "command": "node",
      "args": ["~/.hyve/mcp/dist/index.js"]
    }
  }
}
```

Available MCP tools:
- `hyve_create` - Create workspace
- `hyve_run` - Start services
- `hyve_halt` - Stop services
- `hyve_status` - Get status
- `hyve_list` - List workspaces
- `hyve_cleanup` - Remove workspace

### Agent Session Tracking

Track which AI agents are working on which workspaces:

```bash
# Register an agent session
hyve agent start my-feature --description "Implementing auth flow"

# List active sessions
hyve agent list
# Output:
#   a1b2c3d4 → my-feature (2h)
#     Implementing auth flow
#   e5f6g7h8 → billing (45m)
#     Adding Stripe integration

# End a session
hyve agent stop a1b2c3d4

# Clean up stale sessions
hyve agent clean
```

### CLAUDE.md Generation

Every workspace gets an auto-generated `CLAUDE.md` with:
- Workspace branch and location
- Database connection info
- Service ports table
- Quick command reference

This gives Claude instant context when working in a workspace.

## Real-World Example

From the Medflyt healthcare platform (10+ repos, 100+ developers):

```yaml
required_repos: [server, webapp, mobile, socketio]

services:
  definitions:
    server:
      default_port: 3000
      health_check: "http://localhost:${port}/"
    webapp:
      default_port: 3001
      depends_on: [server]
      pre_run: "pnpm openapi:local"  # Regenerate API types
    mobile:
      default_port: 8080
      depends_on: [server]
```

## Contributing

Contributions welcome! This started as an internal tool at Medflyt and we're excited to share it.

## Support

If Hyve saves you time, consider buying me a coffee:

<a href="https://buymeacoffee.com/eladkishon">
  <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee">
</a>

## License

MIT

---

<p align="center">
  <strong>Hyve</strong> - Full-stack isolation for the hive mind
</p>
