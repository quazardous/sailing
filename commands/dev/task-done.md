---
description: Complete task
argument-hint: <TNNN>
allowed-tools: Read, Edit, Glob, Task, mcp
---

**Atomic: mark task done + cascade status updates.**

1. Mark done: `workflow_complete { "task_id": "TNNN", "message": "..." }`
2. Show impact: `deps_show { "id": "TNNN" }` (what's now unblocked)
3. **Spawn agent**: Check cascades:
   - All epic tasks done? → `artefact_update { "id": "ENNN", "status": "Done" }`
   - All PRD epics done? → `artefact_update { "id": "PRD-NNN", "status": "Done" }`
4. Report: task status, tasks unblocked, epic status, PRD status

> ℹ️ Version bump is triggered by SKILL (if task has `target_versions`), not by this command.
