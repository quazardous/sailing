# Sailing - Project Governance Skill

A Claude Code skill for structured project governance using PRD/Epic/Task workflow.

## What is Sailing?

Sailing is a governance framework for AI-assisted development. It provides:

- **Structured workflow**: PRD → Epic → Task decomposition
- **Agent governance**: Rules for how Claude agents operate
- **Memory consolidation**: Persistent learning across sessions
- **Version tracking**: Component versioning with semver

### Workflow

```
PRD (Product Requirement)
 └── Epic (Feature scope)
      └── Task (Atomic work unit)
```

## Installation

```bash
curl -sSL https://raw.githubusercontent.com/quazardous/sailing/main/install.sh | bash
```

## Usage

Once installed, Claude Code automatically loads the sailing skill. Use natural language:

### Planning Phase

```
"With sailing, create a PRD for a user authentication system"
"Using the sailing skill, start a new PRD for an e-commerce platform"
"Review PRD-001 and suggest improvements"
"Break down PRD-001 into epics"
"Create user stories for PRD-002"
```

### Implementation Phase

```
"What's the next task to work on?"
"Show me the project status"
"Start working on task T005"
"I finished task T005, mark it as done"
"Task T007 is blocked, I need help from the backend team"
```

### Version & Milestone

```
"Show me all component versions"
"Bump the core version to minor with message 'Added auth feature'"
"Validate milestone M1"
"Sync the roadmap with completed work"
```

### Memory & Context

```
"Sync the memory before starting the next task"
"Show me the context for epic E003"
"What issues were encountered in epic E002?"
```

### Slash Commands

Or use slash commands directly:

```
/dev:prd-create "E-commerce Platform"
/dev:prd-review PRD-001
/dev:prd-breakdown PRD-001
/dev:epic-breakdown PRD-001/E001
/dev:task-start T005
/dev:task-done T005
/dev:next
/dev:status
/dev:versions
/dev:version-bump core minor "Added feature"
```

## Structure

```
your-project/
├── bin/rudder              # CLI (see docs/rudder.md)
├── .claude/
│   ├── skills/sailing/     # Skill definition
│   └── commands/dev/       # /dev:* commands
└── .sailing/
    ├── artefacts/          # ROADMAP, POSTIT, PRDs, Epics, Tasks
    ├── memory/             # Epic memory
    ├── core/               # Reference documentation
    └── templates/          # Entity templates
```

## Documentation

- [Rudder CLI](docs/rudder.md) - The main CLI for state management
- [Folder Structure](docs/folders.md) - What each folder contains
- [Version Tracking](docs/version_tracking.md) - Component versioning with semver
- [Advanced Configuration](docs/advanced.md) - Custom paths, dev install, etc.
- `.sailing/core/SAILING.md` - Complete workflow documentation (after install)

## License

MIT
