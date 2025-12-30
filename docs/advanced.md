# Advanced Configuration

## Custom Paths

Edit `.sailing/paths.yaml` to customize where sailing stores files:

```yaml
paths:
  artefacts: .sailing/artefacts
  memory: .sailing/memory
  templates: .sailing/templates
  core: .sailing/core
  rudder: .sailing/rudder
  skill: .claude/skills/sailing
  commands: .claude/commands/dev
```

The installer respects existing `paths.yaml` - it reads custom paths before installation.

## Protected Files

These files are never overwritten during updates:

| File | Purpose |
|------|---------|
| `.sailing/state.json` | ID counters (PRD, Epic, Task, Story) |
| `.sailing/components.yaml` | Component version tracking |
| `.sailing/artefacts/ROADMAP.md` | Your project roadmap |
| `.sailing/artefacts/POSTIT.md` | Your scratch notes |

## Install Options

```bash
# Standard install
curl -sSL https://raw.githubusercontent.com/quazardous/sailing/main/install.sh | bash

# With global CLI
curl -sSL .../install.sh | bash -s -- --global

# Force overwrite protected files
curl -sSL .../install.sh | bash -s -- --force

# Dry run (preview changes)
curl -sSL .../install.sh | bash -s -- --dry-run
```

## Dev Install (Local Repo)

Install from a local sailing repo instead of GitHub:

```bash
cd /path/to/target-project
/path/to/sailing/devinstall.sh [options]
```

### Modes

| Mode | Command | Description |
|------|---------|-------------|
| `--symlink` | (default) | Symlinks to repo, changes reflected immediately |
| `--copy` | | Copy files, standalone installation |

### Symlink Mode (default)

```bash
/path/to/sailing/devinstall.sh
/path/to/sailing/devinstall.sh --symlink
```

Creates symlinks:
- `.claude/skills/sailing` → repo/skill/
- `.claude/commands/dev` → repo/commands/dev/
- `.sailing/templates` → repo/templates/
- Core docs → repo/core/ (except ROADMAP.md, POSTIT.md)

CLI runs directly from source repo. Changes are immediately reflected.

### Copy Mode

```bash
/path/to/sailing/devinstall.sh --copy
```

Copies all files like `install.sh`:
- CLI copied to `.sailing/rudder/`
- Skill, commands, templates copied
- Standalone installation, no dependency on source repo

### Options

| Option | Description |
|--------|-------------|
| `--symlink` | Symlink mode (default) |
| `--copy` | Copy mode |
| `--force` | Force overwrite protected files |
| `--help` | Show help |

## Dev Mode (from repo)

When testing Rudder from the sailing repo directory:

```bash
# Using environment variable
SAILING_PROJECT=/path/to/project ./bin/rudder task:list

# Using --root flag
./bin/rudder --root /path/to/project prd:list

# Export for session
export SAILING_PROJECT=/path/to/project
./bin/rudder status
```

## Component Versioning

Define tracked components in `.sailing/components.yaml`:

```yaml
components:
  core:
    version: "0.1.0"
    file: package.json
    extractor: json
    path: version
    changelog: CHANGELOG.md
  api:
    version: "0.1.0"
    file: api/version.txt
    extractor: text
```

Bump versions:
```bash
bin/rudder version:bump core minor "Added new feature"
```

## Entity Status Flow

| Entity | Status Flow |
|--------|-------------|
| PRD | Draft → In Review → Approved → In Progress → Done |
| Epic | Not Started → In Progress → Done |
| Task | Not Started → In Progress → Blocked → Done → Cancelled |

Stories have no status (narrative only).
