---
description: Decompose epic into task files
argument-hint: <PRD-NNN/ENNN>
allowed-tools: Read, Write, Edit, Task, Bash
---

# Epic Breakdown

Decompose epic into tasks. Coordination only, no implementation.

## Pre-flight

```bash
rudder context:load epic-breakdown --role coordinator
rudder epic:show ENNN                 # Verify epic exists
rudder memory:show ENNN --full        # Previous learnings + escalations
rudder story:list PRD-NNN             # Check if stories exist
```

If Technical Notes empty → escalate.

## Workflow

1. Read epic → extract Technical Notes, Acceptance Criteria
2. Propose task structure (titles + 1-line descriptions)
3. Present questions to main thread
4. After approval: create tasks via rudder

### Create Tasks

```bash
rudder task:create PRD-NNN/ENNN "title"
```

Then fill content via `task:patch` (see Artefact Editing Rules).

### Dependencies

```bash
rudder deps:add TNNN --blocked-by T001
rudder deps:validate --fix
```

### Story Linkage

```bash
rudder story:orphans PRD-NNN           # Check orphans
rudder task:update TNNN --add-story S001  # Link if needed
```

## Output

- Created tasks (IDs)
- Dependency graph
- Orphan story count
- Questions

## Constraints

- Tasks = WHAT/WHY, not HOW
- No implementation code
- Sizing: ~1-2 dev days per task, 5-10 tasks per epic

## Non-Goals

- Start implementation
- Make tech decisions not in epic
- Create epics
