# Agent MCP Commands

## Spawning

```json
// MCP: agent_spawn
{ "task_id": "T001" }

// With timeout (default: 600s)
{ "task_id": "T001", "timeout": 1800 }

// With worktree (isolated git branch)
{ "task_id": "T001", "worktree": true }

// Dry-run (show what would happen)
{ "task_id": "T001", "dry_run": true }
```

## Monitoring

```json
// MCP: agent_status
{}                           // List all agents
{ "active": true }           // Only active (dispatched/running)
{ "task_id": "T001" }        // Specific agent

// MCP: agent_log
{ "task_id": "T001" }              // Full log
{ "task_id": "T001", "lines": 50 } // Last N lines
{ "task_id": "T001", "tail": true } // Follow log (Ctrl+C to stop)
{ "task_id": "T001", "events": true } // Filtered JSON events
```

## Waiting

```json
// MCP: agent_wait
{ "task_id": "T001" }              // Wait for single agent

// MCP: agent_wait_all
{}                                 // Wait for ALL active agents
{ "task_ids": ["T001", "T002"] }   // Wait for specific agents
{ "any": true }                    // Wait for FIRST to complete
{ "timeout": 300 }                 // With timeout (default: 3600s)
```

## Harvesting Results

```json
// MCP: agent_reap
{ "task_id": "T001" }       // Wait + merge + cleanup + update status

// MCP: agent_reap_all
{}                          // Reap all completed agents

// MCP: agent_reject
{ "task_id": "T001", "reason": "Wrong approach" }  // Discard worktree

// MCP: agent_kill
{ "task_id": "T001" }       // Force-terminate running agent
```

## Spawn Behavior

`agent_spawn` is **BLOCKING** - it waits, streams output, and auto-reaps on success.

```
agent_spawn { "task_id": "T001" }
    ↓
[streams log, shows heartbeat]
    ↓
exit 0 → auto-reap (merge + cleanup) + useful summary
exit ≠0 → manual: agent_log, agent_reject, or agent_spawn with resume
```

**Important:** On completion, spawn returns useful info (exit code, files changed, next steps). Do NOT lose this output.

## Parallel Spawning

Use **Task tool with `run_in_background: true`** for parallel agents:

```
# In ONE message, call Task multiple times with run_in_background:
Task: agent_spawn T001 (run_in_background: true)
Task: agent_spawn T002 (run_in_background: true)
Task: agent_spawn T003 (run_in_background: true)
```

**NEVER use bash `&`** - it loses the output and useful completion info.

**NEVER use `sleep && check` patterns** - Task tool handles completion notification automatically.

Each spawn runs independently in background. Check status with `agent_status`.

## After Spawn Completes

| Exit | Action |
|------|--------|
| 0 (success) | Auto-reaped, check `agent_status` |
| ≠0 (failed) | `agent_log { "task_id": "T001" }` to investigate |
| Blocked | `agent_spawn` with resume or `agent_reject` |

## Checking Dead/Failed Agents

```json
// MCP: agent_log
{ "task_id": "T001", "lines": 50 }  // See what happened
{ "task_id": "T001" }                // Full log

// MCP: agent_status
{ "task_id": "T001" }               // Current status
{}                                   // List all agents
```

## Batch Harvest

```json
// MCP: agent_conflicts
{}                          // Check file overlaps

// MCP: agent_reap_all
{}                          // Merge all completed
```
