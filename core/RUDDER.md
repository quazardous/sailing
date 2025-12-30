# Rudder CLI

State management tool for sailing workflow. Manipulates PRD/Epic/Task files and dependencies.

## Usage

```bash
bin/rudder <group>:<command> [options]
```

### Command Syntax

Commands use colon notation `group:command`. Both forms are equivalent:

```bash
rudder task:list PRD-001        # Colon notation (preferred)
rudder task list PRD-001        # Space notation (also works)
```

### Getting Help

```bash
rudder -h                    # All commands
rudder <group> -h            # Group commands with all options (recommended for exploration)
rudder <group>:<cmd> -h      # Specific command options
```

**Tip:** `rudder <group> -h` shows all subcommands with their arguments and options - very useful for discovering available flags.

## Quick Reference

```bash
# Project overview
rudder status                    # Tasks by status, PRDs list
rudder versions                  # Component versions

# Find work
rudder task:next                 # First ready task
rudder deps:ready -l 5           # Top 5 by impact

# Work on task
rudder task:start T042           # Set In Progress + assignee
rudder task:done T042 -m "msg"   # Set Done + log entry

# Dependencies
rudder deps:show T042            # Blockers and dependents
rudder deps:impact T042          # What gets unblocked
rudder deps:validate --fix       # Fix issues (cycles, refs)

# List/filter
rudder task:list --epic E035 --status wip
rudder epic:list PRD-001
rudder prd:list --status approved
```

## Command Groups

| Group | Purpose |
|-------|---------|
| `prd` | PRD operations (list, show, create, update, milestone) |
| `story` | Story operations (list, show, create, update, tree, validate) |
| `epic` | Epic operations (list, show, create, update) |
| `task` | Task operations (list, show, create, update, next, start, done, log) |
| `deps` | Dependency graph (tree, validate, impact, ready, critical, add, show) |

## PRD Commands

| Command | Description |
|---------|-------------|
| `prd:list` | List PRDs (filter: `--status`) |
| `prd:show PRD-001` | Details (epics, tasks by status) |
| `prd:create "Title"` | Create PRD directory + prd.md |
| `prd:update PRD-001 -s approved` | Update status/title |
| `prd:milestone PRD-001 M1` | Show milestone epics |
| `prd:milestone PRD-001 M1 --add-epic E035` | Link epic to milestone |
| `prd:milestone PRD-001 M1 --remove-epic E035` | Unlink epic from milestone |

## Task Commands

| Command | Description |
|---------|-------------|
| `task:list [PRD]` | List tasks (filter: `--epic`, `--status`, `--assignee`) |
| `task:show T042` | Details (blockers, dependents, ready status) |
| `task:create PRD-001/E035 "Title"` | Create under epic (`--story S001`) |
| `task:update T042 -s wip` | Update status/assignee/blockers/stories |
| `task:next` | Get next ready task (`--prd`, `--epic`) |
| `task:start T042` | Set In Progress + assignee, check blockers |
| `task:done T042 -m "msg"` | Set Done + add log entry |
| `task:log T042 "msg"` | Log during work (→ memory/TNNN.log) |
| `task:show-memory T042` | Show Agent Context from parent epic |

## Task Logging

Agents log during task work. Logs go to `.sailing/memory/TNNN.log`. See `.sailing/core/TASKLOG.md` for examples and best practices.

```bash
rudder task:log T042 "message" --level [-f file] [-c cmd] [-s snippet]
```

| Level | Purpose |
|-------|---------|
| `--info` | Progress notes (default) |
| `--tip` | Learnings, useful commands |
| `--warn` | Issues encountered |
| `--error` | Significant problems |
| `--critical` | Blocks completion |

| Metadata | Purpose |
|----------|---------|
| `-f, --file` | Related file (repeatable) |
| `-c, --cmd` | Related command |
| `-s, --snippet` | Code snippet |

## Epic Memory

Per-epic knowledge sharing in `.sailing/memory/ENNN.md`.

