---
description: Add task to epic (manual)
argument-hint: <PRD-NNN/ENNN> <title>
allowed-tools: mcp
---

```json
// MCP: artefact_create
{ "type": "task", "parent": "E001", "title": "Task title" }
```

## After creation

Add dependencies if needed:
```json
// Task is blocked by other tasks
// MCP: deps_add
{ "task_id": "TNNN", "blocked_by": "T001" }

// Verify no cycles
// MCP: workflow_validate
{}
```

Use only for adding tasks after initial breakdown.
