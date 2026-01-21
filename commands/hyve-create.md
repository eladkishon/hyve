# Create a Hyve Workspace

Create an isolated workspace for the feature: **$ARGUMENTS**

## Steps

1. Run `hyve create $ARGUMENTS` to create the workspace
2. This will:
   - Create git worktrees for each repo on `feature/$ARGUMENTS` branch
   - Spin up an isolated PostgreSQL database
   - Clone data from the dev database
   - Configure .env files with correct ports
3. Report the workspace location and service ports

## After Creation

Once the workspace is created, you can:
- `cd` into the workspace directory to start working
- Run `hyve run $ARGUMENTS` to start all services
- The workspace has its own isolated database and ports

## Example

```bash
hyve create my-feature server webapp
```
