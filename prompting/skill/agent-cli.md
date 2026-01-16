# Agent CLI Commands

## Spawning

```bash
# Spawn single agent
rudder agent:spawn T001

# Spawn with timeout (default: 600s)
rudder agent:spawn T001 --timeout 1800

# Spawn with worktree (isolated git branch)
rudder agent:spawn T001 --worktree

# Dry-run (show what would happen)
rudder agent:spawn T001 --dry-run
```

## Monitoring

```bash
# List all agents
rudder agent:list

# Only active agents (dispatched/running)
rudder agent:list --active

# Check specific agent status
rudder agent:status T001

# Show full log
rudder agent:log T001

# Last N lines
rudder agent:log T001 -n 50

# Follow log in real-time (Ctrl+C to stop)
rudder agent:log T001 --tail

# Show filtered JSON events
rudder agent:log T001 --events
```

## Waiting

```bash
# Wait for single agent to complete
rudder agent:wait T001

# Wait for multiple agents
rudder agent:wait-all T001 T002 T003

# Wait for ALL active agents
rudder agent:wait-all

# Wait for FIRST to complete
rudder agent:wait-all --any

# With timeout (default: 3600s)
rudder agent:wait-all --timeout 300
```

## Harvesting Results

```bash
# Reap single agent (wait + merge + cleanup + update status)
rudder agent:reap T001

# Reap all completed agents
rudder agent:reap-all

# Reject agent work (discard worktree)
rudder agent:reject T001 --reason "Wrong approach"

# Force-terminate running agent
rudder agent:kill T001
```

## Spawn Behavior

`agent:spawn` is **BLOCKING** - it waits, streams output, and auto-reaps on success.

```
agent:spawn T001
    ↓
[streams log, shows heartbeat]
    ↓
exit 0 → auto-reap (merge + cleanup) + useful summary
exit ≠0 → manual: agent:log, agent:reject, or agent:spawn --resume
```

**Important:** On completion, spawn displays useful info (exit code, files changed, next steps). Do NOT lose this output.

## Parallel Spawning

Use **Task tool with `run_in_background: true`** for parallel agents:

```
# In ONE message, call Task multiple times with run_in_background:
Task: rudder agent:spawn T001 (run_in_background: true)
Task: rudder agent:spawn T002 (run_in_background: true)
Task: rudder agent:spawn T003 (run_in_background: true)
```

**NEVER use bash `&`** - it loses the output and useful completion info.

**NEVER use `sleep && check` patterns** - Task tool handles completion notification automatically.

Each spawn runs independently in background. Check status with `agent:status`.

## After Spawn Completes

| Exit | Action |
|------|--------|
| 0 (success) | Auto-reaped, check `agent:status` |
| ≠0 (failed) | `agent:log T001` to investigate |
| Blocked | `agent:spawn T001 --resume` or `agent:reject T001` |

## Checking Dead/Failed Agents

```bash
# See what happened
rudder agent:log T001 -n 50

# Full log
rudder agent:log T001

# Current status
rudder agent:status T001

# List all agents
rudder agent:list
```

## Batch Harvest

```bash
# After all spawns complete
rudder agent:conflicts      # Check file overlaps
rudder agent:reap-all       # Merge all completed
```

## Output Formats

All commands support `--json` for machine-readable output:
```bash
rudder agent:list --json
rudder agent:status T001 --json
```
