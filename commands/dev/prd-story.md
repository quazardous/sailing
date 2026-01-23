---
description: Create stories from PRD requirements
argument-hint: <PRD-NNN>
allowed-tools: Read, Write, Edit, Task, mcp
---

# PRD Story Agent

**Purpose:** Create user/technical/API stories from PRD requirements.

This agent creates **stories only**. Stories capture narrative context (who, what, why) that epics and tasks will reference.

---

## Pre-check

```json
// MCP: artefact_show - Verify PRD exists
{ "id": "PRD-NNN" }
```

## Prerequisites

Before running this command:

1. PRD file exists with defined goals
2. `prd-review` has identified that stories are needed
3. User personas or technical subjects are identified

---

## When to Create Stories

Stories are useful when:

| Indicator | Why Stories Help |
|-----------|-----------------|
| Multiple user personas | Different "As a..." perspectives |
| Non-trivial workflows | Capture user journeys |
| UI/UX features | Describe expected behaviors |
| External-facing APIs | Document consumer contracts |
| Complex business logic | Clarify intent vs implementation |

Stories are **not needed** for:
- Pure refactoring
- Infrastructure/migration tasks
- Bug fixes
- Internal optimizations

---

## Story Fitness Check

Before creating each story, ask:

| Question | If "No" |
|----------|---------|
| **Conversation** — Will this spark useful discussion between business intent and implementation? | Skip or merge |
| **Beneficiary** — Can you name a real user, role, or consumer? | Treat as task |
| **Standalone value** — Could someone benefit from this independently? | Merge with related story |
| **Problem focus** — Does it describe a need, not a solution? | Rewrite or skip |

> *« A User Story is a placeholder for a conversation, not a specification. »*

If multiple answers are "no", the story format is probably not appropriate.

---

## Story Types

| Type | Format | Example Subject |
|------|--------|-----------------|
| `user` | As/I want/So that | The admin, The operator, The bot |
| `technical` | Subject/Must/Benefit | The X page, The Y service |
| `api` | Endpoint/Consumer/Contract | POST /api/..., Consumer: dashboard |

### Sweet Spot for Context

Name the **WHAT** (page, role, feature), not the **HOW** (file, class, route).

| ❌ Too Vague | ❌ Too Technical | ✅ Sweet Spot |
|--------------|------------------|---------------|
| "The system must..." | "BotList.vue must..." | "The bot list page must..." |
| "We want to..." | "GET /api/bots must..." | "The admin must be able to..." |

---

## Story Creation (MCP Tools) — MANDATORY

⚠️ **NEVER use Write tool to create story files directly.**

```json
// Step 1: Create via MCP
// MCP: artefact_create
{ "type": "story", "parent": "PRD-NNN", "title": "Story title" }

// Optional: Set parent for tree structure
// MCP: artefact_update
{ "id": "S001", "parent_story": "S000" }
```

### Step 2: Fill Content via Edit

⚠️ **NEVER use Edit tool directly on artefacts.** Use `artefact_edit` instead:

```json
// MCP: artefact_edit
{
  "id": "S001",
  "section": "Story",
  "content": "**As a** user\n**I want** to see my dashboard\n**So that** I can track my progress"
}

// MCP: artefact_edit
{
  "id": "S001",
  "section": "Acceptance Criteria",
  "content": "**Given** I am logged in\n**When** I navigate to /dashboard\n**Then** I see my statistics"
}
```

For frontmatter changes, use `artefact_update`:
```json
// MCP: artefact_update
{ "id": "S001", "type": "user", "parent_story": "S000" }
```

**Why mandatory?**
- MCP assigns sequential IDs (S001, S002, etc.)
- MCP sets correct frontmatter structure
- MCP tracks state in state.json
- Direct Write breaks state tracking

---

## Workflow

```
1. Read PRD goals and personas
2. Propose story structure (list with types)
3. Present to main thread for approval
4. After approval: create stories via MCP tools
5. Fill content via artefact_edit (NOT Edit tool)
6. Return output to main thread
```

---

## Output to Main Thread

- Created stories (list with IDs and types)
- Story tree structure (if hierarchical)
- Recommended epic/story mappings
- Questions that arose during creation

**Main thread decides next action.** This agent does not create epics or start implementation.

---

## Constraints

- No implementation details
- Focus on WHAT and WHY, not HOW
- Use Given/When/Then for acceptance criteria
- Keep stories atomic (one behavior per story)

---

## Non-Goals

This agent does **NOT**:
- Create epics or tasks
- Link stories to epics/tasks (done in prd-breakdown/epic-breakdown)
- Make architectural decisions
- Start implementation
