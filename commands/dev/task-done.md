---
description: Complete task
argument-hint: <TNNN>
allowed-tools: Read, Edit, Glob, Task, Bash
---

**Atomic: mark task done + cascade status updates.**

> 📖 CLI reference: `bin/rudder -h`

1. Mark done: `rudder task:update TNNN --status Done`
2. Show impact: `rudder deps:impact TNNN` (what's now unblocked)
3. **Spawn agent**: Check cascades:
   - All epic tasks done? → `rudder epic:update ENNN --status Done`
   - All PRD epics done? → `rudder prd:update PRD-NNN --status Done`
4. Report: task status, tasks unblocked, epic status, PRD status

> ℹ️ Version bump is triggered by SKILL (if task has `target_versions`), not by this command.
