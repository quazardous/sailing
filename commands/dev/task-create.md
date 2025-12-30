---
description: Add task to epic (manual)
argument-hint: <PRD-NNN/ENNN> <title>
allowed-tools: Bash
---

> 📖 CLI reference: `.sailing/core/RUDDER.md` or `bin/rudder -h`

```bash
bin/rudder task:create <PRD-NNN/ENNN> <title> [--target-version=comp:ver]
```

## After creation

Add dependencies if needed:
```bash
# Task is blocked by other tasks
rudder deps:add TNNN --blocked-by T001 T002

# OR task blocks other tasks
rudder deps:add TNNN --blocks T050 T051

# Verify no cycles
rudder deps:validate
```

Use only for adding tasks after initial breakdown.
