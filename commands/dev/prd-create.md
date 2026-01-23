---
description: Create new PRD (Draft)
argument-hint: <title>
allowed-tools: mcp
---

# PRD Create

**Purpose:** Create a new PRD structure in Draft status.

---

## Usage

```json
// MCP: artefact_create
{ "type": "prd", "title": "PRD title" }
```

---

## Creates

- PRD directory with numbered ID (`PRD-NNN-kebab-title/`)
- `prd.md` file from template
- Status set to Draft

---

## Output

Returns to main thread:
- Created PRD ID and path
- Initial status: Draft

**Main thread decides next action.** This command only creates the PRD structure.

---

## Non-Goals

This command does **NOT**:
- Create epics or tasks
- Populate PRD content
- Trigger review or breakdown
