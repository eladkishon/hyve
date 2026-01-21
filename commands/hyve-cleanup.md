# Cleanup Hyve Workspace

Remove the workspace: **$ARGUMENTS**

## What This Does

1. Stop all running services for the workspace
2. Remove the database container
3. Remove the workspace directory
4. Git branches are preserved (not deleted)

## Command

```bash
hyve cleanup $ARGUMENTS
```

## Confirmation

Before running, confirm with the user that they want to remove the workspace. This action cannot be undone (except for git branches which are preserved).
