---
description: Decompose PRD into epic files
argument-hint: <PRD-NNN>
allowed-tools: Read, Write, Edit, Task, Bash
---

# PRD Breakdown Agent

**Purpose:** Decompose a PRD into epics using Rudder CLI. Parallelize agents where possible.

This command creates **epics only**. Use `/dev:epic-breakdown` to create tasks after epic review.

> 📖 CLI reference: `bin/rudder -h`

---

## Pre-flight

```bash
rudder context:load prd-breakdown --role coordinator
rudder prd:show PRD-NNN               # Verify PRD exists and see current epics
```

---

## Agent Brief Checklist

When spawning an agent for epic creation, ensure the prompt contains:

### REQUIRED

| # | Item | Why |
|---|------|-----|
| 1 | **Identity**: PRD ID, Epic name, Milestone, Target version | Agent knows exactly what it's working on |
| 2 | **Context paths**: PRD file, architecture docs | Agent reads first, does not invent |
| 3 | **Draft reference**: Existing bullet points from PRD to expand | Agent interprets, doesn't create from scratch |
| 4 | **Intent**: 1–2 phrases on what this achieves and why | Reduces scope creep |
| 5 | **Sizing**: Epic = 5–10 tasks, each task ~1-2h AI effort | Prevents micro/macro splitting |
| 6 | **File creation mandate**: "Use `rudder epic:create` then `:patch` — NEVER Edit/Write directly" | Ensures proper state tracking |

### IF APPLICABLE

| # | Item | When |
|---|------|------|
| 7 | **Scope guidance**: Explicit in/out-of-scope | If boundaries are ambiguous |
| 8 | **Epic dependencies**: Which epics block others | If complex dependency graph |
| 9 | **Tag propagation**: PRD tags to inherit | If PRD has tags |

---

## Output Expectations

Agent must provide:

- ❓ Questions or ambiguities found
- 📋 Proposed structure: titles + 1-line descriptions
- 🔗 Dependencies (`blocked_by`)
- 🛠️ CLI commands to run after approval

---

## Constraints

- No implementation code (pseudo-code only if algorithm is complex)
- Natural language, workflow-focused
- Target audience: senior engineers

### Writing Rules

| Level | Code? | Content |
|-------|-------|---------|
| Epic | ⚠️ Rare | Acceptance criteria, tech recommendations, pseudo-code only |
| Task | ⚠️ Exceptional | Workflow description preferred; explain steps/logic, not implementation |

> **Code becomes obsolete. Prefer natural language, bullet points, pseudo-code.**

---

## File Creation (Rudder CLI) — MANDATORY

⚠️ **NEVER use Write tool to create epic files directly.**

```bash
# Step 1: Create via Rudder (inherit PRD tags using --tag)
bin/rudder epic:create <PRD-NNN> "<title>" [--target-version=<comp:ver>] [--tag=<tag>]

# Example with tag propagation:
# If PRD has tags: [api, security]
bin/rudder epic:create PRD-001 "API Authentication" --tag=api --tag=security
```

### Step 2: Fill Content via Patch

⚠️ **NEVER use Edit tool directly on artefacts.** Use `epic:patch` instead:

```bash
cat <<'PATCH' | bin/rudder epic:patch E001
<<<<<<< SEARCH
## Description
=======
## Description

Epic description here (2-3 sentences explaining the scope).
>>>>>>> REPLACE

<<<<<<< SEARCH
## Acceptance Criteria
=======
## Acceptance Criteria

- [ ] First acceptance criterion
- [ ] Second acceptance criterion
>>>>>>> REPLACE
PATCH
```

For frontmatter changes, use `epic:update`:
```bash
bin/rudder epic:update E001 --add-story S001 --target-version game:0.2.0
```

### Tag Propagation

When creating epics, propagate parent PRD's tags:
1. Read PRD tags from frontmatter
2. Pass to `epic:create` using `--tag` option
3. User can modify/override before confirmation

**Why mandatory?**
- Rudder assigns sequential IDs (E040, E041, etc.)
- Rudder sets correct frontmatter structure
- Rudder tracks state in state.json
- Direct Write breaks state tracking

---

## Workflow

```
Spawn agents in parallel (one per epic draft in PRD.md):
  ┌─ Agent(Epic1) ─┐
  ├─ Agent(Epic2) ─┼─► Agents escalate questions
  └─ Agent(Epic3) ─┘
         ↓
Main thread: collect escalations → present to user → answers
         ↓
When approved: agents call `rudder epic:create` then `epic:patch`
```

> Single message = multiple Task tool calls = parallel execution.

### Escalation Pattern

Agents must escalate (not guess) when:
- Epic scope is unclear
- Boundaries overlap with other epics
- PRD intent is ambiguous
- Sizing seems wrong (too big/small)

Main thread merges all escalations, presents to user, distributes answers.

---

## Output to Main Thread

- Created epics (list with IDs)
- Epic dependency graph (if any)
- Escalated questions from agents

**Main thread decides next action.** This command does not create tasks or trigger implementation.

---

## Non-Goals

This command does **NOT**:
- Create tasks
- Fill Technical Notes
- Start implementation
- Make architectural decisions not in PRD

