---
description: Project status overview
allowed-tools: Bash
---

> 📖 CLI reference: `bin/rudder -h`

```bash
bin/rudder status [--json]
```

## Additional views

```bash
# PRD/Task lists
rudder prd:list [--json]
rudder task:list --status <s> [--json]

# Dependency analysis
rudder deps:critical [--limit 5]     # Critical paths + top blockers
rudder deps:ready [--limit 5]        # Ready tasks sorted by impact
rudder deps:validate                 # Check for cycles/issues
rudder deps:tree --depth 2 --ready   # Visual tree with ready markers
```
