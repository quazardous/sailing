---
description: Decompose epic into task files
argument-hint: <PRD-NNN/ENNN>
allowed-tools: Read, Write, Edit, Task, Bash
---

# Epic Breakdown Agent

**Purpose:** Decompose a single epic into tasks using Rudder CLI.

> 📖 CLI reference: `bin/rudder -h`

This command performs **coordination only**, never implementation or inference.

---

## Pre-flight

```bash
rudder context:agent epic-breakdown             # Constitutional rules, CLI contract
rudder epic:show ENNN              # Verify epic exists, see task counts
rudder epic:show-memory ENNN --full  # Previous learnings + escalations
rudder story:list PRD-NNN          # Check if stories exist for this PRD
```

## Prerequisites

Before running this command:

1. Epic file exists
2. Epic has `## Technical Notes` filled (recommended)

If Technical Notes are empty, escalate to main thread.

---

## Agent Brief Checklist

When spawning agents for task creation, ensure the prompt contains:

### REQUIRED

| # | Item | Why |
|---|------|-----|
| 1 | **Identity**: Epic ID, title, parent PRD | Agent knows scope |
| 2 | **Context paths**: Epic file, PRD file, DEV.md | Agent reads first, does not invent |
| 3 | **Technical Notes**: From epic (constraints, patterns, libraries) | Tasks inherit decisions |
| 4 | **Sizing**: Task ≈ 1–2 dev days, 5–10 tasks per epic | Prevents micro/macro splitting |
| 5 | **File creation mandate**: "Use `rudder task:create` then Edit — NEVER Write directly" | Ensures state tracking |

### IF APPLICABLE

| # | Item | When |
|---|------|------|
| 6 | **Scope guidance**: Explicit in/out-of-scope | If boundaries are ambiguous |
| 7 | **Dependency types**: Internal (same epic) vs External (other epic) | If complex dependency graph |
| 8 | **Tag propagation**: Epic tags to inherit | If epic has tags |

---

## Workflow

```
1. Read epic file → extract Technical Notes, Acceptance Criteria
2. Propose task structure (titles + 1-line descriptions)
3. Present questions to main thread
4. After approval: create tasks via rudder CLI
5. Set task dependencies via rudder deps:add (task-level only, epic deps set at prd-breakdown)
```

### Task Creation (Rudder CLI) — MANDATORY

```bash
# Step 1: Create via Rudder
bin/rudder task:create <PRD-NNN/ENNN> "<title>" [--target-version=<comp:ver>]

# Step 2: Read then Edit content
Read the created file, then use Edit tool to fill:
- Description (specific, actionable)
- Deliverables (checkboxes)
- Technical Details (workflow, not code)
```

**Why mandatory?**
- Rudder assigns sequential IDs (T161, T162, etc.)
- Rudder sets correct frontmatter structure
- Rudder tracks state in state.json
- Direct Write breaks state tracking

### Tag Propagation

When creating tasks, propagate parent epic's tags:
1. Read epic tags from frontmatter
2. Pass to `task:create` using `--tag` option
3. User can modify/override before confirmation

```bash
# Example with tag propagation:
# If epic has tags: [backend, api]
bin/rudder task:create PRD-001/E001 "Implement endpoint" --tag=backend --tag=api
```

### Story Linkage

If stories exist for this PRD, ensure each story is referenced by at least one task:

```bash
# Check for orphan stories
bin/rudder story:orphans PRD-NNN

# Link task to story it implements
bin/rudder task:update TNNN --add-story S001
```

**Important:** Not every task needs stories. But every story MUST be referenced by at least one task.

### Dependencies

```bash
# After all tasks created
bin/rudder deps:add TNNN --blocked-by T001,T002
bin/rudder deps:validate --fix
```

---

## Output to Main Thread

- Created tasks (list with IDs)
- Dependency graph for this epic
- **Story validation status** (orphan count from `story:orphans`)
- Questions that arose during breakdown

**Main thread decides next action.** This command does not trigger implementation.

---

## Constraints

- No implementation code (workflow description preferred)
- Natural language, bullet points
- Target audience: senior engineers
- Tasks describe WHAT and WHY, not HOW

### Writing Rules

| Content | Code? |
|---------|-------|
| Deliverables | Never |
| Technical Details | Exceptional (pseudo-code only) |
| Implementation Notes | Workflow steps, not code |

> **Code becomes obsolete. Describe the workflow, not the implementation.**

---

## Non-Goals

This command does **NOT**:
- Start task implementation
- Make tech decisions not in epic Technical Notes
- Suggest next commands
- Create epics

---

## Agent CLI Rules (MANDATORY)

Agents MUST use Rudder CLI for all state operations. Never bypass with direct file access.

### File Creation

| Action | Use | NEVER |
|--------|-----|-------|
| Create task | `rudder task:create PRD/ENNN "title"` | Write tool directly |
| Create epic | `rudder epic:create PRD "title"` | Write tool directly |
| Create story | `rudder story:create PRD "title"` | Write tool directly |

### Frontmatter Updates

| Action | Use | NEVER |
|--------|-----|-------|
| Update status | `rudder task:update TNNN --status wip` | Edit frontmatter directly |
| Add dependency | `rudder deps:add TNNN --blocked-by T001` | Edit blocked_by in file |
| Link story | `rudder task:update TNNN --add-story S001` | Edit stories in file |
| Set version | `rudder task:update TNNN --target-version qdadm:0.22.0` | Edit target_versions |

### Queries

| Action | Use | NEVER |
|--------|-----|-------|
| List tasks | `rudder task:list --epic ENNN` | Grep/Glob task files |
| Show task | `rudder task:show TNNN` | Read task file for metadata |
| Check deps | `rudder deps:show TNNN` | Parse blocked_by from file |
| Validate | `rudder deps:validate` | Manual dependency analysis |

### Body Content (Edit tool OK)

Use Edit tool ONLY for body content sections:
- `## Description` - fill after rudder creates file
- `## Deliverables` - add checkbox items
- `## Technical Details` - workflow guidance

**Why?** Rudder maintains state.json consistency. Direct file edits bypass state tracking.

---

## Failure Philosophy

- Epic scope unclear → escalate, don't invent
- Technical Notes missing → suggest `epic-review` first
- Overlapping task boundaries → flag, don't guess
- **When in doubt: stop, log, escalate — never guess**
