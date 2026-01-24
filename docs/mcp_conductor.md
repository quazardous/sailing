# MCP Conductor

The Conductor MCP server orchestrates agent lifecycle from the skill/coordinator session. It provides tools to spawn, monitor, and harvest agents.

## When to Use

Use the Conductor when you are:
- A **skill session** managing multiple agents
- A **coordinator** orchestrating parallel task execution
- Running **outside** the sandbox with full haven access

## Available Tools

### Agent Lifecycle

| Tool | Description |
|------|-------------|
| `agent_spawn` | Spawn agent for task execution |
| `agent_reap` | Reap agent (wait, merge work, cleanup) |
| `agent_kill` | Kill agent process |
| `agent_status` | Get agent execution status |
| `agent_log` | Get agent output log |
| `agent_list` | List all agents |
| `agent_reset` | Reset agent: kill, discard work, clear db, reset task status |

### Workflow

| Tool | Description |
|------|-------------|
| `workflow_ready` | Get ready tasks (unblocked, not started) |
| `workflow_start` | Start a task (set In Progress) |
| `workflow_complete` | Complete a task (set Done) |

### Dependencies

| Tool | Description |
|------|-------------|
| `deps_show` | Show dependencies for a task or epic |
| `deps_add` | Add dependency between Tasks (T001) or Epics (E001) |
| `deps_critical` | Find bottlenecks (tasks blocking the most work) |

### Artefacts

| Tool | Description |
|------|-------------|
| `artefact_show` | Show artefact details (PRD, Epic, Task) |
| `artefact_update` | Update artefact metadata (status, assignee) |
| `artefact_list` | List artefacts by type or filter |

## Tool Examples

### agent_spawn

```json
{
  "name": "agent_spawn",
  "arguments": {
    "task_id": "T042",
    "timeout": 600,
    "worktree": true
  }
}
```

Returns: `{ success, taskId, pid, worktree: { path, branch, baseBranch }, logFile }`

### agent_reap

```json
{
  "name": "agent_reap",
  "arguments": {
    "task_id": "T042",
    "wait": true,
    "timeout": 300
  }
}
```

Waits for agent completion, merges worktree changes, updates task status.

### agent_reset

```json
{
  "name": "agent_reset",
  "arguments": {
    "task_id": "T042",
    "reason": "Agent stuck, need to restart"
  }
}
```

Kills process, discards worktree, clears db entry, resets task to "Not Started".

### workflow_ready

```json
{
  "name": "workflow_ready",
  "arguments": {
    "scope": "E001",
    "limit": 5
  }
}
```

Returns ready tasks in epic E001, sorted by impact.

### deps_add

```json
{
  "name": "deps_add",
  "arguments": {
    "id": "T002",
    "blocked_by": "T001"
  }
}
```

Works with Tasks (T001) and Epics (E001). NOT for PRDs.

## Typical Workflow

```
1. workflow_ready          # Find tasks to work on
2. agent_spawn T001        # Spawn agent for task
3. agent_spawn T002        # Spawn another (parallel)
4. agent_status T001       # Check progress
5. agent_log T001 --tail   # View recent output
6. agent_reap T001         # Harvest when done
7. workflow_ready          # Find next tasks
```

## Git Validation

Before spawning agents, the conductor validates:
1. **Git repo exists** - Required for worktree mode
2. **Working directory is clean** - No uncommitted changes
3. **At least one commit** - Required to create branches

If validation fails, `agent_spawn` returns an `escalate` object with next steps.

## Related Documentation

- [MCP Agent](mcp_agent.md) - Tools for sandboxed agents
- [Agent Protocol](agent-protocol.md) - Mission/Result schema
- [Sandbox Setup](sandbox.md) - srt configuration
