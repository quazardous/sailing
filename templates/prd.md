---
id: PRD-NNN
title: Title
status: Draft
branching: flat  # flat | prd | epic (set by prd-review)
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
# Edit frontmatter: bin/rudder prd:update <id> --set key=value
---

<!-- Edit ALL sections in ONE command: bin/rudder prd:edit <id> <<'EOF'
## Summary
...
## Goals
- [ ] ...
EOF
-->
<!-- Ops: [append], [sed], [check], [patch]... See: bin/rudder prd edit --help -->

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
