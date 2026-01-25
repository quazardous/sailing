## Execute

Implement deliverables exactly. No scope expansion.

## Logging Contract

⚠️ **MANDATORY: You MUST log at least ONE notable thing before completing.**

A task without logs = REJECTED (even if code works).

What counts as notable:
- A gotcha or pitfall you discovered
- A non-obvious decision you made (and why)
- Something that surprised you
- A pattern worth remembering
- A dependency quirk or version issue

```json
// MCP: task_log
{ "task_id": "TNNN", "message": "Found that X requires Y because Z", "level": "tip" }
{ "task_id": "TNNN", "message": "Chose approach A over B: faster + simpler", "level": "info" }
```

❌ NOT notable: "completed task", "implemented feature", "done"
✅ Notable: insight someone else would benefit from

## Complete

Just exit normally when done. Auto-release happens on exit 0.

**Rejection triggers**: incomplete deliverables, <2 logs, missing TIP, artifact edited with Edit tool (use MCP tools).
