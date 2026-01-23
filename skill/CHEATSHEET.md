# MCP Tools Cheatsheet

MCP tools are available via the `mcp` allowed-tool.

## Read Artifacts

```json
// MCP: artefact_show
{ "id": "PRD-NNN" }      // PRD summary
{ "id": "ENNN" }         // Epic summary
{ "id": "TNNN" }         // Task details

// Full markdown content
{ "id": "PRD-NNN", "raw": true }
{ "id": "ENNN", "raw": true }
{ "id": "TNNN", "raw": true }
```

## Project Status

```json
// MCP: system_status
{}                              // Overview (PRDs, tasks by status)

// MCP: artefact_list
{ "type": "prd" }               // All PRDs
{ "type": "epic", "scope": "PRD-NNN" }  // Epics in PRD
{ "type": "task", "scope": "ENNN" }     // Tasks in epic
```

## Dependencies

```json
// MCP: workflow_ready
{}                              // Ready tasks (unblocked)
{ "scope": "ENNN" }             // Ready in specific epic

// MCP: deps_show
{ "id": "TNNN" }                // Task blockers
{ "id": "ENNN" }                // Epic blockers

// MCP: deps_critical
{ "limit": 5 }                  // Bottleneck tasks
```

## Modify Artifacts

```json
// Status
// MCP: artefact_update
{ "id": "TNNN", "status": "Done" }
{ "id": "ENNN", "status": "In Progress" }

// Content
// MCP: artefact_edit
{ "id": "TNNN", "section": "Notes", "content": "New content" }

// MCP: workflow_complete
{ "task_id": "TNNN", "message": "Completion summary" }
```

## Agents

```json
// MCP: agent_spawn
{ "task_id": "TNNN" }           // Start agent (blocking)
{ "task_id": "TNNN", "worktree": true }  // Isolated branch

// MCP: agent_status
{}                              // List agents
{ "task_id": "TNNN" }           // Specific agent

// MCP: agent_log
{ "task_id": "TNNN" }           // View log
{ "task_id": "TNNN", "tail": true }  // Follow log

// MCP: agent_reap
{ "task_id": "TNNN" }           // Merge completed work

// MCP: agent_reject
{ "task_id": "TNNN" }           // Discard work
```

## Memory

```json
// MCP: memory_sync
{}                              // Process pending logs

// MCP: memory_read
{ "scope": "ENNN" }             // Epic memory
{ "scope": "TNNN", "full": true }  // Full context for task
```

## Create Artifacts

```json
// MCP: artefact_create
{ "type": "prd", "title": "Title" }
{ "type": "epic", "parent": "PRD-NNN", "title": "Title" }
{ "type": "task", "parent": "ENNN", "title": "Title" }
```

## Logging

```json
// MCP: task_log
{ "task_id": "TNNN", "message": "Progress update", "level": "info" }
{ "task_id": "TNNN", "message": "Useful insight", "level": "tip" }
{ "task_id": "TNNN", "message": "Problem found", "level": "error" }
```

## Role Reference

| Operation | Role | MCP Tool |
|-----------|------|----------|
| Read artifacts | any | `artefact_show` |
| Project status | any | `system_status` |
| Ready tasks | any | `workflow_ready` |
| Spawn agent | skill | `agent_spawn` |
| Epic breakdown | coordinator | `/dev:epic-breakdown` |
| PRD breakdown | coordinator | `/dev:prd-breakdown` |
| Task execution | agent | (via agent_spawn) |

## Tips

- Use `raw: true` for full markdown content
- Use `full: true` for complete memory context
