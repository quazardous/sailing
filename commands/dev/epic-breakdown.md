---
description: Decompose epic into task files
argument-hint: <PRD-NNN/ENNN>
allowed-tools: Read, Write, Edit, Task, mcp
---

# Epic Breakdown

Decompose epic into tasks. Coordination only, no implementation.

## Pre-flight

```json
// MCP: context_load
{ "operation": "epic-breakdown", "role": "coordinator" }

// MCP: artefact_show - Verify epic exists
{ "id": "ENNN" }

// MCP: memory_read - Previous learnings + escalations
{ "scope": "ENNN", "full": true }

// MCP: artefact_list - Check if stories exist
{ "type": "story", "scope": "PRD-NNN" }
```

If Technical Notes empty → escalate.

## Workflow

1. Read epic → extract Technical Notes, Acceptance Criteria
2. Propose task structure (titles + 1-line descriptions)
3. Present questions to main thread
4. After approval: create tasks via MCP

### Create Tasks

```json
// MCP: artefact_create
{ "type": "task", "parent": "ENNN", "title": "title" }
```

Then fill content via `artefact_edit` (see Artefact Editing Rules).

### Dependencies

```json
// MCP: deps_add
{ "task_id": "TNNN", "blocked_by": "T001" }

// MCP: workflow_validate
{}
```

### Story Linkage

```json
// MCP: story_orphans - Check orphans
{ "scope": "PRD-NNN" }

// MCP: artefact_update - Link if needed
{ "id": "TNNN", "add_story": "S001" }
```

## Output

- Created tasks (IDs)
- Dependency graph
- Orphan story count
- Questions

## Constraints

- Tasks = WHAT/WHY, not HOW
- No implementation code

### Sizing (AI-calibrated)

| Effort | Description |
|--------|-------------|
| **1h** | Standard task (baseline) |
| **2h** | Complex task |
| **4h** | Large task (consider splitting) |
| **8h+** | Must split |

Target: **1-2h per task**, 5-10 tasks per epic. Set `effort` field in frontmatter.

## Non-Goals

- Start implementation
- Make tech decisions not in epic
- Create epics
