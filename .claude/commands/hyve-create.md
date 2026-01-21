# Create a Hyve Workspace

You received: **$ARGUMENTS**

This is free-form text. Parse it naturally to create a workspace.

## How to Parse

The input describes a feature. Convert it to a workspace name:
- Convert to lowercase
- Replace spaces with dashes
- Remove special characters except dashes

Examples:
- `DEV-9387 Fixes for portal` → `dev-9387-fixes-for-portal`
- `Add user auth` → `add-user-auth`

## Steps

1. Create the workspace name from the input
2. Run: `hyve create <workspace-name>`
3. Report the workspace location and service ports

## After Creation

- Run `hyve run <workspace-name>` to start services
- Run `hyve status <workspace-name>` to check status
