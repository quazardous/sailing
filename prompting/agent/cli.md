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

## Write Content (body)

| Action | Command |
|--------|---------|
| Patch content | `cat <<'PATCH' \| rudder task:patch TNNN` |
| Check deliverable | `rudder artifact:check TNNN "item text"` |

Patch syntax (stdin):
```
<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE
```

## Allowed Edit Tool Usage

Edit tool ONLY for **source code** (project files, not sailing artifacts).
