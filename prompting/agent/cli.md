Rudder is the ONLY interface for state. **Never edit frontmatter directly.**

## Read

| Data | Command |
|------|---------|
| Task | `rudder task:show TNNN` |
| Dependencies | `rudder deps:show TNNN` |
| Memory | `rudder task:show-memory TNNN` |

## Write

| Action | Command |
|--------|---------|
| Update status | `rudder task:update TNNN --status Done` |
| Log progress | `rudder task:log TNNN "msg" --info` |
| Log insight | `rudder task:log TNNN "msg" --tip` |

## Allowed Edits

Edit tool ONLY for source code and task body sections (Description, Deliverables, Technical Details).
