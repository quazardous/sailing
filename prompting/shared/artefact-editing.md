# Artefact Editing Rules

⚠️ **NEVER use Edit/Write tools directly on sailing artefacts.**

## MCP Tools

| Entity | Frontmatter | Body Content |
|--------|-------------|--------------|
| PRD | `artefact_update { "id": "PRD-NNN", "status": "..." }` | `artefact_edit { "id": "PRD-NNN", "section": "...", "content": "..." }` |
| Epic | `artefact_update { "id": "ENNN", "status": "...", "add_story": "...", "target_version": "..." }` | `artefact_edit { "id": "ENNN", "section": "...", "content": "..." }` |
| Task | `artefact_update { "id": "TNNN", "status": "...", "add_blocker": "...", "assignee": "..." }` | `artefact_edit { "id": "TNNN", "section": "...", "content": "..." }` |
| Story | `artefact_update { "id": "SNNN", "type": "...", "parent_story": "..." }` | `artefact_edit { "id": "SNNN", "section": "...", "content": "..." }` |

## Patch Mode (surgical edits)

For small edits (fix a word, update a checkbox, add/remove a bullet), use **patch mode** with `old_string` + `new_string` instead of rewriting entire sections:

```json
{
  "id": "PRD-001",
  "old_string": "- [ ] Question obsolète",
  "new_string": "- [x] Question résolue",
  "section": "Open Questions"
}
```

- `section` is optional — omit it to search the full body
- `old_string` must be unique within scope (section or full body)
- Set `"regexp": true` to treat `old_string` as a regex pattern:

```json
{
  "id": "E001",
  "old_string": "v\\d+\\.\\d+",
  "new_string": "v2.0",
  "regexp": true
}
```

## Why MCP Tools?

- File paths abstracted (not exposed)
- State tracking maintained
- Proper error handling
