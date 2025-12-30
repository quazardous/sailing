---
description: Finalize story-task linkage (phase finale before implementation)
argument-hint: <PRD-NNN>
allowed-tools: Read, Write, Edit, Task, Bash
---

# PRD Story Finalize Agent

**Purpose:** Link orphan stories to tasks, or create new tasks. Final phase before implementation when stories exist.

> 📖 CLI reference: `bin/rudder story -h`

This agent ensures **zero orphan stories** before implementation starts.

---

## Pre-check

```bash
rudder story:validate PRD-NNN        # Check for orphan stories
rudder story:orphans PRD-NNN         # List orphan stories
```

## Prerequisites

Before running this command:

1. Stories exist (`story:list PRD-NNN`)
2. Epic breakdown is complete (tasks exist)
3. `story:validate` reports orphan stories

---

## Triggering Condition

This agent is triggered by the **skill** when:
1. `epic-breakdown` completes
2. Skill runs `story:validate`
3. Orphan stories are detected

---

## Workflow

```
1. List orphan stories: rudder story:orphans PRD-NNN
2. For each orphan:
   a. Find semantically matching tasks
   b. If match exists → link story to task
   c. If no match → create new task (incremental breakdown)
3. Re-validate: rudder story:validate PRD-NNN
4. Repeat until zero orphans
5. Return output to skill
```

---

## Linking Stories to Tasks

```bash
# Add story reference to existing task
rudder task:update TNNN --add-story S001 --add-story S002

# Verify link
rudder story:show S001   # Should show "Referenced by Tasks: TNNN"
```

---

## Creating New Tasks (Incremental Breakdown)

When no matching task exists, create one:

```bash
# Step 1: Create task via Rudder
rudder task:create PRD-NNN/ENNN "Task title based on story"

# Step 2: Link story
rudder task:update TNNN --add-story S001

# Step 3: Fill task content via Edit
# Description, Deliverables, Technical Details
```

---

## Matching Heuristics

When linking orphan stories to tasks:

| Story Type | Match Criteria |
|------------|----------------|
| `user` | Task implements user-facing behavior |
| `technical` | Task modifies the technical subject |
| `api` | Task implements the endpoint |

**Semantic match** = story acceptance criteria aligns with task deliverables.

---

## Output to Skill

- Stories linked (list: S001 → T042)
- Tasks created (list with IDs)
- Validation result: `story:validate` must pass
- Remaining issues (if any)

**Main thread decides next action.** Agent returns output only.

---

## Validation Loop

```bash
# Loop until validation passes
while rudder story:validate PRD-NNN --json | jq -e '.issues | length > 0'; do
  # Fix orphans
  # ...
done
```

The agent must achieve **zero orphan stories** before returning.

---

## Constraints

- Every story must have ≥1 task reference
- Don't force-link unrelated stories
- If semantic match is unclear → escalate
- Don't modify story content (stories are passive)

---

## Non-Goals

This agent does **NOT**:
- Create new stories
- Modify story acceptance criteria
- Start implementation
- Make architectural decisions

---

## Failure Philosophy

- No matching task and unclear where to create → escalate
- Story seems out of scope → escalate
- **When in doubt: stop, log, escalate — never guess**
