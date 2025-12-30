# Milestone Validation

> Agent reference for milestone validation workflow.

## Overview

A **milestone** groups epics into a coherent deliverable with acceptance criteria. Validation ensures all criteria pass before marking complete.

## Where Milestones Are Defined

1. **PRD body** (`prds/PRD-NNN/prd.md`) - Section `## Milestones` with ID, deliverables, validation commands
2. **Epic frontmatter** (`milestone: M1`) - Links epic to its milestone

## Validation Artifacts

```
prds/PRD-NNN-name/milestones/
├── m1-milestone-name/
│   ├── CRITERIA.md       # Acceptance criteria (required)
│   ├── validate.sh       # Validation script (optional)
│   └── fixtures/         # Test data (optional)
└── m2-another-milestone/
    └── CRITERIA.md
```

**Naming**: `m{N}-{kebab-name}` (e.g., `m1-foundation`, `m3-api-complete`)

## CRITERIA.md Format

```markdown
# M1: Milestone Name

## Status

**Current**: Pending | Validated | Partial
**Last validated**: YYYY-MM-DD

## Acceptance Criteria

- [ ] Criterion 1 description
- [ ] Criterion 2 description
- [x] Criterion 3 (passed)

## Validation Method

Option A - Script: `./validate.sh`
Option B - Manual steps (list commands)
Option C - Browser (Claude in Chrome)

## Results Log

### YYYY-MM-DD - Result
- X/Y criteria passed
- Notes: ...
```

## Handling Failures

When validation fails, agent must **escalate** (not silently continue):

1. Update CRITERIA.md with failure details
2. Output escalation report:

```markdown
## Milestone Validation Failed: M1

**PRD**: PRD-NNN
**Result**: X/Y criteria passed

### Failed Criteria

#### 1. {criterion}
- **Expected**: ...
- **Actual**: ...
- **Related task**: TNNN
- **Proposed action**: Reopen TNNN / Create bugfix

### Awaiting Decision

Confirm corrective actions or provide alternative direction.
```

3. Leave task In Progress - await direction
4. Do NOT attempt autonomous fixes

