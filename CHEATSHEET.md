# Rudder Cheatsheet

CLI: `bin/rudder` or `./bin/rudder`

## Read Artifacts

```bash
rudder prd:show PRD-NNN          # PRD summary
rudder epic:show ENNN            # Epic summary
rudder task:show TNNN            # Task details

# Full markdown content
rudder prd:show PRD-NNN --raw
rudder epic:show ENNN --raw
rudder task:show TNNN --raw
```

## Project Status

```bash
rudder status                    # Overview (PRDs, tasks by status)
rudder prd:list                  # All PRDs
rudder epic:list --prd PRD-NNN   # Epics in PRD
rudder task:list --epic ENNN     # Tasks in epic
```

## Dependencies

```bash
rudder deps:ready                # Ready tasks (unblocked)
rudder deps:ready --epic ENNN    # Ready in specific epic
rudder deps:show TNNN            # Task blockers
rudder deps:show ENNN            # Epic blockers
```

## Modify Artifacts

```bash
# Status
rudder task:update TNNN --status Done
rudder epic:update ENNN --status "In Progress"

# Content (stdin patch)
cat <<'PATCH' | rudder task:patch TNNN
<<<<<<< SEARCH
old text
=======
new text
>>>>>>> REPLACE
PATCH

# Section edit
rudder task:edit TNNN -s "## Notes" -c "New content"
rudder task:edit TNNN -s "## Notes" -c "More" --append
```

## Agents

```bash
rudder agent:spawn TNNN          # Start agent (blocking)
rudder agent:spawn TNNN --worktree  # Isolated branch
rudder agent:status              # List agents
rudder agent:status TNNN         # Specific agent
rudder agent:log TNNN            # View log
rudder agent:log TNNN --tail     # Follow log
rudder agent:reap TNNN           # Merge completed work
rudder agent:reject TNNN         # Discard work
```

## Memory

```bash
rudder memory:sync               # Process pending logs
rudder memory:show ENNN          # Epic memory
rudder task:show-memory TNNN     # Full context for task
```

## Create Artifacts

```bash
rudder prd:create "Title"
rudder epic:create "Title" --prd PRD-NNN
rudder task:create "Title" --epic ENNN
```

## Permissions (Claude Code)

```bash
rudder permissions:check         # Verify setup
rudder permissions:fix           # Add missing permissions
```

## Role Reference

| Operation | Role | How to invoke |
|-----------|------|---------------|
| Read artifacts | any | `rudder <entity>:show` |
| Project status | any | `rudder status` |
| Ready tasks | any | `rudder deps:ready` |
| Spawn agent | skill | `rudder agent:spawn TNNN` |
| Epic breakdown | coordinator | `/dev:epic-breakdown` |
| PRD breakdown | coordinator | `/dev:prd-breakdown` |
| Task execution | agent | (via agent:spawn) |

## Tips

- `--json` on any command for machine-readable output
- `--raw` on show commands for full markdown
- `--dry-run` on spawn/patch to preview changes
- Tab completion: `rudder <TAB>` lists commands
