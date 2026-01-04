# Rudder MCP Server

The Rudder MCP Server exposes rudder CLI commands as MCP (Model Context Protocol) tools for sandboxed agents. Agents can interact with rudder without needing filesystem write access to the haven directory.

## Purpose

When agents run in sandbox mode, they're restricted to writing only to their worktree directory. However, rudder commands need to write to:

- `runs/` - Task run files (assignment tracking)
- `memory/` - Epic memory and logs
- `artefacts/` - PRD/Epic/Task files

The MCP server bridges this gap by running **outside** the sandbox, receiving tool calls from the sandboxed agent, and executing rudder commands on its behalf.

## Architecture

One MCP server per haven, shared by all agents:

```
┌─────────────────────────────────────────────────────────────┐
│                        SANDBOX                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Claude Agent T001                                   │    │
│  │    └── socat UNIX-CONNECT:haven/mcp.sock            │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Claude Agent T002                                   │    │
│  │    └── socat UNIX-CONNECT:haven/mcp.sock            │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────│─────────────────────────────────┘
                            │
                   haven/mcp.sock (Unix socket)
                            │
                    ┌───────▼───────┐
                    │  MCP Server   │  ← Runs OUTSIDE sandbox
                    │  (shared)     │     One per haven
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  rudder CLI   │
                    │  (bin/rudder) │
                    └───────────────┘
```

Benefits of shared MCP server:
- **One process per haven**: No process explosion with many agents
- **Automatic reuse**: If server already running, new agents connect to it
- **Clean shutdown**: Server cleans up socket on exit

## Transport Modes

### Stdio Mode (Default)

For direct Claude usage without sandbox:

```bash
node mcp/rudder-server.js --project-root /path/to/project
```

The server reads JSON-RPC messages from stdin and writes responses to stdout.

### Unix Socket Mode (Preferred for Sandbox)

For sandboxed agents - one server per haven:

```bash
node mcp/rudder-server.js --socket /path/to/mcp.sock --project-root /path/to/project
```

The server listens on a Unix socket. Faster than TCP, no port conflicts, and cleaner security model (filesystem permissions).

### TCP Mode (Fallback)

Alternative for environments where Unix sockets aren't available:

```bash
node mcp/rudder-server.js --port 9999 --project-root /path/to/project
```

The server listens on `127.0.0.1:PORT` and accepts TCP connections.

## Command Line Options

| Option | Description |
|--------|-------------|
| `--project-root /path` | Project root path (default: parent of mcp directory) |
| `--socket PATH` | Listen on Unix socket (preferred for sandbox) |
| `--port PORT` | Listen on TCP port (fallback) |
| `--task-id TNNN` | Restrict operations to a specific task (optional) |

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
| `deps_show` | Show dependencies for a task (blockers and dependents) |

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

Executes arbitrary rudder commands. Task ID restriction still applies.

## Security Model

### Haven-Level Isolation

The MCP server runs at the haven level (one per project). This means:

- **All agents share the same MCP server** for a given project
- **No per-task restriction** by default (agents can access any task)
- **Sandbox provides isolation**: Agents can only write to their worktree

### Why No Per-Task Restriction?

1. **Simpler architecture**: One server handles all agents
2. **Sandbox is the isolation layer**: Write access is restricted at filesystem level
3. **Task context is self-contained**: Agents receive their task context at spawn

### Optional Task Restriction

For stricter isolation, you can still use `--task-id`:

```bash
node mcp/rudder-server.js --socket /path/mcp.sock --task-id T042 --project-root /path
```

This restricts all MCP operations to the specified task.

## Configuration Files

### Haven Level (shared)

These files are created in the haven directory:

**haven/mcp.sock** - Unix socket file

**haven/mcp.pid** - Server process ID:
```
12345
```

### Agent Level

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

For internal mode (no sandbox):
```json
{
  "mcpServers": {
    "rudder": {
      "command": "node",
      "args": ["/path/to/mcp/rudder-server.js", "--project-root", "/path/to/project"]
    }
  }
}
```

## Agent Integration

### How Agents Use MCP

1. Agent spawns with `--mcp-config` pointing to `mcp-config.json`
2. Agent calls MCP tools instead of running rudder directly
3. MCP server executes rudder commands with full haven access
4. Results returned to agent

### Bootstrap Sequence

```
1. Spawn pre-claims task: rudder assign:claim T042
2. Agent starts → calls context:load T042 (task already claimed)
3. Returns: Task context, dependencies, memory
4. Agent works on task in worktree
5. Agent calls task_log to record progress
6. Agent calls assign_release when done (or auto-release on exit 0)
```

Note: Since v1.6.3, spawn pre-claims the task before launching the agent. If the agent exits with code 0 and has work done, auto-release triggers even if the agent didn't call assign_release.

### Example Agent Usage

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

## Troubleshooting

### Check MCP Server Logs

The MCP server logs to stderr:

```
Rudder MCP Server started (TCP mode)
  Listening on: 127.0.0.1:9999
  Restricted to task: T042
  Project root: /home/user/project
Client connected from 127.0.0.1:45604
Client disconnected
```

### Test TCP Connection

```bash
# Start server manually
node mcp/rudder-server.js --port 9999 --task-id T042 --project-root /path/to/project

# Test with socat
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | socat - TCP:127.0.0.1:9999
```

### Common Issues

**"Access denied: This agent can only access task TXXX"**

The agent tried to access a different task than assigned. Verify `--task-id` matches the agent's task.

**"Connection refused"**

MCP server not running or wrong port. Check `mcp.port` file and process.

**"Unknown tool"**

Tool name doesn't match available tools. Use `tools/list` to see available tools.

## Protocol Details

The MCP server uses JSON-RPC 2.0 over newline-delimited JSON:

### Request

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"task_show","arguments":{"task_id":"T042"}}}
```

### Response

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Task T042: ..."}]}}
```

### Error

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Access denied..."}],"isError":true}}
```

## Related Documentation

- [Sandbox Setup](sandbox.md) - srt configuration and usage
- [Rudder CLI](rudder.md) - Full CLI reference
- [Agent Protocol](agent-protocol.md) - Agent lifecycle and communication
