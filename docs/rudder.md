# Rudder CLI

Rudder is the state management CLI for the sailing skill. It's the single source of truth for PRDs, Epics, Tasks, and dependencies.

## Core Principle

**Rudder manages state, Claude executes.** All status changes, entity creation, and dependency tracking go through Rudder.

## Usage

```bash
bin/rudder <group>:<command> [options]
bin/rudder -h                    # All commands
bin/rudder <group> -h            # Group commands
```

## Quick Reference

```bash
# Project overview
bin/rudder status                # Tasks by status, PRDs list
bin/rudder versions              # Component versions
bin/rudder paths                 # Authoritative paths for agents

# Find work
bin/rudder task:next             # First ready task
bin/rudder deps:ready -l 5       # Top 5 by impact

# Work on task
bin/rudder task:start T042       # Set In Progress
bin/rudder task:done T042        # Set Done

# Dependencies
bin/rudder deps:show T042        # Blockers and dependents
bin/rudder deps:validate --fix   # Fix cycles/issues
```

## Command Groups

| Group | Purpose |
|-------|---------|
| `prd` | PRD operations (list, show, create, update) |
| `story` | Story operations (list, show, create, validate) |
| `epic` | Epic operations (list, show, create, update) |
| `task` | Task operations (list, show, create, update, next, start, done, log) |
| `deps` | Dependency graph (tree, validate, impact, ready, critical) |
| `memory` | Memory sync operations |
| `permissions` | Claude Code permissions management |

## Paths (Authoritative Source)

`rudder paths` is the single source of truth for agent paths:

```bash
bin/rudder paths                 # List all paths (relative)
bin/rudder paths --json          # JSON output
bin/rudder paths roadmap         # Absolute path to ROADMAP.md
bin/rudder paths artefacts       # Absolute path to artefacts dir
```

Available keys: `roadmap`, `postit`, `artefacts`, `templates`

Use in scripts/commands:
```bash
ROADMAP=$(bin/rudder paths roadmap)
ARTEFACTS=$(bin/rudder paths artefacts)
```

## Permissions

Manage Claude Code permissions required for sailing:

```bash
bin/rudder permissions:check     # Check if permissions are configured
bin/rudder permissions:fix       # Add missing permissions
bin/rudder permissions:list      # Show required permissions
bin/rudder permissions:show      # Show current settings
```

The installer runs `permissions:fix` automatically. Use `permissions:check` to verify.

## Creating Entities

Always use Rudder to create PRDs, Epics, Tasks, and Stories:

```bash
bin/rudder prd:create "Feature Title"
bin/rudder epic:create PRD-001 "Epic Title"
bin/rudder task:create PRD-001/E001 "Task Title"
bin/rudder story:create PRD-001 "Story Title" --type user
```

**Never create entity files manually** - Rudder manages IDs and state tracking.

## Status Management

```bash
bin/rudder task:update T042 --status wip      # In Progress
bin/rudder task:update T042 --status done     # Done
bin/rudder task:update T042 --status blocked  # Blocked
```

Status aliases: `wip` → In Progress, `todo` → Not Started, `done` → Done

## Task Logging

Log insights during task execution:

```bash
bin/rudder task:log T042 "Found workaround for X" --tip
bin/rudder task:log T042 "API changed, need to adapt" --warn
bin/rudder task:log T042 "Cannot proceed, missing Y" --error
```

Logs are consolidated into epic memory for future agents.

## Dependencies

```bash
# Add dependency
bin/rudder deps:add T042 --blocked-by T001

# Validate graph
bin/rudder deps:validate --fix

# View dependencies
bin/rudder deps:show T042
bin/rudder deps:tree T042
```

## Full Documentation

Run `bin/rudder -h` after installation for complete reference.
