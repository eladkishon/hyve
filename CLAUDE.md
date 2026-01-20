# Hyve Framework

Multi-repo workspace management for isolated feature development.

## Architecture

```
hyve/
├── bin/hyve              # CLI entry point
├── lib/
│   ├── common.sh         # Shared utilities, logging, config parsing
│   ├── workspace.sh      # Workspace creation, .env generation
│   ├── services.sh       # Service orchestration (start/stop/status)
│   ├── database.sh       # Database cloning via Docker
│   └── docker.sh         # Docker-based isolation (optional)
├── examples/             # Example .hyve.yaml configs
└── install.sh            # Installation script
```

## Key Concepts

### Port Isolation

Each workspace gets isolated ports calculated from the config:
- `base_port` (default: 4000) + `workspace_index * port_offset` (default: 1000)
- Service offsets are calculated from `default_port - 3000`

Example: workspace index 0, server (default_port: 3000) → 4000, webapp (default_port: 3001) → 4001

### .env Generation

When creating a workspace, hyve:
1. Copies `.env` from main repo (priority: `.env` > `.env.example` > empty)
2. Replaces `DATABASE_URL` and `POSTGRES_PORT` with workspace database port
3. Replaces `PORT=` line with workspace-specific port
4. Generically replaces all `localhost:default_port` → `localhost:workspace_port` for every service defined in config

### Config Structure (.hyve.yaml)

```yaml
services:
  base_port: 4000
  port_offset: 1000
  definitions:
    server:
      default_port: 3000      # Used for sed replacement: localhost:3000 → localhost:4000
      dev_command: "pnpm dev"
      env_var: "PORT"
    webapp:
      default_port: 3001
      dev_command: "pnpm dev"
    socketio:
      default_port: 3002      # If .env has localhost:3002, replaced with workspace port
```

## Key Functions (lib/workspace.sh)

### Port Helpers

```bash
get_service_port "$service"         # Returns workspace port for service
get_service_default_port "$service" # Returns default_port from config
get_all_services                    # Lists all service names from config
```

### Workspace Creation Flow

1. Parse arguments (feature name, repos, --from branch)
2. Add required_repos from config
3. Create git worktrees for each repo **IN PARALLEL**
4. Run setup scripts (pnpm install) **IN PARALLEL** via login shell for proper nvm loading
5. Clone database (Docker PostgreSQL on unique port)
6. Generate .env files with port replacements

### Parallelization

The framework parallelizes independent operations:
- **Worktree creation**: Each repo's worktree is created in a background job
- **Setup scripts**: All `pnpm install` commands run concurrently
- Results are collected after all jobs complete

## Common Modifications

### Adding a New Service

1. Add to `.hyve.yaml` under `services.definitions`:
```yaml
my-service:
  default_port: 3005
  dev_command: "pnpm dev"
```

2. If always needed, add to `required_repos`

3. The framework will automatically:
   - Calculate workspace port (base_port + offset)
   - Replace `localhost:3005` → `localhost:{workspace_port}` in all .env files

### Changing Port Calculation

The offset formula in `get_service_port()`:
```bash
offset=$((default_port - 3000))
workspace_port=$((workspace_base + offset))
```

To change, modify `lib/workspace.sh:get_service_port()`

## Testing Changes

```bash
# Create test workspace
hyve create test-feature server webapp

# Check generated .env
cat workspaces/test-feature/server/.env | grep -E "PORT|DATABASE_URL|localhost"

# Start services
hyve run test-feature

# Cleanup
hyve cleanup test-feature
```

## Dependencies

- `yq` - YAML parsing (required for service definitions)
- `docker` - Database cloning
- `git` - Worktree management
- `bash` - Shell scripting (uses login shell for nvm/volta)
