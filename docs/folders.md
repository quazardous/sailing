# Folder Structure

After installation, sailing creates two main directories in your project.

## Overview

```
your-project/
├── bin/
│   └── rudder                 # CLI wrapper
├── .claude/
│   ├── skills/sailing/        # Skill definition
│   └── commands/dev/          # Slash commands
└── .sailing/
    ├── paths.yaml             # Path configuration
    ├── state.json             # ID counters
    ├── components.yaml        # Version tracking
    ├── rudder/                # CLI source (install.sh only)
    ├── artefacts/             # ROADMAP, POSTIT, PRDs, Epics, Tasks
    ├── memory/                # Epic memory
    ├── prompting/             # Optimized prompt fragments
    └── templates/             # Entity templates
```

## `.claude/` - Claude Code Integration

### `skills/sailing/SKILL.md`

The skill definition file. Loaded automatically by Claude Code. Contains:
- Constitutional rules (governance invariants)
- Decision trees (what command to run when)
- Agent delegation rules
- Memory sync requirements

### `TOOLSET.md` (Optional, User-Created)

Project-specific dev environment documentation. Not shipped with sailing - you create this file to document your project's tooling:

```markdown
# Project Toolset

## Build System
- `make build` - Build the project
- `make test` - Run tests

## Environment
- Node.js 20+
- PostgreSQL 16

## Development
- `npm run dev` - Start dev server
```

Agents read this file (if it exists) before implementing tasks to understand available commands and tooling.

### `commands/dev/`

Slash commands available in Claude Code:

| Command | Purpose |
|---------|---------|
| `/dev:prd-create` | Create new PRD |
| `/dev:prd-review` | Review PRD for improvements |
| `/dev:prd-breakdown` | Decompose PRD into epics |
| `/dev:epic-review` | Review epic for tech choices |
| `/dev:epic-breakdown` | Decompose epic into tasks |
| `/dev:task-start` | Execute a task |
| `/dev:task-done` | Complete a task |
| `/dev:next` | Get next available task |
| `/dev:status` | Project overview |
| `/dev:milestone-validate` | Validate milestone criteria |
| ... | 22+ commands total |

## `.sailing/` - Sailing Data

### `paths.yaml`

Path configuration. Customize where files are stored:

```yaml
paths:
  artefacts: .sailing/artefacts
  memory: .sailing/memory
  templates: .sailing/templates
  # ...
```

### `state.json`

ID counters for entities. Auto-created and managed by Rudder:

```json
{
  "prd": 3,
  "epic": 12,
  "task": 47,
  "story": 8
}
```

### `components.yaml`

Version tracking for your project components:

```yaml
components:
  core:
    version: "0.2.0"
    file: package.json
    changelog: CHANGELOG.md
```

### `rudder/`

The Rudder CLI source code:

```
rudder/
├── cli/
│   ├── rudder.js          # Entry point
│   ├── commands/          # Command implementations
│   └── lib/               # Utilities
├── package.json
└── node_modules/
```

### `artefacts/`

Your project's PRDs, Epics, Tasks, Stories, and project-level documents:

```
artefacts/
├── ROADMAP.md              # Your project roadmap (protected)
├── POSTIT.md               # Your scratch notes (protected)
└── prds/
    └── PRD-001-feature-name/
        ├── prd.md              # PRD document
        ├── stories/
        │   ├── S001-user-story.md
        │   └── S002-api-story.md
        ├── epics/
        │   ├── E001-backend.md
        │   └── E002-frontend.md
        └── tasks/
            ├── T001-setup-db.md
            ├── T002-api-endpoints.md
            └── T003-ui-components.md
```

### `memory/`

Epic memory and task logs:

```
memory/
├── E001.md          # Consolidated epic memory
├── E001.log         # Raw epic log (pending consolidation)
├── T001.log         # Task log (merged into epic log)
└── T002.log
```

Memory flow:
1. Agents log during task execution → `TNNN.log`
2. `memory:sync` merges task logs → `ENNN.log`
3. Skill consolidates into → `ENNN.md`
4. Future agents read `ENNN.md` for context

### `prompting/`

Optimized prompt fragments for agents and skill (read-only, updated by installer):

| Directory | Content |
|-----------|---------|
| `agent/` | Agent execution rules (rules-core, cli, logging, deps, stop, completion, memory) |
| `skill/` | Skill orchestration (orchestration, reminders) |
| `shared/` | Shared fragments (milestone, versioning) |
| `workflows.yaml` | Role-based context configuration |

Access via CLI:
```bash
rudder context:load <operation>  # Auto-resolves role from operation
rudder context:load <op> --role agent  # Override role
rudder context:list              # All roles, sets, operations
```

### `templates/`

Entity templates used by Rudder when creating new files:

| Template | Used for |
|----------|----------|
| `prd.md` | New PRDs |
| `epic.md` | New Epics |
| `task.md` | New Tasks |
| `story.md` | New Stories |
| `memory.md` | New Epic memory files |
| `milestone-criteria.md` | Milestone validation |

## `bin/rudder`

Wrapper script that invokes the Rudder CLI:

```bash
#!/bin/bash
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
exec node "$SCRIPT_DIR/../.sailing/rudder/cli/rudder.js" "$@"
```

Usage: `bin/rudder <command>` from anywhere in the project.
