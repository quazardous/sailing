---
description: Review epic (tech + versions) before task breakdown
argument-hint: <ENNN>
allowed-tools: Read, Glob, Grep, Task, WebSearch, WebFetch
---

# Epic Review Agent

**Purpose:** Evaluate epic for technical feasibility, version alignment, and tech opportunities **before task breakdown**.

---

## Agent Prompt Template

```markdown
You are acting as a **software architect** reviewing an epic prior to task breakdown.

## Pre-flight

```bash
rudder core:show agent               # Constitutional rules, CLI contract
rudder epic:show ENNN                # Verify epic exists, see task counts
rudder epic:show-memory ENNN --full  # Previous learnings + escalations
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

After user validates recommendations, update the epic file:

**Edit `## Technical Notes` section:**

```markdown
## Technical Notes

**Context**: Problem, constraints, target version

**Stack Recommendations**
- [lib-name](link): why chosen
- [other-lib](link): purpose, integration notes

**Integration Approach**: Patterns, strategy, workflow hooks

**Rejected Options**
- lib-X: reason not chosen
- lib-Y: reason not chosen

**Risks**
- Learning curve, perf, maintenance, licensing
```

---

## Non-Goals

This command does **NOT**:

- Create tasks or modify epic scope
- Write implementation code
- Make final decisions (user validates)
- Bypass PRD constraints

---

## Failure Philosophy

- If epic scope is unclear → escalate, don't guess
- If no good tech option exists → say so explicitly
- **When in doubt: stop, log, escalate — never guess**
