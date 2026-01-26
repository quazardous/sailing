---
description: Review PRD (arch + milestones + versions) before breakdown
argument-hint: <PRD-NNN>
allowed-tools: Read, Edit, Glob, Grep, Task, mcp
---

# PRD Review Agent

> **DELEGATION REQUIRED**: This command MUST be executed by a coordinator agent.
> The skill NEVER executes this directly. Use native Task() tool.

**Purpose:** Ensure PRD is complete, consistent, and aligned. Validate milestones and versions.

**Escalation Contract:** This coordinator RETURNS output to the skill. It does NOT make decisions.
All questions, ambiguities, and approval requests are returned as structured escalations.

---

## Agent Prompt Template

```markdown
You are acting as a **software architect / project lead** reviewing a PRD prior to breakdown.

## Pre-flight

```json
// MCP: context_load
{ "operation": "prd-review", "role": "coordinator" }

// MCP: system_versions - Get current component versions
{}

// MCP: artefact_show - Verify PRD exists and see epic/task counts
{ "id": "PRD-NNN" }
```

## Inputs

| Item | Path |
|------|------|
| PRD file | {path} |
| Stack context | DEV.md / DEVELOPMENT.md (sub-project or root) |
| Current versions | From `system_versions` output above |

## Mission

### 1. Milestones Validation

- Confirm milestones are well-defined and scoped
- Logical progression: MVP → Feature Complete → Polish
- Epics assigned correctly
- Identify missing, overlapping, or inconsistent milestones

### 2. Version Planning (MANDATORY)

For each milestone:
- Determine target component versions (PATCH / MINOR / MAJOR)
- Use current versions (`system_versions`) as baseline
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

### 7. ADR (Architecture Decision Records) Check

```json
// MCP: adr_list - Get existing ADRs
{ "status": "Accepted" }
```

**Verify existing ADRs:**
- Does the PRD respect accepted architectural decisions?
- List relevant ADRs by domain/tags
- Flag any conflicts between PRD approach and existing ADRs

**Identify new ADRs needed:**
- Does the PRD introduce significant architectural decisions?
- New framework/library choices?
- New patterns or conventions?
- Breaking changes to existing architecture?

If new ADRs are needed, propose them:
```
📝 Suggested ADR: "Use WebSocket for real-time updates"
Context: PRD mentions real-time updates requirement
Proposed decision: Use native WebSocket (not Socket.io)
```

### 8. Branching Strategy (MANDATORY)

Evaluate and recommend `branching` level for git workflow:

| Critère | flat | prd | epic |
|---------|------|-----|------|
| Epics count | 1-2 | 3-5 | 6+ |
| Breaking changes | No | Yes | Major |
| Review scope | Task-level | Feature-level | Sub-feature |
| Rollback risk | Low | Medium | High |
| Team size | Solo | 2-3 | 4+ |
| Estimated tasks | <10 | 10-30 | 30+ |

**Branching levels:**
- `flat`: task branches from main directly (`task/T001` → `main`)
- `prd`: PRD feature branch (`task/T001` → `prd/PRD-001` → `main`)
- `epic`: Epic sub-branches (`task/T001` → `epic/E001` → `prd/PRD-001` → `main`)

**Default: `flat`** (simplicity first)

**Upgrade to `prd` if:**
- 3+ epics
- Breaking changes requiring isolation
- Need feature-level review before merge to main
- Medium/high rollback risk

**Upgrade to `epic` if:**
- 6+ epics with complex dependencies
- Large team with parallel epic work
- Need sub-feature review gates

### 9. Stories Assessment

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

### ADR Assessment
- Relevant existing ADRs: [list with IDs]
- Conflicts with ADRs: ✅ None / ⚠️ [list conflicts]
- New ADRs proposed: [list titles + brief context]

### Branching Recommendation
- Recommended: `flat` | `prd` | `epic`
- Rationale: [why this level]

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
- **Branching recommendation** (flat/prd/epic + rationale)
- **Stories recommendation** (needed? + proposed outlines)
- Questions for user decision

**Main thread decides next action.** This command does not trigger breakdown.

---

## Materialization

After user validates:
- Agent updates PRD `branching` field with confirmed strategy
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
