# CLI Contract

Rudder is the ONLY interface for state operations.

## Queries (read)

| Data | Command | NEVER |
|------|---------|-------|
| Task metadata | `rudder task:show TNNN` | Read .md files |
| Task list | `rudder task:list` | Glob/Grep |
| Dependencies | `rudder deps:show TNNN` | Parse blocked_by |
| Ready tasks | `rudder deps:ready` | Manual analysis |
| Memory | `rudder task:show-memory TNNN` | Read memory files |

## Mutations (write)

| Action | Command | NEVER |
|--------|---------|-------|
| Create task/epic | `rudder task:create`, `rudder epic:create` | Write tool |
| Update status | `rudder task:update TNNN --status Done` | Edit frontmatter |
| Add dependency | `rudder deps:add TNNN --blocked-by T001` | Edit blocked_by |
| Log progress | `rudder task:log TNNN "msg" --level` | Write .log files |

## Body Content

Edit tool allowed ONLY for:
- Source code files being implemented
- Body sections (Description, Deliverables, Technical Details)

**NEVER edit frontmatter directly.**

## If rudder not found

1. Check `pwd` - may be in subproject
2. Use absolute path: `<project>/bin/rudder`
3. Still not found → **STOP and escalate**
