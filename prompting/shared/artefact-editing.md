# Artefact Editing Rules

⚠️ **NEVER use Edit/Write tools directly on sailing artefacts.**

## MCP Tools

| Entity | Frontmatter | Body Content |
|--------|-------------|--------------|
| PRD | `artefact_update { "id": "PRD-NNN", "status": "..." }` | `artefact_edit { "id": "PRD-NNN", "section": "...", "content": "..." }` |
| Epic | `artefact_update { "id": "ENNN", "status": "...", "add_story": "...", "target_version": "..." }` | `artefact_edit { "id": "ENNN", "section": "...", "content": "..." }` |
| Task | `artefact_update { "id": "TNNN", "status": "...", "add_blocker": "...", "assignee": "..." }` | `artefact_edit { "id": "TNNN", "section": "...", "content": "..." }` |
| Story | `artefact_update { "id": "SNNN", "type": "...", "parent_story": "..." }` | `artefact_edit { "id": "SNNN", "section": "...", "content": "..." }` |

## Why MCP Tools?

- File paths abstracted (not exposed)
- State tracking maintained
- Proper error handling
