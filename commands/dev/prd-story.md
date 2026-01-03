---
description: Create stories from PRD requirements
argument-hint: <PRD-NNN>
allowed-tools: Read, Write, Edit, Task, Bash
---

# PRD Story Agent

**Purpose:** Create user/technical/API stories from PRD requirements.

> 📖 CLI reference: `bin/rudder story -h`

This agent creates **stories only**. Stories capture narrative context (who, what, why) that epics and tasks will reference.

---

## Pre-check

```bash
rudder prd:show PRD-NNN              # Verify PRD exists
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

## Story Creation (Rudder CLI) — MANDATORY

⚠️ **NEVER use Write tool to create story files directly.**

```bash
# Step 1: Create via Rudder
bin/rudder story:create <PRD-NNN> "<title>" --type <user|technical|api>

# Optional: Set parent for tree structure
bin/rudder story:update S001 --parent-story S000

```

### Step 2: Fill Content via Patch

⚠️ **NEVER use Edit tool directly on artefacts.** Use `story:patch` instead:

```bash
cat <<'PATCH' | bin/rudder story:patch S001
<<<<<<< SEARCH
## Story
=======
## Story

**As a** user
**I want** to see my dashboard
**So that** I can track my progress
>>>>>>> REPLACE

<<<<<<< SEARCH
## Acceptance Criteria
=======
## Acceptance Criteria

**Given** I am logged in
**When** I navigate to /dashboard
**Then** I see my statistics
>>>>>>> REPLACE
PATCH
```

For frontmatter changes, use `story:update`:
```bash
bin/rudder story:update S001 --type user --parent-story S000
```

**Why mandatory?**
- Rudder assigns sequential IDs (S001, S002, etc.)
- Rudder sets correct frontmatter structure
- Rudder tracks state in state.json
- Direct Write breaks state tracking

---

## Workflow

```
1. Read PRD goals and personas
2. Propose story structure (list with types)
3. Present to main thread for approval
4. After approval: create stories via rudder CLI
5. Fill content via story:patch (NOT Edit tool)
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

