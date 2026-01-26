# Rudder MCP Agent Server

MCP server that exposes rudder tools for sandboxed agents.

## Architecture

```
rdrctl start
    ↓
cli/mcp-server.ts (daemon manager)
    ↓
spawns: mcp/agent-server.js
    ↓
imports: dist/cli/mcp-agent.js
    ↓
uses: cli/managers/mcp-tools-manager/agent-tools.ts
```

## Usage

### Via rdrctl (recommended)

```bash
rdrctl start          # Start daemon
rdrctl start -f       # Start foreground
rdrctl status         # Check status
rdrctl stop           # Stop server
rdrctl restart        # Restart
rdrctl log            # Tail logs
```

### Direct launch

```bash
node mcp/agent-server.js [--socket /path] [--port 9100] [--project-root /path]
```

Options:
- `--socket`: Unix socket path (default: .sailing/haven/mcp.sock)
- `--port`: TCP port (alternative to socket)
- `--project-root`: Path to sailing project

### Claude MCP Configuration

Add to your Claude settings (`.claude/settings.json` or global):

```json
{
  "mcpServers": {
    "rudder": {
      "command": "node",
      "args": ["/path/to/sailing/mcp/agent-server.js"],
      "env": {}
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `task_log` | Log message for a task (info, tip, warn, error, critical) |
| `artefact_show` | Get artefact details (task, epic, prd, story) |
| `deps_show` | Show dependencies for task or epic |
| `context_load` | Load execution context for operation |
| `memory_read` | Read memory hierarchy (project → PRD → epic) |
| `system_status` | Get project status overview |
| `adr_list` | List Architecture Decision Records (with domain/tag filtering) |
| `adr_show` | Get ADR details (read-only) |
| `adr_context` | Get accepted ADRs formatted for implementation context |

## Tool Details

### task_log
Log message for task execution.

```json
{
  "task_id": "T001",
  "message": "Starting implementation",
  "level": "info",
  "file": "src/feature.ts",
  "command": "npm test"
}
```

Levels: `info`, `tip`, `warn`, `error`, `critical`

### artefact_show
Get artefact details.

```json
{
  "id": "T001",
  "raw": true
}
```

### deps_show
Get dependencies for task or epic.

```json
{
  "id": "T001"
}
```

### context_load
Load execution context for operation.

```json
{
  "operation": "T001",
  "role": "agent"
}
```

### memory_read
Read memory hierarchy.

```json
{
  "scope": "E001",
  "full": false
}
```

### adr_list
List ADRs with optional filtering. Returns `available_domains` and `available_tags` for discovery.

```json
{
  "status": "Accepted",
  "domain": "core",
  "tags": ["architecture"]
}
```

### adr_show
Get full ADR details.

```json
{
  "id": "ADR-001"
}
```

### adr_context
Get accepted ADRs formatted for implementation. Supports `task_id` for future domain/tag inference.

```json
{
  "task_id": "T001",
  "domain": "core",
  "tags": ["architecture"]
}
```

## Security

The agent server provides read-only access to ADRs and limited write access for task logging. Full ADR management (create, accept, deprecate) is only available through the conductor MCP server.
