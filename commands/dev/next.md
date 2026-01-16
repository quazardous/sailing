---
description: Get next available task
allowed-tools: Bash
---

# Next Task

**Purpose:** Identify the next task to work on based on availability or impact.

> 📖 CLI reference: `bin/rudder -h`

---

## Method

### Ready tasks (impact-sorted)

```bash
bin/rudder deps:ready [--epic ENNN] [--prd PRD-NNN] [--tag <tag>] [--limit 5] [--json]
```

Returns **all ready tasks** (unblocked, not started) sorted by:
- **Impact**: number of downstream tasks unblocked (cascade potential)
- **Critical path**: position in dependency chain (longest chains prioritized)

**Use cases:**
- `deps:ready --limit 1` → single best task
- `deps:ready --epic E001` → ready tasks in epic (for parallel spawn)
- `deps:ready` → full list for strategic planning

### Bottlenecks (blocking the most work)

```bash
bin/rudder deps:critical [--prd PRD-NNN] [--limit 5]
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
