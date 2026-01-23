---
description: Get next available task
allowed-tools: mcp
---

# Next Task

**Purpose:** Identify the next task to work on based on availability or impact.

---

## Method

### Ready tasks (impact-sorted)

```json
// MCP: workflow_ready
{ "scope": "E001", "limit": 5 }
```

Returns **all ready tasks** (unblocked, not started) sorted by:
- **Impact**: number of downstream tasks unblocked (cascade potential)
- **Critical path**: position in dependency chain (longest chains prioritized)

**Use cases:**
- `workflow_ready { "limit": 1 }` → single best task
- `workflow_ready { "scope": "E001" }` → ready tasks in epic (for parallel spawn)
- `workflow_ready {}` → full list for strategic planning

### Bottlenecks (blocking the most work)

```json
// MCP: deps_critical
{ "scope": "PRD-001", "limit": 5 }
```

Returns incomplete tasks that block the most downstream work — graph-derived, not judgment.

---

## Output

Returns structured data to main thread only:

| Field | Description |
|-------|-------------|
| Task ID | Unique identifier (TNNN) |
| Title | Task title |
| Blocked by | Current blockers, if any |
| Impact | Numeric score (if using deps:ready) |

**Main thread decides the next action.**
This command does not execute tasks.

---

## Non-Goals

This command does **NOT**:
- Start or execute tasks
- Modify task status
- Suggest commands or workflow steps

---

## Escalation / Notes

- Output is informational only
- Main thread (skill) determines sequencing, parallelization, or execution
- Ensure this command is atomic: returns info, no side effects
