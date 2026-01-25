---
id: PRD-NNN
title: Title
status: Draft
# branching: flat | prd | epic (only if agent.use_worktrees, set by prd-review)
tags: []
milestones:
  - id: M1
    name: MVP functional
    epics: [E001, E002]
    versions: { component-a: "1.0.0", component-b: "1.0.0" }  # Use keys from components.json
    status: pending
  - id: M2
    name: Feature complete
    epics: [E003]
    versions: { component-a: "1.1.0", component-b: "1.1.0" }
    status: pending
# MCP: artefact_update { "id": "<id>", "status": "...", "set": {...} }
---

<!--
MCP multi-section edit (preferred):
artefact_edit { "id": "<id>", "content": "## Summary\nYour summary...\n\n## Goals\n- [ ] Goal 1\n- [ ] Goal 2\n\n## Technical Approach\nHigh-level approach..." }

With mode: artefact_edit { "id": "<id>", "content": "## Open Questions [append]\n- [ ] New question", "mode": "append" }
-->

## Summary

One paragraph describing the feature/capability being built.

## Goals

- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

## Non-Goals

- What this PRD explicitly does NOT cover
- Features explicitly out of scope

## Success Metrics

- Measurable outcome 1
- Measurable outcome 2

## Technical Approach

High-level architecture and key technical decisions.

```
ASCII diagram if helpful (architecture, data flow - NO code)
```

### Key Decisions

1. **Decision 1**: Rationale
2. **Decision 2**: Rationale

> ⚠️ **NO CODE in PRDs** - describe concepts, not implementation. Use diagrams for architecture.

## Epics

<!--
Draft epics here during refinement. NO separate files yet.
Files created only after /dev:prd-breakdown.
-->

- E001: Epic title
  - T001: Task (optional, if clear)
  - T002: Task
- E002: Epic title
- E003: Epic title

## Open Questions

- [ ] Question that needs resolution
- [ ] Another question

## References

- Link to design doc
- Link to external resource
