---
epic: E0000
created: ''
updated: ''
---

# Memory: E0000

## Key Files

<!--
Critical file paths and their roles. One line per file.
Only files an agent NEEDS to know about — not obvious ones.

Examples:
- `src/db/migrations/003_add_claims.sql` → claim table schema
- `tests/fixtures/config.json` → shared test config (used by E0097, E0099)
- `src/api/middleware/auth.ts` → token validation, affects all endpoints
-->

## Gotchas

<!--
Traps discovered during implementation. Concrete problem + solution.
High-value, low-volume. One gotcha can save 20 minutes of debugging.

RULE: If it's in the epic definition, it doesn't belong here.
Only write what was DISCOVERED, not what was KNOWN.

Examples:
- INSERT IGNORE silently swallows CHECK constraint errors → use INSERT ... ON DUPLICATE KEY UPDATE instead
- `make test` requires DB_HOST=localhost (not 127.0.0.1) on Docker
- Date fields return UTC from API but local time from direct DB query
-->

## Decisions

<!--
Non-obvious choices made during implementation + rationale.
Skip the obvious. Document the surprising.

Examples:
- Used file locking instead of DB advisory locks → simpler, no connection pool issues
- Chose polling over WebSocket for heartbeat → fewer failure modes, 5s interval is fine
-->

## Cross-refs

<!--
Links to other epics. What this epic provides or consumes.
Critical for multi-epic coordination.

Examples:
- E0097 provides claim endpoint used here for heartbeat updates
- E0101 depends on the task_status enum added here
- Shares test fixtures with E0099 in tests/fixtures/
-->

## Escalation

<!--
Issues requiring attention. Keep [TNNN] for traceability.

Examples:
- [T042] Filter by status not working — needs investigation
- [T045] Performance degradation on large datasets
-->

## Changelog

<!--
Compiled history of accomplishments, NOT raw logs.
Summarize what was built, not how.

Examples:
- [T138] Form builder: auto-field generation, field types
- [T139] CRUD operations with localStorage persistence
-->
