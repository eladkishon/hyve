# Work on a Hyve Workspace

You are now working in the Hyve workspace: **$ARGUMENTS**

## Context

This is an isolated workspace with:
- Git worktrees on the feature branch
- Isolated database (check .env for DATABASE_URL)
- Service ports offset from the main dev environment

## Your Task

1. First, understand the current state:
   - Read the workspace's CLAUDE.md if it exists
   - Check `hyve status $ARGUMENTS` for service status
   - Review the .env files for configuration

2. Work on the task described in the conversation

3. Before committing:
   - Run tests if applicable
   - Ensure the code follows existing patterns
   - Create a checkpoint for review

## Workspace Location

The workspace is at: `workspaces/$ARGUMENTS/`

Each repo in the workspace has its own directory with an independent git worktree.

## Services

To start services: `hyve run $ARGUMENTS`
To stop services: `hyve halt $ARGUMENTS`
To check status: `hyve status $ARGUMENTS`
