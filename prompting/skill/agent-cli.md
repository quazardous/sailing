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

# Follow log in real-time (Ctrl+C to stop)
rudder agent:tail T001

# Show full log
rudder agent:log T001

# Last N lines
rudder agent:log T001 -n 50
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

## Parallel Workflow

```bash
# 1. Spawn multiple agents in parallel
rudder agent:spawn T001 &
rudder agent:spawn T002 &
rudder agent:spawn T003 &

# 2. Wait for all to complete
rudder agent:wait-all T001 T002 T003

# 3. Check for conflicts before merging
rudder agent:conflicts

# 4. Reap all
rudder agent:reap-all
```

## Output Formats

All commands support `--json` for machine-readable output:
```bash
rudder agent:list --json
rudder agent:status T001 --json
```
