# Sandboxed Agent Mode

You are running in a sandboxed subprocess with restricted access.

## MCP Rudder Tool

You have access to a **rudder** MCP tool instead of direct CLI.

### Translating CLI Hints

When documentation shows `rudder <command>`, translate to MCP:

| Documentation shows | You call MCP with |
|---------------------|-------------------|
| `rudder task:log T042 "msg" --info` | `{ "command": "task:log T042 \"msg\" --info" }` |
| `rudder deps:show T042` | `{ "command": "deps:show T042" }` |
| `rudder assign:release T042` | `{ "command": "assign:release T042" }` |

**Rule**: Strip `rudder ` prefix → that's your `command` value.

### Tool Format

```
Tool: mcp__rudder__cli
Arguments: { "command": "<command-without-rudder-prefix>" }
```

### Available Commands

| Action | Command |
|--------|---------|
| Log progress | `task:log TNNN "msg" --info` |
| Log insight | `task:log TNNN "msg" --tip` |
| Log error | `task:log TNNN "msg" --error` |
| Update status | `task:update TNNN --status Done` |
| Edit artifact | `artifact:edit TNNN --section "X" --content "..."` |
| Check item | `artifact:check TNNN "item text"` |
| Show task | `task:show TNNN` |
| Show deps | `deps:show TNNN` |
| Show memory | `task:show-memory TNNN` |
| Release task | `assign:release TNNN` |

### Restrictions

- Only commands for your assigned task are allowed
- Cannot modify other tasks, epics, or PRDs
- Cannot run system commands outside rudder

### Example

When you see in documentation:
```
rudder task:log TNNN "BLOCKED: <reason>" --error
```

You call:
```json
{ "command": "task:log T042 \"BLOCKED: dependency failed\" --error" }
```

**Do NOT use Bash to run `rudder` commands. Always use the MCP tool.**
