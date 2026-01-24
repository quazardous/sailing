# MCP Agent

The Agent MCP server provides tools for sandboxed agents executing tasks. Agents use these tools to interact with rudder without filesystem write access to the haven directory.

## When to Use

Use these tools when you are:
- A **sandboxed agent** executing a task
- Running **inside** the sandbox with restricted write access
- Working in a **worktree** isolated from the main project

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SANDBOX                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Claude Agent T001                                   │    │
│  │    └── socat UNIX-CONNECT:haven/mcp.sock            │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────│─────────────────────────────────┘
                            │
                   haven/mcp.sock (Unix socket)
                            │
                    ┌───────▼───────┐
                    │  MCP Server   │  ← Runs OUTSIDE sandbox
                    │  (shared)     │     One per haven
                    └───────────────┘
```

## Available Tools

### Task Operations

| Tool | Description |
|------|-------------|
| `task_log` | Log a message for a task (progress, tips, warnings, errors) |
| `task_show` | Show task details (metadata, description, deliverables) |
| `task_show_memory` | Show memory/context for a task (tips from previous work) |
| `task_targets` | Show target versions for a task |

### Assignment

| Tool | Description |
|------|-------------|
| `assign_claim` | Claim a task assignment, returns full context |
| `assign_release` | Release a task assignment when work is complete |

### Dependencies

| Tool | Description |
|------|-------------|
| `deps_show` | Show dependencies for a task or epic |

### Project

| Tool | Description |
|------|-------------|
| `context_load` | Load context for a specific operation (agent bootstrap) |
| `versions` | Show current component versions |
| `status` | Show project status overview (PRDs, epics, tasks) |

### Generic CLI

| Tool | Description |
|------|-------------|
| `cli` | Execute any rudder CLI command (passthrough) |

## Tool Examples

### task_log

```json
{
  "name": "task_log",
  "arguments": {
    "task_id": "T042",
    "message": "Found workaround for API issue",
    "level": "tip",
    "file": "src/api.js"
  }
}
```

Log levels: `info`, `tip`, `warn`, `error`, `critical`

### assign_claim

```json
{
  "name": "assign_claim",
  "arguments": {
    "task_id": "T042"
  }
}
```

Returns full task context: description, dependencies, memory, targets.

### cli (passthrough)

```json
{
  "name": "cli",
  "arguments": {
    "command": "artifact:edit T042 --section Notes --append \"Added new note\""
  }
}
```

## Bootstrap Sequence

```
1. Spawn pre-claims task: rudder assign:claim T042
2. Agent starts → calls context:load T042 (task already claimed)
3. Returns: Task context, dependencies, memory
4. Agent works on task in worktree
5. Agent calls task_log to record progress
6. Agent calls assign_release when done (or auto-release on exit 0)
```

Note: Since v1.6.3, spawn pre-claims the task. If the agent exits with code 0, auto-release triggers.

## Example Agent Usage

```
# Get task context (task is already claimed by spawn)
Tool: mcp__rudder__cli
Arguments: { "command": "context:load T042" }

# Log progress
Tool: mcp__rudder__task_log
Arguments: { "task_id": "T042", "message": "Implemented feature X", "level": "info" }

# Check dependencies
Tool: mcp__rudder__deps_show
Arguments: { "task_id": "T042" }

# Release when done (optional - auto-release handles this)
Tool: mcp__rudder__assign_release
Arguments: { "task_id": "T042" }
```

## Configuration

Each agent gets its own MCP config:

**agents/T042/mcp-config.json**

For sandbox mode (Unix socket):
```json
{
  "mcpServers": {
    "rudder": {
      "command": "socat",
      "args": ["-", "UNIX-CONNECT:/path/to/haven/mcp.sock"]
    }
  }
}
```

## Security Model

- **All agents share the same MCP server** for a given project
- **Sandbox provides isolation**: Agents can only write to their worktree
- **Task context is self-contained**: Agents receive their task context at spawn

## Troubleshooting

### Common Issues

**"Access denied: This agent can only access task TXXX"**

The agent tried to access a different task than assigned.

**"Connection refused"**

MCP server not running. Check `haven/mcp.sock` exists.

**"Unknown tool"**

Tool name doesn't match available tools. Use `tools/list` to see available tools.

## Related Documentation

- [MCP Conductor](mcp_conductor.md) - Tools for skill/coordinator
- [Agent Protocol](agent-protocol.md) - Mission/Result schema
- [Sandbox Setup](sandbox.md) - srt configuration
