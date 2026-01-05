# Worktree Mode and Folder Profiles

When running multiple agents in parallel, **worktree mode** provides git-level isolation. Each agent works in its own git worktree with a dedicated branch, preventing conflicts.

## Why Worktree Mode?

Without worktree mode, all agents work in the same directory. This causes:
- File conflicts when agents edit the same files
- Uncommitted changes from one agent affecting another
- Race conditions in git operations

With worktree mode:
- Each task gets its own directory (worktree) with a dedicated branch (`task/T001`)
- Agents can work in parallel without conflicts
- Changes are merged back after completion

## Folder Profiles

Worktree mode requires data to be stored **outside** the project directory to keep worktrees git-clean. Three profiles are available:

### Profile: `project` (default)

```
your-project/
├── .sailing/
│   ├── artefacts/     # PRDs, epics, tasks
│   ├── memory/        # Memory files
│   └── state.json     # ID counters
└── (source code)
```

- Everything in `.sailing/` inside the project
- **Not compatible with worktree mode** (worktrees would inherit `.sailing/` state)

### Profile: `haven`

```
~/.sailing/havens/<hash>/     # Haven directory
├── artefacts/                # PRDs, epics, tasks
├── memory/                   # Memory files
├── state.json                # ID counters
├── worktrees/                # Git worktrees
│   ├── T001/                 # Worktree for task T001
│   └── T002/                 # Worktree for task T002
└── agents/                   # Agent working directories

your-project/
├── .sailing/
│   ├── paths.yaml            # Points to haven
│   └── haven → ~/.sailing/havens/<hash>  # Symlink for IDE
└── (source code)
```

- Data stored in `~/.sailing/havens/<project-hash>/`
- Project stays git-clean (only `paths.yaml` + symlink)
- **Recommended for worktree mode**

### Profile: `sibling`

```
your-project/                 # Main project
└── (source code)

your-project-sailing/         # Sibling directory
├── worktrees/
│   ├── T001/
│   └── T002/
└── agents/
```

- Worktrees stored in adjacent `<project>-sailing/` directory
- Useful when home directory has limited space
- Artefacts still in project `.sailing/`

## Placeholders

The `paths.yaml` file uses placeholders that are resolved at runtime:

| Placeholder | Resolves To | Example |
|-------------|-------------|---------|
| `${haven}` | `~/.sailing/havens/<hash>` | `~/.sailing/havens/0ad68c5ba37b` |
| `${sibling}` | `../<project>-sailing` | `../myapp-sailing` |
| `${project_hash}` | First 12 chars of SHA256 | `0ad68c5ba37b` |
| `~/` | User home directory | `/home/user` |
| `^/` | Sailing repo (devinstall only) | `/path/to/sailing` |

### Example paths.yaml (haven profile)

```yaml
paths:
  # Data in haven
  artefacts: ${haven}/artefacts
  memory: ${haven}/memory
  state: ${haven}/state.json
  components: ${haven}/components.yaml

  # Worktrees in haven
  worktrees: ${haven}/worktrees
  agents: ${haven}/agents

  # Templates/prompting in project (shared)
  templates: .sailing/templates
  prompting: .sailing/prompting
```

## Installation

### New project with worktree mode

```bash
curl -sSL https://raw.githubusercontent.com/quazardous/sailing/main/install.sh | bash -s -- --use-worktree
```

This automatically:
- Sets `--folders-profile=haven` (required for worktree mode)
- Creates haven directory structure
- Configures `use_worktrees: true` in config
- Creates `.sailing/haven` symlink for IDE convenience

### Migrate existing project to worktree mode

```bash
# Re-run installer with worktree flag
curl -sSL .../install.sh | bash -s -- --use-worktree --force
```

The `--force` flag updates protected files. Your artefacts will be migrated to the haven directory.

### Choose sibling profile

```bash
curl -sSL .../install.sh | bash -s -- --use-worktree --folders-profile=sibling
```

## How Worktrees Work

### Agent spawn flow

1. `rudder agent:spawn T001` creates worktree:
   ```
   git worktree add ~/.sailing/havens/<hash>/worktrees/T001 -b task/T001
   ```

2. Agent works in the worktree directory, isolated from main

3. Agent commits changes to `task/T001` branch

4. On completion, merge skill integrates changes back to main

### Branch naming

| Entity | Branch Pattern | Example |
|--------|----------------|---------|
| Task | `task/<id>` | `task/T001` |
| Epic | `epic/<id>` | `epic/E001` |
| PRD | `prd/<id>` | `prd/PRD-001` |
| Merge | `merge/<src>-to-<dst>` | `merge/T001-to-E001` |

### Worktree commands

```bash
# List worktrees
rudder worktree:list

# Check worktree status
rudder worktree:status T001

# Clean up orphaned worktrees
rudder worktree:prune

# Remove a specific worktree
rudder worktree:remove T001
```

## Configuration

### Enable worktree mode (existing installation)

```bash
rudder config set use_worktrees true
```

### Branching strategy

Control how task branches relate to parent branches:

```bash
# Flat: all tasks branch from main (default)
rudder config set git.branching flat

# Epic: tasks branch from epic branch
rudder config set git.branching epic

# PRD: tasks branch from PRD branch
rudder config set git.branching prd
```

### Sync before spawn

Automatically sync parent branches before spawning agents:

```bash
rudder config set git.sync_before_spawn true
```

## Haven Symlink

For IDE convenience, the installer creates:

```
.sailing/haven → ~/.sailing/havens/<hash>
```

This lets you browse artefacts in your IDE without navigating to the haven path. The symlink is added to `.gitignore` automatically.

## Troubleshooting

### "Branch task/T001 already exists"

An orphaned branch from a previous run exists. Options:

```bash
# Delete and retry
git branch -D task/T001
rudder agent:spawn T001

# Or investigate existing work
git log task/T001
```

### Worktree path already exists

```bash
# Clean up stale worktree
git worktree remove ~/.sailing/havens/.../worktrees/T001 --force
git worktree prune
```

### Haven path not found

```bash
# Check haven path
rudder paths haven

# Reinitialize paths
rudder paths:init --profile=haven
```

## See Also

- [Sandbox Setup](sandbox.md) - Agent sandboxing with srt
- [MCP Server](mcp.md) - MCP architecture for sandboxed agents
- [Advanced Config](advanced.md) - Custom paths and options
