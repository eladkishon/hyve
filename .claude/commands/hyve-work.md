# Start Working on a Feature

Input: **$ARGUMENTS**

## Execute This Command

```bash
hyve work "FEATURE_NAME" "TASK_DESCRIPTION"
```

Parse the input:
- **Line 1** (quoted string): Feature name → becomes workspace name
- **Rest**: Task description for the agent

Example:
```
"DEV-9387 Fixes for pending rn changes in portal"

If form was submitted through review form - automatically set document rejections as resolved
```

Run:
```bash
hyve work "DEV-9387 Fixes for pending rn changes in portal" "If form was submitted through review form - automatically set document rejections as resolved"
```

## What Happens

1. **Creates workspace** `dev-9387-fixes-for-pending-rn-changes-in-portal`
2. **Starts all services** (database, server, webapp, etc.)
3. **Launches Claude Code** as a **Meta-Agent Orchestrator**
4. **Agent starts working** with full context of all repos

## Meta-Agent Architecture

The launched Claude instance acts as an **orchestrator**:
- Analyzes task and determines which repos need changes
- Can spawn sub-agents for complex per-repo work
- Coordinates cross-repo changes (API → schema → frontend)
- Tracks status and checkpoints before commits

## Monitoring

Check status anytime:
```bash
hyve dashboard           # Overview of all workspaces
hyve dashboard -w NAME   # Detailed view of specific workspace
```
