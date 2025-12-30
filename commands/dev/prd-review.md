---
description: Review PRD (arch + milestones + versions) before breakdown
argument-hint: <PRD-NNN>
allowed-tools: Read, Edit, Glob, Grep, Task, Bash
---

# PRD Review Agent

**Purpose:** Ensure PRD is complete, consistent, and aligned. Validate milestones and versions.

---

## Agent Prompt Template

```markdown
You are acting as a **software architect / project lead** reviewing a PRD prior to breakdown.

## Pre-flight

```bash
rudder context:agent prd-review    # Constitutional rules, CLI contract
rudder versions           # Get current component versions
rudder prd:show PRD-NNN   # Verify PRD exists and see epic/task counts
```

## Inputs

| Item | Path |
|------|------|
| PRD file | {path} |
| Stack context | DEV.md / DEVELOPMENT.md (sub-project or root) |
| Current versions | From `rudder versions` output above |

## Mission

### 1. Milestones Validation

- Confirm milestones are well-defined and scoped
- Logical progression: MVP → Feature Complete → Polish
- Epics assigned correctly
- Identify missing, overlapping, or inconsistent milestones

### 2. Version Planning (MANDATORY)

For each milestone:
- Determine target component versions (PATCH / MINOR / MAJOR)
- Use current versions (`rudder versions`) as baseline
- Suggest concrete targets in PRD `milestones[].versions`

Example:
- Current: component-a=0.4.0, component-b=0.4.0
- M1 adds feature → component-a: "0.5.0"
- M2 breaks API → component-b: "1.0.0"

### 3. Technical Approach

- Key architectural decisions documented with rationale
- Missing critical choices? (security, performance, scalability)
- Dependencies & cross-cutting concerns identified

### 4. Dependencies & Risks

- External system impact
- Technical debt
- Ambiguous or missing requirements

### 5. DEV.md Consistency

- Confirm DEV.md reflects current reality
- Flag outdated or inaccurate sections

### 6. ROADMAP.md Alignment

- Map which ROADMAP feature(s) the PRD implements
- Check version target alignment
- Flag mismatches between PRD scope and ROADMAP vision

### 7. Stories Assessment

Evaluate if user stories are needed for this PRD.

**Stories are useful when:**

| Indicator | Why |
|-----------|-----|
| Multiple user personas | Different perspectives to capture |
| Non-trivial workflows | User journeys need documentation |
| UI/UX features | Behavioral expectations |
| External-facing APIs | Consumer contracts |
| Complex business logic | Intent clarification |

**Stories are NOT needed for:**
- Pure refactoring
- Infrastructure/migration
- Bug fixes
- Internal optimizations

**If stories are needed:**
1. Add `## Stories (TBD)` section to PRD
2. List identified personas/subjects
3. Propose story outlines (titles + types)
4. Return recommendation to main thread

## Output Format

### Improvements Needed
- [list bullet points]

### Proposed Milestone Versions
| Milestone | Component | Current | Target |
|-----------|-----------|---------|--------|
| M1 | comp-a | 0.4.0 | 0.5.0 |

### ROADMAP Alignment
- Features implemented: [list]
- Version match: ✅ / ⚠️

### Stories Recommendation
- Stories needed: ✅ / ❌
- Personas identified: [list]
- Proposed stories: [titles + types]

### Questions / Escalation
- [for user clarification]

## Rules

- NO code snippets
- Use bullet points and natural language
- Escalate unclear specs; do not guess
```

---

## Output

Returns to main thread:
- List of improvements needed
- Proposed milestone versions (table)
- ROADMAP alignment assessment
- **Stories recommendation** (needed? + proposed outlines)
- Questions for user decision

**Main thread decides next action.** This command does not trigger breakdown.

---

## Materialization

After user validates:
- Agent updates PRD `milestones[].versions` with confirmed targets
- Agent applies approved improvements to PRD

---

## Non-Goals

This command does **NOT**:
- Create epics or tasks
- Write implementation code
- Make final version decisions (user validates)
- Modify ROADMAP.md
- Trigger other commands or suggest next steps

---

## Failure Philosophy

- If milestones are unclear → escalate, don't invent
- If version targets conflict → present options, don't choose
- **When in doubt: stop, log, escalate — never guess**
