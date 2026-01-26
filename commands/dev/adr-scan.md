---
description: Scan codebase and propose Architecture Decision Records
argument-hint: [path/pattern] [--domain <domain>]
allowed-tools: Read, Glob, Grep, Task, mcp
---

# ADR Scan Agent

**Purpose:** Analyze the codebase to identify implicit architectural decisions and propose ADRs to document them.

> Two-pass workflow: analysis → proposal

---

## Pre-flight

```json
// MCP: context_load
{ "operation": "adr-scan", "role": "coordinator" }
```

---

## Usage Examples

```
/dev:adr-scan
/dev:adr-scan src/
/dev:adr-scan --domain api
/dev:adr-scan cli/ --domain core
```

---

## What This Command Does

1. **Scans** the codebase for architectural patterns
2. **Identifies** implicit decisions (conventions, dependencies, structure)
3. **Proposes** ADRs to document these decisions
4. **Creates** ADRs after user validation

---

## Pass 1: Analysis

**Target:** `{path_or_pattern}` or entire project

1. **Read context**
   - CLAUDE.md, CONTRACTS.md, DEV.md (if exists)
   - Note documented architecture, conventions

2. **Scan codebase**
   - Project structure (folder organization)
   - Import patterns (what imports what)
   - Dependencies (package.json, go.mod, etc.)
   - Recurring patterns (naming, error handling)
   - Configuration approaches

3. **Identify decisions**
   Look for implicit architectural choices:
   - Layer structure (MVC, Clean Architecture, etc.)
   - Framework/library choices
   - State management approach
   - API design patterns
   - Testing strategy
   - Build/deploy pipeline

**Output:** Findings Report
- List of detected architectural decisions
- For each: what, where observed, confidence level
- **No ADR creation yet**

→ User confirms which items should become ADRs

---

## Pass 2: ADR Proposal

**Input:** Confirmed items from Pass 1

For each confirmed item:

1. **Draft ADR content**
   - Title: Clear, concise decision name
   - Context: Why this decision exists (inferred from code)
   - Decision: What was chosen
   - Consequences: Observable impacts (positive/negative)
   - Alternatives: What else could have been chosen

2. **Propose to user**
   Show draft ADR for each item:
   ```
   📝 Proposed ADR: "Layer Architecture (Commands → Managers → Libs)"

   Context: Code shows clear separation with imports flowing one direction...
   Decision: Three-tier architecture with strict import rules...

   Create this ADR? [Y/n/edit]
   ```

3. **Create validated ADRs**
   Use CLI command for each approved:
   ```bash
   rudder adr:create "Decision Title" --domain <domain> --tag <tags>
   ```

**Output:** Created ADRs list
- IDs and titles of created ADRs
- Reminder to edit and fill in details

---

## Detection Heuristics

| Pattern | Potential ADR |
|---------|---------------|
| Consistent folder structure | "Project Structure Convention" |
| Import direction (A→B, never B→A) | "Layer Dependencies" |
| Single library for X (e.g., axios for HTTP) | "HTTP Client Choice" |
| Custom error types | "Error Handling Strategy" |
| Specific config pattern | "Configuration Management" |
| Test file locations | "Testing Strategy" |
| CI/CD files | "Build & Deploy Pipeline" |

---

## Domain Suggestions

When proposing ADRs, suggest appropriate domains:

| Code Area | Suggested Domain |
|-----------|------------------|
| `cli/`, `cmd/` | `core` |
| `api/`, `handlers/` | `api` |
| `ui/`, `frontend/`, `components/` | `frontend` |
| `lib/`, `pkg/`, `utils/` | `libs` |
| `infra/`, `deploy/` | `infrastructure` |
| `test/`, `spec/` | `testing` |

---

## Non-Goals

This command does **NOT**:

- Create ADRs without user validation
- Modify existing code
- Make assumptions about business rationale
- Skip user confirmation between passes
- Create duplicate ADRs (checks existing ones first)

---

## Integration

After ADRs are created:

1. **Mark as Proposed** (default status)
2. **User reviews** and edits content
3. **User accepts** via `rudder adr:accept ADR-XXX`
4. ADRs become part of agent context in future tasks
