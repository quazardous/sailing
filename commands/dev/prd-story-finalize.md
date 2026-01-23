---
description: Finalize story-task linkage (phase finale before implementation)
argument-hint: <PRD-NNN>
allowed-tools: Read, Write, Edit, Task, mcp
---

# PRD Story Finalize Agent

**Purpose:** Link orphan stories to tasks, or create new tasks. Final phase before implementation when stories exist.

This agent ensures **zero orphan stories** before implementation starts.

---

## Pre-check

```json
// MCP: story_validate - Check for orphan stories
{ "scope": "PRD-NNN" }

// MCP: story_orphans - List orphan stories
{ "scope": "PRD-NNN" }
```

## Prerequisites

Before running this command:

1. Stories exist (`artefact_list { "type": "story", "scope": "PRD-NNN" }`)
2. Epic breakdown is complete (tasks exist)
3. `story_validate` reports orphan stories

---

## Triggering Condition

This agent is triggered by the **skill** when:
1. `epic-breakdown` completes
2. Skill runs `story_validate`
3. Orphan stories are detected

---

## Workflow

```
1. List orphan stories: story_orphans { "scope": "PRD-NNN" }
2. For each orphan:
   a. Find semantically matching tasks
   b. If match exists → link story to task
   c. If no match → create new task (incremental breakdown)
3. Re-validate: story_validate { "scope": "PRD-NNN" }
4. Repeat until zero orphans
5. Return output to skill
```

---

## Linking Stories to Tasks

```json
// Add story reference to existing task
// MCP: artefact_update
{ "id": "TNNN", "add_story": "S001" }

// Verify link
// MCP: artefact_show - Should show "Referenced by Tasks: TNNN"
{ "id": "S001" }
```

---

## Creating New Tasks (Incremental Breakdown)

When no matching task exists, create one:

```json
// Step 1: Create task via MCP
// MCP: artefact_create
{ "type": "task", "parent": "ENNN", "title": "Task title based on story" }

// Step 2: Link story
// MCP: artefact_update
{ "id": "TNNN", "add_story": "S001" }

// Step 3: Fill task content via artefact_edit (NOT Edit tool)
// MCP: artefact_edit
{ "id": "TNNN", "section": "Description", "content": "Task description based on story requirements." }
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
- Validation result: `story_validate` must pass
- Remaining issues (if any)

**Main thread decides next action.** Agent returns output only.

---

## Validation Loop

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
