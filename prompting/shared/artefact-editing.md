# Artefact Editing Rules

⚠️ **NEVER use Edit/Write tools directly on sailing artefacts.**

## CLI Commands

| Entity | Frontmatter | Body Content |
|--------|-------------|--------------|
| PRD | `prd:update --status`, `--title` | `prd:patch` |
| Epic | `epic:update --status`, `--add-story`, `--target-version` | `epic:patch` |
| Task | `task:update --status`, `--add-blocker`, `--assignee` | `task:patch` |
| Story | `story:update --type`, `--parent-story` | `story:patch` |

## Patch Syntax

```bash
cat <<'PATCH' | rudder <entity>:patch <ID>
<<<<<<< SEARCH
## Section Header
=======
## Section Header

New content here.
>>>>>>> REPLACE
PATCH
```

Multiple patches in one call:
```bash
cat <<'PATCH' | rudder epic:patch E001
<<<<<<< SEARCH
## Description
=======
## Description

First section content.
>>>>>>> REPLACE

<<<<<<< SEARCH
## Acceptance Criteria
=======
## Acceptance Criteria

- [ ] Criterion one
- [ ] Criterion two
>>>>>>> REPLACE
PATCH
```

## Why CLI?

- File paths abstracted (not exposed)
- Works via MCP tool
- State tracking maintained
- Proper error handling
