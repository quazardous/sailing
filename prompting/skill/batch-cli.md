# Batch CLI Operations

## Find Command

Search entities with filters, optionally execute commands on results.

```bash
rudder find <entity> [filters] [--exec "command {}"]
```

Entities: `prd`, `epic`, `task`, `story`

### Filters

| Filter | Applies to | Example |
|--------|------------|---------|
| `--status <s>` | all | `--status Done` |
| `--prd <id>` | epic, task, story | `--prd PRD-001` |
| `--epic <id>` | task | `--epic E001` |
| `--tag <t>` | all | `--tag api` |
| `--assignee <n>` | task | `--assignee agent` |
| `--blocked` | task | Only blocked tasks |
| `--unblocked` | task | Only unblocked tasks |
| `--has-story` | epic, task | Has linked stories |
| `--no-story` | epic, task | No linked stories |
| `--type <t>` | story | `--type user` |

### Output Modes

| Option | Output |
|--------|--------|
| (default) | Human-readable list |
| `--ids` | One ID per line (pipeable) |
| `--count` | Just the count |
| `--json` | JSON array |

### Execute on Results

```bash
# Dry run first
rudder find task --epic E001 --status Done --exec "task:show {}" --dry-run

# Execute
rudder find task --blocked --exec "task:update {} --status Blocked"

# Batch update assignees
rudder find task --status "In Progress" --exec "task:update {} --assignee agent"
```

Options: `--dry-run`, `--quiet`, `--verbose`

## Common Patterns

```bash
# Ready tasks (sorted by impact - best to work on first)
rudder deps:ready
rudder deps:ready --epic E001
rudder deps:ready --limit 5

# Count tasks by status
rudder find task --status Done --count
rudder find task --status "In Progress" --count

# Find orphan epics (no stories)
rudder find epic --prd PRD-001 --no-story

# Mass status update
rudder find task --epic E001 --status "Not Started" --exec "task:update {} --status 'In Progress'"

# List IDs for scripting
for id in $(rudder find task --epic E001 --ids); do
  rudder task:show $id
done
```
