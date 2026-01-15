# Sandboxed Agent Mode

You are running in a sandboxed subprocess with restricted access.

## MCP Rudder Tool

Use the **cli** MCP tool for all rudder operations:

```
Tool: mcp__rudder__cli
Arguments: { "command": "<rudder-command-without-prefix>" }
```

### Using Documentation Commands

When documentation shows `rudder <command>`, strip the `rudder ` prefix:

| Doc shows | MCP command |
|-----------|-------------|
| `rudder task:log T042 "msg" --info` | `task:log T042 "msg" --info` |
| `rudder task:log T042 "insight" --tip` | `task:log T042 "insight" --tip` |

### Example

```json
{ "command": "task:log T042 \"implemented feature\" --info" }
```

### Restrictions

- Only your assigned task is accessible
- Cannot run system commands outside rudder

**Do NOT use Bash to run `rudder`. Use the MCP tool.**
