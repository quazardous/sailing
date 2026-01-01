# Rudder MCP Server

MCP server that exposes rudder CLI commands as tools for sandboxed agents.

## Usage

### Direct launch

```bash
node mcp/rudder-server.js [--task-id TNNN] [--project-root /path]
```

Options:
- `--task-id`: Restrict operations to a specific task (for agent isolation)
- `--project-root`: Path to sailing project (defaults to parent of mcp/)

### Claude MCP Configuration

Add to your Claude settings (`.claude/settings.json` or global):

```json
{
  "mcpServers": {
    "rudder": {
      "command": "node",
      "args": ["/path/to/sailing/mcp/rudder-server.js"],
      "env": {}
    }
  }
}
```

For agent-specific (task-restricted):

```json
{
  "mcpServers": {
    "rudder": {
      "command": "node",
      "args": [
        "/path/to/sailing/mcp/rudder-server.js",
        "--task-id", "T042",
        "--project-root", "/path/to/project"
      ]
    }
  }
}
```

## Available Tools

| Tool | Description | Agent Restricted |
|------|-------------|------------------|
| `task_log` | Log message for a task (info, tip, warn, error, critical) | Yes |
| `task_show` | Show task details (metadata, description, deliverables) | Yes |
| `task_show_memory` | Show task memory/context (tips from previous epic work) | Yes |
| `assign_claim` | Claim task assignment (returns full context for execution) | Yes |
| `assign_release` | Release task assignment when work is complete | Yes |
| `deps_show` | Show task dependencies (blockers and blocked-by) | Yes |
| `task_targets` | Show target versions for task completion | Yes |
| `context_load` | Load context for an operation (agent bootstrap) | No |
| `versions` | Show component versions | No |
| `status` | Show project status overview (PRDs, epics, tasks) | No |

**Agent Restricted**: When `--task-id` is set, only allows operations on that specific task.

## Security

When `--task-id` is set, the server restricts all task-specific operations to that task only. This prevents agents from accessing or modifying other tasks.

The server runs outside the sandbox and has full filesystem access to execute rudder commands.
