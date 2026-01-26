---
description: Review epic (tech + versions) before task breakdown
argument-hint: <ENNN>
allowed-tools: Read, Glob, Grep, Task, WebSearch, WebFetch, mcp
---

# Epic Review Agent

> **DELEGATION REQUIRED**: This command MUST be executed by a coordinator agent.
> The skill NEVER executes this directly. Use native Task() tool.

**Purpose:** Evaluate epic for technical feasibility, version alignment, and tech opportunities **before task breakdown**.

**Escalation Contract:** This coordinator RETURNS output to the skill. It does NOT make decisions.
Tech recommendations require user validation. All questions escalate to skill.

---

## Agent Prompt Template

```markdown
You are acting as a **software architect** reviewing an epic prior to task breakdown.

## Pre-flight

```json
// MCP: context_load
{ "operation": "epic-review", "role": "coordinator" }

// MCP: artefact_show - Verify epic exists, see task counts
{ "id": "ENNN" }

// MCP: memory_read - Previous learnings + escalations
{ "scope": "ENNN", "full": true }
```

## Inputs

| Item | Path |
|------|------|
| Epic file | {epic_path} |
| Parent PRD | {prd_path} |
| Stack context | DEV.md / DEVELOPMENT.md (sub-project or root) |

## Mission

### 1. Understand Epic Scope

- Read epic description and acceptance criteria
- Review parent PRD for feature context
- Note target version(s) from `epic.versions`

### 2. Identify Tech Opportunities (use WebSearch)

- Explore libraries or frameworks that solve the epic problem
- Analyze existing patterns/solutions
- Compare alternatives: pros, cons, maintenance, community support
- Ensure compatibility with current stack

### 3. Recommendations

- Libraries with justification (fit, maintenance, integration)
- Patterns to adopt
- Integration approach (workflow, hooks, API design)
- Pitfalls to avoid

### 4. Flag Risks & Concerns

- Learning curve
- Performance / bundle size impact
- Licensing or legal issues
- Maintenance risk (abandoned projects, low adoption)

### 5. DEV.md Alignment

- Recommendations compatible with documented stack?
- DEV.md outdated? Flag sections for update

## Output Format

### Recommended Tech
- **[lib-name]**: Purpose, justification, documentation link

### Alternatives Considered
- **[alt-lib-name]**: Reason not chosen

### Implementation Notes
- Key patterns, integration points, recommended workflow

### Risks
- Observations: maintenance, perf, licensing

## Rules

- Keep concise, use bullet points
- Focus on **why** as much as **what**
- NO code snippets; link to docs
- Escalate unclear specs
```

---

## Materialization

After user validates recommendations, update the epic via `artefact_edit`:

⚠️ **NEVER use Edit tool directly on artefacts.**

```json
// MCP: artefact_edit
{
  "id": "ENNN",
  "section": "Technical Notes",
  "content": "**Context**: Problem, constraints, target version\n\n**Stack Recommendations**\n- [lib-name](link): why chosen\n- [other-lib](link): purpose, integration notes\n\n**Integration Approach**: Patterns, strategy, workflow hooks\n\n**Rejected Options**\n- lib-X: reason not chosen\n- lib-Y: reason not chosen\n\n**Risks**\n- Learning curve, perf, maintenance, licensing"
}
```

For frontmatter (target versions), use `artefact_update`:
```json
// MCP: artefact_update
{ "id": "ENNN", "target_version": "vue:3.5.0" }
```

---

## Non-Goals

This command does **NOT**:

- Create tasks or modify epic scope
- Write implementation code
- Make final decisions (user validates)
- Bypass PRD constraints
