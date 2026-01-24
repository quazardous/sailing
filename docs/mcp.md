# Rudder MCP Server

The Rudder MCP Server exposes rudder CLI commands as MCP (Model Context Protocol) tools. Two audiences use different tool sets:

| Audience | Documentation | Tools |
|----------|---------------|-------|
| **Conductor** (skill/coordinator) | [mcp_conductor.md](mcp_conductor.md) | agent_spawn, agent_reap, workflow_*, deps_* |
| **Agent** (sandboxed task executor) | [mcp_agent.md](mcp_agent.md) | task_*, assign_*, context_load |

## Quick Start

### For Conductor (Skill Session)

```bash
# Start MCP server
bin/rdrctl start conductor

# Use tools to orchestrate agents
agent_spawn T001    # Spawn agent
agent_status T001   # Check status
agent_reap T001     # Harvest results
```

### For Agent (Sandboxed)

Agents connect via Unix socket. The spawn process configures this automatically.

```
# Bootstrap (task already claimed by spawn)
context_load T001

# Log progress
task_log T001 "Implemented feature" --level info

# Complete (or auto-release on exit 0)
assign_release T001
```

## Transport Modes

| Mode | Command | Use Case |
|------|---------|----------|
| Stdio | `node mcp/rudder-server.js` | Direct Claude usage |
| Unix Socket | `--socket /path/mcp.sock` | Sandboxed agents (preferred) |
| TCP | `--port 9999` | Fallback |

## Server Management

```bash
bin/rdrctl start conductor    # Start MCP server
bin/rdrctl status             # Check server status
bin/rdrctl stop conductor     # Stop server
```

## Related Documentation

- [MCP Conductor](mcp_conductor.md) - Conductor/skill tools
- [MCP Agent](mcp_agent.md) - Agent tools
- [Sandbox Setup](sandbox.md) - srt configuration
- [Agent Protocol](agent-protocol.md) - Mission/Result schema
