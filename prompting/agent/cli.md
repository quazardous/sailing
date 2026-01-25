MCP tools are the ONLY interface for sailing artifacts. **NEVER use Edit tool on `.sailing/` files.**

## Read

| Data | MCP Tool |
|------|----------|
| Task | `artefact_show { "id": "TNNN" }` |
| Epic | `artefact_show { "id": "ENNN" }` |
| PRD | `artefact_show { "id": "PRD-NNN" }` |
| Dependencies | `deps_show { "id": "TNNN" }` |
| Memory | `memory_read { "scope": "TNNN" }` |

Add `raw: true` to see full markdown content: `artefact_show { "id": "ENNN", "raw": true }`

> **Memory context** is included in `context_load`. Use `memory_read` only to refresh mid-task.

## Write Metadata (frontmatter)

| Action | MCP Tool |
|--------|----------|
| Update status | `artefact_update { "id": "TNNN", "status": "Done" }` |
| Add blocker | `artefact_update { "id": "TNNN", "add_blocker": "TXXX" }` |
| Log progress | `task_log { "task_id": "TNNN", "message": "msg", "level": "info" }` |
| Log insight | `task_log { "task_id": "TNNN", "message": "msg", "level": "tip" }` |

## Write Content (body)

| Action | MCP Tool |
|--------|----------|
| Edit section | `artefact_edit { "id": "TNNN", "section": "Notes", "content": "new content" }` |
| Check deliverable | `artefact_check { "id": "TNNN", "item": "item text" }` |

## Allowed Edit Tool Usage

Edit tool ONLY for **source code** (project files, not sailing artifacts).
