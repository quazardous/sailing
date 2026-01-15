---
description: Create new PRD (Draft)
argument-hint: <title>
allowed-tools: Bash
---

# PRD Create

**Purpose:** Create a new PRD structure in Draft status.

> 📖 CLI reference: `bin/rudder -h`

---

## Usage

```bash
bin/rudder prd:create <title>
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
