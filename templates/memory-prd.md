---
prd: PRD-000
created: ''
updated: ''
---

# Memory: PRD-000

## Cross-Epic Patterns

<!--
Integration points, shared resources, and dependencies between epics.
This is the MOST valuable section — the only place that shows the big picture.

Examples:
- The claim endpoint is the integration point between E0099, E0100, E0102 — changes here impact all 3
- Config resolution is tested in 3 files (one per epic) — watch for shared fixture conflicts
- E0097 provides the base task schema that E0099 and E0101 extend
-->

## Decisions

<!--
PRD-level architectural decisions. Document rationale.

Examples:
- Chose PostgreSQL over MongoDB for relational integrity
- WebSocket for real-time updates (not polling)
- File-based locking instead of DB advisory locks — simpler failure modes
-->

## Escalation

<!--
Issues requiring PRD-level attention.
Patterns affecting multiple epics.

Examples:
- [E001,E003] Shared component causing conflicts
- Performance degradation when epics interact
-->
