# Batch MCP Operations

## Artefact List

Search entities with filters.

```json
// MCP: artefact_list
{ "type": "prd" }                              // All PRDs
{ "type": "epic", "scope": "PRD-001" }         // Epics in PRD
{ "type": "task", "scope": "E001" }            // Tasks in epic
{ "type": "task", "status": "Done" }           // Filter by status
{ "type": "task", "scope": "E001", "status": "In Progress" }
{ "type": "story" }                            // All stories
```

Entities: `prd`, `epic`, `task`, `story`

### Filters

| Filter | Applies to | Example |
|--------|------------|---------|
| `status` | all | `"status": "Done"` |
| `scope` | epic, task, story | `"scope": "PRD-001"` or `"scope": "E001"` |

## Dependency Commands

**ALWAYS use `deps_*` tools - NEVER grep/search for dependency info.**

```json
// MCP: deps_show
{ "id": "TNNN" }                  // Task blockers/blocked-by

// MCP: workflow_ready
{}                                // Ready tasks (sorted by impact)
{ "scope": "E001" }               // Ready in specific epic
{ "limit": 5 }                    // Limit results

// MCP: deps_critical
{}                                // Bottleneck tasks blocking the most work
{ "scope": "PRD-001" }            // Critical path in specific PRD
{ "limit": 5 }                    // Limit results

// MCP: deps_validate
{}                                // Validate graph (find cycles, missing refs)
{ "fix": true }                   // Auto-fix issues
```

## Common Patterns

```json
// Ready tasks (sorted by impact - best to work on first)
// MCP: workflow_ready
{}
{ "scope": "E001" }
{ "limit": 5 }

// Count tasks by status
// MCP: artefact_list
{ "type": "task", "status": "Done" }
{ "type": "task", "status": "In Progress" }

// Find orphan epics (no stories)
// MCP: story_orphans
{ "scope": "PRD-001" }

// Update task status
// MCP: artefact_update
{ "id": "TNNN", "status": "In Progress" }
```