| Command | Description |
|---------|-------------|
| `epic:clean-logs E035` | Delete epic log |
| `epic:dump-logs E035` | Show epic log content |
| `epic:ensure-memory E035` | Create memory file if missing |
| `epic:merge-logs E035` | Merge + flush task logs → epic log |
| `epic:show-memory E035` | Agent Context only (default) |
| `epic:show-memory E035 --full` | Full memory (for review/breakdown) |

## Story Commands

Stories provide narrative context (who, what, why). They are passive (no status tracking).

| Command | Description |
|---------|-------------|
| `story:list [PRD]` | List stories (filter: `--type`) |
| `story:show S001` | Details (children, references) |
| `story:create PRD-001 "Title"` | Create story (`--type user\|technical\|api`) |
| `story:update S001` | Update type, parent-story |
| `story:tree [PRD]` | Show story tree structure |
| `story:roots [PRD]` | List root stories (no parent) |
| `story:leaves [PRD]` | List leaf stories (no children) |
| `story:children S001` | List direct children |
| `story:ancestors S005` | Show path to root |
| `story:orphans [PRD]` | List stories without task references |
| `story:validate [PRD]` | Check for orphan stories |
| `story:book [PRD]` | Dump all stories (storybook) |

### Story Types

| Type | Format |
|------|--------|
| `user` | As/I want/So that |
| `technical` | Subject/Must/Benefit |
| `api` | Endpoint/Consumer/Contract |

### Story Rules

- Stories are passive (no status)
- Every story MUST be referenced by at least one task
- Not every task needs stories
- Use `story:validate` to check for orphans

### Linking Stories

```bash
# Link story at creation
rudder epic:create PRD-001 "Title" --story S001
rudder task:create PRD-001/E035 "Title" --story S001 --story S002

# Link story to existing epic/task
rudder epic:update E035 --add-story S001
rudder task:update T042 --add-story S001

# Replace all stories
rudder task:update T042 --story S001 --story S002

# Remove story link
rudder task:update T042 --remove-story S001
```

## Deps Commands

| Command | Description |
|---------|-------------|
| `deps:ready -l 5` | Ready tasks sorted by impact |
| `deps:show T042` | Task blockers and dependents |
| `deps:impact T042` | What gets unblocked |
| `deps:validate --fix` | Check/fix cycles, refs, status |
| `deps:critical` | Find bottlenecks |
| `deps:add T042 --blocked-by T001` | Add dependency |
| `deps:tree T042` | Visualize ancestors/descendants |

## Standalone Commands

| Command | Purpose |
|---------|---------|
| `status` | Project overview (tasks by status, PRDs) |
| `versions` | Component versions (from components.yaml) |
| `feedback "msg"` | Log agent feedback (systemic issues) |
| `init` | Initialize from -dist templates |
| `state` | Show ID counters |
| `ensure` | Fix files with missing frontmatter |

## Key Features

- **ID normalization**: T1, T01, T001 are equivalent
- **Status aliases**: `wip` → In Progress, `todo` → Not Started, `done` → Done
- **Timestamps**: Status changes auto-track started_at, done_at, etc.
- **Validation**: `deps:validate --fix` auto-corrects common issues
- **Generic update**: `--set key=value` for any frontmatter field (supports dot notation)

```bash
# Set any field (task, epic, prd)
rudder task:update T042 --set "custom=value"
rudder task:update T042 --set "nested.key=value"    # dot notation
rudder task:update T042 --set "count=42"            # auto-parses numbers
rudder task:update T042 --set "flag=true"           # auto-parses booleans
rudder task:update T042 --set "field=null"          # remove field
```

## Files

- `.sailing/state.json` - ID counters (prd, epic, task, story)
- `.sailing/components.yaml` - Version tracking config
- `.sailing/artefacts/prds/PRD-NNN-*/` - PRD directories with stories/, epics/, tasks/
- `.sailing/memory/` - Task logs (TNNN.log) and epic memory (ENNN.md, ENNN.log)
