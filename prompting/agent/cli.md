Rudder is the ONLY interface for sailing artifacts. **NEVER use Edit tool on `.sailing/` files.**

## Read

| Data | Command |
|------|---------|
| Task | `rudder task:show TNNN` |
| Dependencies | `rudder deps:show TNNN` |
| Memory | `rudder task:show-memory TNNN` |

## Write Metadata (frontmatter)

| Action | Command |
|--------|---------|
| Update status | `rudder task:update TNNN --status Done` |
| Add blocker | `rudder task:update TNNN --add-blocker TXXX` |
| Log progress | `rudder task:log TNNN "msg" --info` |
| Log insight | `rudder task:log TNNN "msg" --tip` |

## Write Content (body sections)

| Action | Command |
|--------|---------|
| Edit section | `rudder artifact:edit TNNN --section "Deliverables" --content "..."` |
| Append | `rudder artifact:edit TNNN --section "Notes" --append "..."` |
| Check item | `rudder artifact:check TNNN "item text"` |
| Patch (agents) | `rudder task:patch TNNN` with SEARCH/REPLACE blocks |

## Allowed Edit Tool Usage

Edit tool ONLY for **source code** (project files, not sailing artifacts).
