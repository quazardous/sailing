# s/AI/ling - Project Governance

> Agent-driven development through structured PRDs, Epics, and Tasks.

## Key Documents

| File | Role |
|------|------|
| **`ROADMAP.md`** | Vision, architecture, phases. **Backlog** section for unplanned ideas. |
| **`VERSIONING.md`** | Versioning rules and workflow |
| **`components.yaml`** | Component version tracking config (used by rudder CLI) |
| **`MILESTONE.md`** | Milestone validation workflow and artifacts |
| **`SAILING.md`** | This file (workflow documentation) |
| **`templates/`** | PRD, Epic, Task templates |
| **`POSTIT.md`** | **Triage zone** — User scratch pad. Sort items: promote to Backlog, create task, or discard. |

## Overview

This folder contains all project planning artifacts designed for **autonomous agent development**. Each feature is specified through a PRD (Product Requirements Document) that breaks down into Epics and Tasks.

## Structure

```
.sailing/
├── artefacts/
│   ├── ROADMAP.md      # Vision, architecture, phases
│   ├── POSTIT.md       # Scratch notes, triage zone
│   └── prds/           # PRD folders
├── core/               # Reference docs (SAILING, VERSIONING, etc.)
├── memory/             # Epic memory and logs
└── templates/          # PRD, Epic, Task, Story templates

prds/
    └── PRD-NNN-name/   # One folder per PRD
        ├── prd.md      # Main PRD document
        ├── docs/       # Supporting documentation, diagrams
        ├── stories/    # User/technical stories (narrative context)
        │   ├── S001-story-name.md
        │   └── S002-story-name.md
        ├── epics/      # Epic specifications
        │   ├── E001-epic-name.md
        │   └── E002-epic-name.md
        └── tasks/      # Granular implementation tasks
            ├── T001-task-name.md
            └── T002-task-name.md
```

## Numbering Convention

| Type | Format | Example |
|------|--------|---------|
| PRD | `PRD-NNN` | PRD-001, PRD-042 |
| Story | `SNNN` | S001, S015 |
| Epic | `ENNN` | E001, E012 |
| Task | `TNNN` | T001, T123 |

Full reference: `PRD-001/E002/T003` (PRD 1, Epic 2, Task 3)

## Document Templates

Templates are in `.sailing/templates/`:

| Template | File | Usage |
|----------|------|-------|
| PRD | `templates/prd.md` | Product Requirements Document |
| Story | `templates/story.md` | User/technical/API story (narrative context) |
| Epic | `templates/epic.md` | Feature breakdown |
| Task | `templates/task.md` | Implementation unit |
| Milestone | `templates/milestone-criteria.md` | Validation criteria for milestones |

Copy template → rename → fill in details.

## Stories

Stories provide narrative context for features. They capture **who**, **what**, and **why**.

### Types

| Type | Format | Subject |
|------|--------|---------|
| `user` | As/I want/So that | User personas (admin, operator, bot) |
| `technical` | Subject/Must/Benefit | Pages, services, components |
| `api` | Endpoint/Consumer/Contract | API endpoints |

### Rules

- Stories are **passive** (no status tracking)
- Tasks reference stories (not reverse)
- Every story MUST be referenced by at least one task
- Not every task needs stories
- Use `rudder story:validate` to check for orphan stories

## Agent Commands

Agents use `/dev:*` commands to manage artifacts:

| Command | Description |
|---------|-------------|
| `/dev:prd-create` | Create new PRD with folder structure |
| `/dev:prd-list` | List all PRDs with status |
| `/dev:epic-create PRD-NNN` | Add epic to PRD |
| `/dev:task-create PRD-NNN/ENNN` | Add task to epic |
| `/dev:task-start PRD-NNN/ENNN/TNNN` | Claim and start task |
| `/dev:task-done PRD-NNN/ENNN/TNNN` | Mark task complete |
| `/dev:status` | Overall project status |
| `/dev:next` | Get next available task |
| `/dev:versions` | Show all component versions |
| `/dev:version-bump` | Bump component version |

## Workflow

```
1. Human/Lead creates PRD (high-level requirements)
           ↓
2. Agent breaks PRD into Epics (/dev:epic-create)
           ↓
3. Agent breaks Epics into Tasks (/dev:task-create)
           ↓
4. Agent claims task (/dev:task-start)
           ↓
5. Agent implements (following .claude/CLAUDE.md rules)
           ↓
6. Agent marks done (/dev:task-done)
           ↓
7. Repeat until Epic complete
           ↓
8. Repeat until PRD complete
```

## Rules

1. **One task at a time** - Agent completes current task before starting another
2. **Update status** - Always update task status when starting/completing
3. **Log progress** - Add log entries for significant progress
4. **Follow CLAUDE.md** - Strict adherence to coding rules
5. **No scope creep** - Task deliverables are fixed, create new task if needed
6. **Test before done** - Task is only done when tests pass
