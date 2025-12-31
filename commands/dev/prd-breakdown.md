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
rudder context:agent prd-breakdown    # Constitutional rules, CLI contract
rudder prd:show PRD-NNN   # Verify PRD exists and see current epics
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
| 5 | **Sizing**: Epic = 5–10 tasks (tasks created later) | Prevents micro/macro splitting |
| 6 | **File creation mandate**: "Use `rudder epic:create` then Edit — NEVER Write directly" | Ensures proper state tracking |

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

# Step 2: Read then Edit content
Read the created file, then use Edit tool to fill:
- Description (2-3 sentences)
- Acceptance Criteria (checkboxes)
- Technical Notes (leave empty if epic-review will fill)
- Risks
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
When approved: agents call `rudder epic:create` then Edit
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

---

## Agent CLI Rules (MANDATORY)

Agents MUST use Rudder CLI for all state operations. Never bypass with direct file access.

### File Creation

| Action | Use | NEVER |
|--------|-----|-------|
| Create epic | `rudder epic:create PRD-NNN "title"` | Write tool directly |
| Create story | `rudder story:create PRD-NNN "title"` | Write tool directly |

### Frontmatter Updates

| Action | Use | NEVER |
|--------|-----|-------|
| Update status | `rudder epic:update ENNN --status wip` | Edit frontmatter directly |
| Add to milestone | `rudder prd:milestone PRD-NNN M1 --add-epic ENNN` | Edit PRD frontmatter |
| Set version | `rudder epic:update ENNN --target-version qdadm:0.22.0` | Edit target_versions |

### Dependencies

| Action | Use | NEVER |
|--------|-----|-------|
| Add epic blocker | `rudder deps:add ENNN --blocked-by E001` | Edit blocked_by in file |
| Validate | `rudder deps:validate` | Manual dependency analysis |

### Body Content (Edit tool OK)

Use Edit tool ONLY for body content sections:
- `## Description` - fill after rudder creates file
- `## Acceptance Criteria` - add checkbox items
- `## Technical Notes` - architecture guidance
- `## Risks` - identified risks

**Why?** Rudder maintains state.json consistency. Direct file edits bypass state tracking.

---

## Failure Philosophy

- PRD scope unclear → escalate, don't invent
- Overlapping epic boundaries → flag, don't guess
- **When in doubt: stop, log, escalate — never guess**
